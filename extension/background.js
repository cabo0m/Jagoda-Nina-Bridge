import {
  ACTIVE_KEY, ALARM_NAME, CONFIG_KEY, LEASES_KEY, OUTGOING_KEY,
  POLL_MINUTES, SNAPSHOT_KEY, TOKEN_KEY, extractProblem,
  normalizeConfig, outgoingMessage, outboundMatches, permissionOrigin,
  publicMessage, validateToken, validateUuid,
} from "./bridge-core.mjs";

const EMPTY_SNAPSHOT = {
  messages: [], conversation: null, lastInboundId: null,
  lastSync: null, lastError: null, remoteStopUnknown: false,
};
let queue = Promise.resolve();

function serialized(callback) {
  const next = queue.then(callback, callback);
  queue = next.catch(() => {});
  return next;
}

async function tightenStorage() {
  await Promise.all([
    chrome.storage.local.setAccessLevel({accessLevel: "TRUSTED_CONTEXTS"}),
    chrome.storage.session.setAccessLevel({accessLevel: "TRUSTED_CONTEXTS"}),
  ]);
}

async function getConfig() {
  const local = await chrome.storage.local.get([CONFIG_KEY, ACTIVE_KEY]);
  const session = await chrome.storage.session.get([
    TOKEN_KEY, SNAPSHOT_KEY, OUTGOING_KEY, LEASES_KEY,
  ]);
  return {
    config: local[CONFIG_KEY] ?? null,
    active: local[ACTIVE_KEY] === true,
    token: session[TOKEN_KEY] ?? null,
    snapshot: {...EMPTY_SNAPSHOT, ...(session[SNAPSHOT_KEY] ?? {})},
    outgoing: session[OUTGOING_KEY] ?? null,
    leases: session[LEASES_KEY] ?? {},
  };
}

async function saveSnapshot(snapshot) {
  await chrome.storage.session.set({[SNAPSHOT_KEY]: snapshot});
}

async function stopLocal() {
  await chrome.storage.local.set({[ACTIVE_KEY]: false});
  await chrome.alarms.clear(ALARM_NAME);
}

async function ensurePermission(config) {
  if (!await chrome.permissions.contains({origins: [permissionOrigin(config.serverUrl)]})) {
    throw new Error("Brak zgody Chrome na dostęp do tego serwera. Zapisz konfigurację ponownie.");
  }
}

