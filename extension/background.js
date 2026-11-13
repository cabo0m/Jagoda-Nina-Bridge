import {
  ACTIVE_KEY, ALARM_NAME, CONFIG_KEY, LEASES_KEY, OUTGOING_KEY,
  POLL_MINUTES, SNAPSHOT_KEY, TOKEN_KEY, extractProblem,
  normalizeConfig, outgoingMessage, outboundMatches, permissionOrigin,
  publicMessage, validateToken, validateUuid,
} from "./bridge-core.mjs";
import {
  BINDING_KEY, JOB_KEY,
  normalizeThreadUrl, formatBridgePrompt, validateBridgeOutput,
} from "./chatgpt-adapter.mjs";

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
    TOKEN_KEY, SNAPSHOT_KEY, OUTGOING_KEY, LEASES_KEY, BINDING_KEY, JOB_KEY,
  ]);
  return {
    config: local[CONFIG_KEY] ?? null,
    active: local[ACTIVE_KEY] === true,
    token: session[TOKEN_KEY] ?? null,
    snapshot: {...EMPTY_SNAPSHOT, ...(session[SNAPSHOT_KEY] ?? {})},
    outgoing: session[OUTGOING_KEY] ?? null,
    leases: session[LEASES_KEY] ?? {},
    binding: session[BINDING_KEY] ?? null,
    bridgeJob: session[JOB_KEY] ?? null,
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
    // A successful inbox read is NOT proof that a previous remote STOP worked.
    remoteStopUnknown: state.snapshot.remoteStopUnknown,
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
    const snapshot = await loadInbox();
    await maybeAutoBridge(snapshot);
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
    chatgpt: state.binding ? {
      chatUrl: state.binding.chatUrl,
      tabId: state.binding.tabId,
      role: state.binding.participant,
    } : null,
    bridgeJob: state.bridgeJob ? {
      id: state.bridgeJob.inboundId,
      phase: state.bridgeJob.phase,
      error: state.bridgeJob.error ?? null,
    } : null,
  };
}

async function configure(message) {
  const previous = await getConfig();
  if (previous.bridgeJob) {
    throw new Error("Trwa lub wymaga wyjaśnienia rozpoczęta obsługa ChatGPT. Nie można skasować śladu zadania konfiguracją.");
  }
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
  await chrome.storage.session.remove([OUTGOING_KEY, BINDING_KEY, JOB_KEY]);
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
  await maybeAutoBridge(snapshot);
  return await viewStatus();
}

async function sync() {
  const snapshot = await loadInbox();
  await maybeAutoBridge(snapshot);
  return {snapshot, status: await viewStatus()};
}

async function send(message) {
  const state = await getConfig();
  const {config, token} = requireSession(state);
  if (!state.active) {
    throw new Error("Najpierw kliknij START.");
  }
  if (config.participant === "jagoda" && state.binding) {
    throw new Error("Jagoda ma przypiętą automatyczną rozmowę ChatGPT. Nie wysyłaj ręcznej odpowiedzi.");
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
  if (state.bridgeJob?.inboundId === id) {
    throw new Error("Wiadomość przetwarza adapter ChatGPT. Nie wykonuj ręcznego ACK.");
  }
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

// Sprint 3: one explicitly bound ChatGPT thread. This code does not enumerate
// conversation contents, browser history or unrelated web pages.
async function checkedChatTab(binding) {
  const tab = await chrome.tabs.get(binding.tabId);
  if (!tab || normalizeThreadUrl(tab.url) !== binding.chatUrl) {
    throw new Error("Przypięta karta ChatGPT zmieniła rozmowę lub została zamknięta.");
  }
  return tab;
}

async function ensureChatBridge(binding) {
  await checkedChatTab(binding);
  await chrome.scripting.executeScript({
    target: {tabId: binding.tabId},
    files: ["chatgpt-bridge.js"],
  });
  const check = await chrome.tabs.sendMessage(binding.tabId, {
    type: "JNB_PROBE", chatUrl: binding.chatUrl,
  });
  if (!check?.ok || !check.result?.ready) {
    throw new Error(check?.error || "Dedykowana rozmowa ChatGPT jest niedostępna.");
  }
}

async function bindChatGPT(value) {
  const chatUrl = normalizeThreadUrl(value);
  const state = await getConfig();
  const {config} = requireSession(state);
  if (config.participant !== "jagoda") {
    throw new Error("W Sprint 3 automatycznie odpowiada tylko Jagoda. Nina pozostaje odbiorczynią.");
  }
  if (!state.active) throw new Error("Najpierw uruchom START.");
  if (state.bridgeJob) {
    throw new Error("Istnieje już rozpoczęte zadanie. Nie można zmienić przypięcia.");
  }
  if (state.outgoing) {
    throw new Error("Najpierw wyjaśnij niepotwierdzoną ręczną wysyłkę do serwera.");
  }
  // Only query ChatGPT tabs; chrome.scripting only receives a matching tab ID.
  const candidates = await chrome.tabs.query({url: chatUrl + "*"});
  const exact = candidates.filter(tab => {
    try { return normalizeThreadUrl(tab.url) === chatUrl; }
    catch { return false; }
  });
  if (exact.length !== 1) {
    throw new Error(exact.length
      ? "Otwarta jest więcej niż jedna karta tej rozmowy. Pozostaw dokładnie jedną."
      : "Otwórz podany wątek ChatGPT w jednej karcie, a potem ponów przypięcie.");
  }
  const binding = {
    tabId: exact[0].id, chatUrl, participant: config.participant,
    conversationId: config.conversationId,
  };
  await ensureChatBridge(binding); // Refuse binding unless composer is empty/ready.
  await chrome.storage.session.set({[BINDING_KEY]: binding});
  const snapshot = await loadInbox();
  await maybeAutoBridge(snapshot);
  return await viewStatus();
}

async function bindActiveChatGPT() {
  const state = await getConfig();
  const {config} = requireSession(state);
  if (config.participant !== "jagoda") {
    throw new Error("Przypinanie ChatGPT jest dostępne tylko dla Jagody.");
  }
  if (!state.active) {
    throw new Error("Najpierw kliknij START.");
  }
  // No account-wide tab enumeration. Only inspect a currently active
  // tab with permission already granted to the ChatGPT origin.
  const active = await chrome.tabs.query({
    active: true, currentWindow: true, url: "https://chatgpt.com/*",
  });
  if (active.length !== 1 || typeof active[0].url !== "string") {
    throw new Error("Przełącz główną kartę Chrome na otwartą rozmowę ChatGPT, a potem kliknij przypinanie.");
  }
  const url = normalizeThreadUrl(active[0].url);
  return await bindChatGPT(url);
}

async function unbindChatGPT() {
  const state = await getConfig();
  if (state.bridgeJob) throw new Error("Nie można odpiąć rozmowy w trakcie przetwarzania.");
  await chrome.storage.session.remove(BINDING_KEY);
  return await viewStatus();
}

async function markBridgeFailure(job, message) {
  const current = await getConfig();
  if (current.bridgeJob?.jobId !== job.jobId) return;
  const error = String(message || "Niepewny wynik adaptera.").slice(0, 300);
  await chrome.storage.session.set({
    [JOB_KEY]: {...job, phase: "needs_review", error},
  });
  await saveSnapshot({...current.snapshot, lastError:
    "Adapter ChatGPT: " + error + " Bez automatycznej ponownej wysyłki."});
}

async function maybeAutoBridge(snapshot) {
  const state = await getConfig();
  if (!state.active || !state.binding || state.bridgeJob ||
      state.config?.participant !== "jagoda" ||
      state.snapshot.remoteStopUnknown ||
      snapshot.conversation?.status !== "open" ||
      snapshot.conversation?.message_count !== 1) return;

  const incoming = snapshot.messages.find(item =>
    item.sender_id === "nina" && item.status === "queued");
  if (!incoming) return;
  const binding = state.binding;
  if (binding.conversationId !== state.config.conversationId ||
      binding.participant !== "jagoda") {
    throw new Error("Przypięcie ChatGPT nie odpowiada tej rozmowie.");
  }
  await ensureChatBridge(binding);
  // The server lease is obtained only after the page is ready. This prevents
  // reserving messages for a missing/changed ChatGPT tab.
  const claim = await serverRequest(state.config, state.token, "POST",
    `/v1/messages/${incoming.id}/claim`);
  const job = {
    jobId: crypto.randomUUID(), inboundId: incoming.id,
    leaseToken: claim.lease_token, tabId: binding.tabId,
    chatUrl: binding.chatUrl, conversationId: binding.conversationId,
    phase: "claimed", error: null,
  };
  await chrome.storage.session.set({[JOB_KEY]: job});
  try {
    // Before any possibility of clicking Send on ChatGPT, record the point
    // beyond which browser failures MUST NOT cause automatic retries.
    await serverRequest(state.config, state.token, "POST",
      `/v1/messages/${incoming.id}/dispatch-start`,
      {lease_token: job.leaseToken});
    job.phase = "dispatched";
    await chrome.storage.session.set({[JOB_KEY]: job});
    const response = await chrome.tabs.sendMessage(binding.tabId, {
      type: "JNB_RUN", jobId: job.jobId, chatUrl: binding.chatUrl,
      prompt: formatBridgePrompt(incoming.content),
    });
    if (!response?.ok || !response.started) {
      throw new Error(response?.error || "ChatGPT nie rozpoczął zadania.");
    }
  } catch(error) {
    await markBridgeFailure(job, error.message);
  }
}

async function bridgeResult(message, sender) {
  const state = await getConfig();
  const job = state.bridgeJob;
  if (!job || message.jobId !== job.jobId ||
      job.phase !== "dispatched") {
    throw new Error("Brak aktualnego zadania adaptera.");
  }
  if (!state.binding || sender.tab?.id !== job.tabId ||
      sender.url !== job.chatUrl ||
      state.binding.tabId !== job.tabId ||
      state.binding.chatUrl !== job.chatUrl ||
      state.binding.conversationId !== job.conversationId) {
    throw new Error("Wynik nie pochodzi z przypiętej rozmowy ChatGPT.");
  }
  if (!state.active || state.snapshot.remoteStopUnknown ||
      state.snapshot.conversation?.status !== "open") {
    await markBridgeFailure(job, "Rozmowa została zatrzymana; odpowiedź odrzucona.");
    return {accepted: false};
  }
  if (message.type === "JNB_BRIDGE_ERROR") {
    await markBridgeFailure(job, message.error || "Błąd interfejsu ChatGPT.");
    return {accepted: false};
  }
  let reply;
  try {reply = validateBridgeOutput(message.result);}
  catch(error) {
    await markBridgeFailure(job, error.message);
    return {accepted: false};
  }
  // Keep the exact generated reply in session before sending it to the API.
  // HTTP retries use the same deterministic idempotency key.
  const ready = {...job, phase:"result_ready", reply};
  await chrome.storage.session.set({[JOB_KEY]: ready});
  const {config, token} = requireSession(await getConfig());
  try {
    await serverRequest(config, token, "POST",
      `/v1/conversations/${encodeURIComponent(config.conversationId)}/messages`, {
        recipient_id: "nina",
        content: reply,
        reply_to_id: job.inboundId,
        idempotency_key: `auto-${job.inboundId}`,
      });
    await chrome.storage.session.set({[JOB_KEY]: {...ready, phase:"reply_saved"}});
    await serverRequest(config, token, "POST",
      `/v1/messages/${job.inboundId}/ack`,
      {lease_token: job.leaseToken});
    await chrome.storage.session.remove(JOB_KEY);
    await loadInbox();
    return {accepted: true};
  } catch(error) {
    // Never reissue ChatGPT prompts. Persist enough evidence for manual repair.
    await markBridgeFailure(ready, "Odpowiedź modelu gotowa, lecz nie potwierdzono serwera: " + error.message);
    return {accepted: false};
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
    case "BIND_CHATGPT": return await bindChatGPT(message.chatUrl);
    case "BIND_ACTIVE_CHATGPT": return await bindActiveChatGPT();
    case "UNBIND_CHATGPT": return await unbindChatGPT();
    case "STOP": return await stop();
    default: throw new Error("Nieznana operacja rozszerzenia.");
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const fromPopup = sender.id === chrome.runtime.id &&
    sender.url === chrome.runtime.getURL("popup.html");
  const fromBoundPage = sender.id === chrome.runtime.id &&
    sender.tab && sender.url?.startsWith("https://chatgpt.com/c/");
  const bridgeEvent = message?.type === "JNB_BRIDGE_RESULT" ||
    message?.type === "JNB_BRIDGE_ERROR";
  if (!fromPopup && !(fromBoundPage && bridgeEvent)) {
    respond({ok: false, error: "Odrzucono niezaufanego nadawcę."});
    return false;
  }
  serialized(() => bridgeEvent
    ? bridgeResult(message, sender)
    : handle(message)
  ).then(
    result => respond({ok: true, result}),
    error => respond({ok: false, error: String(error?.message ?? error).slice(0, 400)}),
  );
  return true;
});

// Global side panel stays available when changing browser tabs.
// Action click toggles it. No default_popup is declared in manifest 0.3.1.
void chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true})
  .catch(error => console.warn("Jagoda–Nina side panel unavailable:", String(error)));

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