async function serverRequest(config, token, method, path, payload) {
  await ensurePermission(config);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8500);
  try {
    const response = await fetch(config.serverUrl + path, {
      method,
      headers: {
        "Authorization": `Bearer ${token}`,
        ...(payload ? {"Content-Type": "application/json"} : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: controller.signal,
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      cache: "no-store",
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(`Serwer zwrócił odpowiedź niebędącą JSON (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      throw new Error(extractProblem(result, response.status));
    }
    return result;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Upłynął limit 8,5 sekundy na odpowiedź serwera.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function requireSession(state) {
  if (!state.config || !state.token) {
    throw new Error("Skonfiguruj uczestniczkę, UUID rozmowy i token.");
  }
  return {
    config: normalizeConfig(state.config),
    token: validateToken(state.token),
  };
}

async function loadInbox() {
  const state = await getConfig();
  const {config, token} = requireSession(state);
  const id = encodeURIComponent(config.conversationId);
  const conversation = await serverRequest(config, token, "GET", `/v1/conversations/${id}`);
  const inbox = await serverRequest(config, token, "GET", "/v1/inbox?limit=10");
  if (!Array.isArray(inbox.messages)) {
    throw new Error("Nieprawidłowa odpowiedź /v1/inbox.");
  }
  const messages = inbox.messages.map(publicMessage);
  const lastInboundId = messages.length
    ? messages[messages.length - 1].id
    : state.snapshot.lastInboundId;
  const snapshot = {
    ...state.snapshot,
    messages,
    conversation: {
      id: conversation.id,
      status: conversation.status,
      message_count: conversation.message_count,
      completed_count: conversation.completed_count,
    },
    lastInboundId,
    lastSync: new Date().toISOString(),
    lastError: null,
    remoteStopUnknown: false,
  };
  await saveSnapshot(snapshot);
  if (conversation.status !== "open") {
    await stopLocal();
  }
  return snapshot;
}

async function poll() {
  const state = await getConfig();
  if (!state.active) {
    return;
  }
  if (!state.token) {
    await stopLocal();
    await saveSnapshot({...state.snapshot, lastError: "Token wygasł. Podaj go ponownie."});
    return;
  }
  if (state.snapshot.remoteStopUnknown) {
    await stopLocal();
    return;
  }
  try {
    await loadInbox();
  } catch (error) {
    await saveSnapshot({...state.snapshot, lastError: error.message.slice(0, 300)});
    if (/HTTP (401|404):/.test(error.message)) {
      await stopLocal();
    }
  }
}

async function viewStatus() {
  const state = await getConfig();
  // Only non-secret fields. Tokens and lease proofs never travel back to the popup.
  return {
    config: state.config,
    active: state.active && Boolean(state.token),
    tokenReady: Boolean(state.token),
    snapshot: state.snapshot,
    pendingSend: Boolean(state.outgoing),
  };
}

async function configure(message) {
  const config = normalizeConfig(message.config);
  const token = validateToken(message.token);
  await ensurePermission(config); // The popup must request consent in a user gesture.
  await stopLocal();
  await chrome.storage.local.set({[CONFIG_KEY]: config});
  await chrome.storage.session.set({
    [TOKEN_KEY]: token,
    [SNAPSHOT_KEY]: {...EMPTY_SNAPSHOT},
    [LEASES_KEY]: {},
  });
  await chrome.storage.session.remove(OUTGOING_KEY);
  return await viewStatus();
}

async function start() {
  const state = await getConfig();
  const {config} = requireSession(state);
  if (state.snapshot.remoteStopUnknown) {
    throw new Error("Poprzedni STOP nie został potwierdzony na serwerze. Ponów STOP.");
  }
  const snapshot = await loadInbox();
  if (snapshot.conversation.status !== "open") {
    throw new Error("Rozmowa jest zatrzymana. Nie można jej ponownie uruchomić.");
  }
  await chrome.storage.local.set({[ACTIVE_KEY]: true});
  await chrome.alarms.create(ALARM_NAME, {periodInMinutes: POLL_MINUTES});
  return await viewStatus();
}

async function sync() {
  const snapshot = await loadInbox();
  return {snapshot, status: await viewStatus()};
}

async function send(message) {
  const state = await getConfig();
  const {config, token} = requireSession(state);
  if (!state.active) {
    throw new Error("Najpierw kliknij START.");
  }
  const replyTo = config.participant === "jagoda" ? state.snapshot.lastInboundId : null;
  const proposed = outgoingMessage(config, message.content, replyTo, crypto.randomUUID());
  let payload = proposed;
  if (state.outgoing) {
    if (!outboundMatches(state.outgoing.payload, proposed) ||
        state.outgoing.conversationId !== config.conversationId) {
      throw new Error("Poprzednia wysyłka nie ma potwierdzenia. Ponów ten sam tekst, aby użyć tego samego klucza.");
    }
    payload = state.outgoing.payload;
  } else {
    // Store before fetch: a network timeout must never generate a new idempotency key.
    await chrome.storage.session.set({
      [OUTGOING_KEY]: {conversationId: config.conversationId, payload},
    });
  }
  const result = await serverRequest(
    config, token, "POST",
    `/v1/conversations/${encodeURIComponent(config.conversationId)}/messages`,
    payload,
  );
  await chrome.storage.session.remove(OUTGOING_KEY);
  await loadInbox();
  return {id: result.id, duplicate: Boolean(result.duplicate)};
}

async function ack(messageId) {
  const state = await getConfig();
  const {config, token} = requireSession(state);
  if (!state.active) {
    throw new Error("Najpierw kliknij START.");
  }
  const id = validateUuid(messageId);
  const own = state.snapshot.messages.some(item => item.id === id);
  if (!own && !state.leases[id]) {
    throw new Error("Wiadomość nie znajduje się w Twojej skrzynce.");
  }
  const path = `/v1/messages/${id}`;
  const leases = {...state.leases};
  if (!leases[id]) {
    const claimed = await serverRequest(config, token, "POST", path + "/claim");
    leases[id] = claimed.lease_token;
    await chrome.storage.session.set({[LEASES_KEY]: leases});
  }
  const result = await serverRequest(
    config, token, "POST", path + "/ack", {lease_token: leases[id]},
  );
  delete leases[id];
  await chrome.storage.session.set({[LEASES_KEY]: leases});
  await chrome.storage.session.set({
    [SNAPSHOT_KEY]: {
      ...state.snapshot,
      lastInboundId: id,  // Jagoda can still reply after acknowledging delivery.
    },
  });
  await loadInbox();
  return {id, duplicate: Boolean(result.duplicate)};
}

async function stop() {
  const state = await getConfig();
  await stopLocal(); // STOP must work locally even without an internet connection.
  if (!state.config || !state.token) {
    await saveSnapshot({
      ...state.snapshot, remoteStopUnknown: true,
      lastError: "Lokalnie zatrzymano. Brak tokenu do potwierdzenia STOP na serwerze.",
    });
    return {localStopped: true, remoteStopped: false};
  }
  const {config, token} = requireSession(state);
  try {
    await serverRequest(
      config, token, "POST",
      `/v1/conversations/${encodeURIComponent(config.conversationId)}/stop`,
    );
    await saveSnapshot({
      ...state.snapshot,
      conversation: {...state.snapshot.conversation, status: "stopped"},
      lastError: null, remoteStopUnknown: false,
    });
    return {localStopped: true, remoteStopped: true};
  } catch (error) {
    await saveSnapshot({
      ...state.snapshot, remoteStopUnknown: true,
      lastError: `Lokalny STOP. Zdalny STOP NIEPOTWIERDZONY: ${error.message.slice(0, 240)}`,
    });
    return {localStopped: true, remoteStopped: false};
  }
}

async function handle(message) {
  await tightenStorage();
  switch (message?.type) {
    case "GET_STATUS": return await viewStatus();
    case "CONFIGURE": return await configure(message);
    case "START": return await start();
    case "SYNC": return await sync();
    case "SEND": return await send(message);
    case "ACK": return await ack(message.messageId);
    case "STOP": return await stop();
    default: throw new Error("Nieznana operacja rozszerzenia.");
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Extension pages can be opened as popups OR regular tabs. Trust only our
  // exact internal popup URL, never arbitrary content scripts in website tabs.
  if (sender.id !== chrome.runtime.id ||
      sender.url !== chrome.runtime.getURL("popup.html")) {
    respond({ok: false, error: "Odrzucono niezaufanego nadawcę."});
    return false;
  }
  serialized(() => handle(message)).then(
    result => respond({ok: true, result}),
    error => respond({ok: false, error: String(error?.message ?? error).slice(0, 400)}),
  );
  return true;
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) {
    void serialized(poll);
  }
});

chrome.runtime.onStartup.addListener(() => {
  void serialized(async () => {
    await tightenStorage();
    await stopLocal(); // Session token is erased on Chrome restart.
  });
});

chrome.runtime.onInstalled.addListener(() => {
  void serialized(async () => {
    await tightenStorage();
    await stopLocal(); // Reload/update clears session secrets.
  });
});
