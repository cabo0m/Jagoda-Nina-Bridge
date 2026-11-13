import {normalizeConfig, permissionOrigin, SNAPSHOT_KEY} from "./bridge-core.mjs";

const $ = id => document.getElementById(id);
let lastState = null;
let busy = false;
let initialFormLoaded = false;

function tell(text, isError = false) {
  const target = $("notice");
  target.textContent = text;
  target.dataset.error = isError ? "true" : "false";
}

function setBusy(value) {
  busy = value;
  for (const id of ["save", "start", "sync", "stop", "send", "bind-chatgpt", "bind-current-chatgpt", "unbind-chatgpt"]) {
    $(id).disabled = value;
  }
}

async function call(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({type, ...payload});
  if (!response?.ok) {
    throw new Error(response?.error || "Nieznana odpowiedź rozszerzenia.");
  }
  return response.result;
}

function populateForm(config) {
  if (initialFormLoaded || !config) return;
  $("server-url").value = config.serverUrl;
  $("participant").value = config.participant;
  $("conversation-id").value = config.conversationId;
  initialFormLoaded = true;
}

function addMessage(item, active) {
  const wrap = document.createElement("article");
  wrap.className = "message";
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `${item.sender_id} • ${item.status} • ${item.created_at}`;
  const body = document.createElement("div");
  body.className = "content";
  body.textContent = item.content; // Never render server data as HTML.
  const id = document.createElement("div");
  id.className = "meta";
  id.textContent = `UUID: ${item.id}`;
  wrap.append(meta, body, id);
  if (item.status === "queued" || item.status === "claimed") {
    const acknowledge = document.createElement("button");
    acknowledge.type = "button";
    acknowledge.textContent = "Potwierdź odbiór (ACK)";
    acknowledge.disabled = busy || !active;
    acknowledge.addEventListener("click", async () => {
      await doAction(async () => {
        await call("ACK", {messageId: item.id});
        tell("Odbiór wiadomości potwierdzony.");
        return call("GET_STATUS");
      });
    });
    wrap.append(acknowledge);
  } else if (item.status === "needs_review") {
    const warning = document.createElement("p");
    warning.className = "hint";
    warning.textContent = "Niepewny wynik poprzedniej wysyłki. Wymagana ręczna kontrola.";
    wrap.append(warning);
  }
  return wrap;
}

function render(state) {
  lastState = state;
  populateForm(state.config);
  const snapshot = state.snapshot ?? {};
  const conversation = snapshot.conversation ?? {};
  const connected = state.tokenReady && snapshot.lastSync && !snapshot.lastError;
  $("connection").textContent = !state.config
    ? "Nie skonfigurowano"
    : !state.tokenReady
      ? "Podaj token"
      : connected ? "Połączony" : "Brak potwierdzenia połączenia";
  $("conversation-status").textContent = conversation.status === "stopped"
    ? "Rozmowa: STOP"
    : state.active ? "Rozmowa: aktywna" : "Rozmowa: nieaktywna";
  $("last-update").textContent = snapshot.lastSync
    ? `Ostatni odczyt: ${new Date(snapshot.lastSync).toLocaleTimeString("pl-PL")}`
    : "Brak odczytów skrzynki.";
  $("start").disabled = busy || !state.tokenReady || state.active ||
    conversation.status === "stopped" || Boolean(snapshot.remoteStopUnknown);
  $("sync").disabled = busy || !state.tokenReady;
  $("stop").disabled = busy || !state.config || (
    conversation.status === "stopped" && !snapshot.remoteStopUnknown
  );
  const received = Array.isArray(snapshot.messages) ? snapshot.messages : [];
  const inbox = $("inbox");
  inbox.replaceChildren();
  if (!received.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Brak nowych wiadomości.";
    inbox.append(empty);
  }
  for (const item of received) {
    inbox.append(addMessage(item, state.active));
  }
  const identity = state.config?.participant;
  const count = Number(conversation.message_count ?? 0);
  const sendAllowed = state.active && conversation.status === "open" &&
    (identity === "nina" ? count === 0 :
      identity === "jagoda" && count === 1 && Boolean(snapshot.lastInboundId));
  $("send").disabled = busy || !sendAllowed || (identity === "jagoda" && Boolean(state.chatgpt));
  $("bind-chatgpt").disabled = busy || !state.active || identity !== "jagoda" ||
    Boolean(state.bridgeJob) || Boolean(state.chatgpt);
  $("bind-current-chatgpt").disabled = $("bind-chatgpt").disabled;
  $("unbind-chatgpt").disabled = busy || !state.chatgpt || Boolean(state.bridgeJob);
  if (state.chatgpt && !$("chat-url").value) $("chat-url").value = state.chatgpt.chatUrl;
  $("chatgpt-status").textContent = state.bridgeJob
    ? `Zadanie ${state.bridgeJob.phase}: ${state.bridgeJob.error || state.bridgeJob.id}`
    : state.chatgpt
      ? `Przypięto kartę ${state.chatgpt.tabId}: ${state.chatgpt.chatUrl}`
      : "Brak przypiętej rozmowy. Otwórz wątek ChatGPT i kliknij »Przypnij aktywną kartę«. UUID Bridge to inne pole.";
  $("send-hint").textContent = identity === "jagoda"
    ? snapshot.lastInboundId
      ? `Odpowiedź na wiadomość: ${snapshot.lastInboundId}`
      : "Jagoda może odpowiedzieć, gdy odbierze wiadomość Niny."
    : "Nina może wysłać pierwszą wiadomość. Jagoda musi odpowiedzieć.";
  if (state.pendingSend) {
    $("send-hint").textContent += " ⚠ Poprzednia wysyłka niepewna: ponów identyczną treść.";
    // Allow retry with the same payload and idempotency key even if server accepted it.
    $("send").disabled = busy || !state.active;
  }
  if (snapshot.remoteStopUnknown) {
    tell(snapshot.lastError || "STOP na serwerze niepotwierdzony. Ponów STOP.", true);
  } else if (snapshot.lastError) {
    tell(snapshot.lastError, true);
  }
}

async function doAction(callback) {
  if (busy) return;
  setBusy(true);
  tell("");
  try {
    const state = await callback();
    if (state?.snapshot) {
      render(state);
    } else {
      render(await call("GET_STATUS"));
    }
  } catch (error) {
    tell(error.message || String(error), true);
    try { render(await call("GET_STATUS")); } catch { /* worker may be reloading */ }
  } finally {
    setBusy(false);
    if (lastState) render(lastState);
  }
}

$("config-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (busy) return;
  let config;
  try {
    config = normalizeConfig({
      serverUrl: $("server-url").value,
      participant: $("participant").value,
      conversationId: $("conversation-id").value,
    });
    if ($("token").value.trim().length < 32) {
      throw new Error("Wklej token uczestniczki (minimum 32 znaki).");
    }
  } catch (error) {
    tell(error.message, true);
    return;
  }
  // Local test hosts are granted in the manifest. Remote HTTPS requires
  // explicit consent, requested synchronously from the user's click.
  let permissionPromise;
  try {
    permissionPromise = config.serverUrl.startsWith("http://")
      ? Promise.resolve(true)
      : chrome.permissions.request({origins: [permissionOrigin(config.serverUrl)]});
  } catch (error) {
    tell(`Nie można poprosić o dostęp do serwera: ${error.message}`, true);
    return;
  }
  await doAction(async () => {
    const approved = await permissionPromise;
    if (!approved) throw new Error("Odmówiono rozszerzeniu dostępu do serwera.");
    const result = await call("CONFIGURE", {config, token: $("token").value});
    $("token").value = ""; // Never keep credentials in the visible popup.
    tell("Konfiguracja zapisana. Kliknij START, aby rozpocząć synchronizację.");
    return result;
  });
});

$("start").addEventListener("click", () => doAction(async () => {
  const result = await call("START");
  tell("Synchronizacja uruchomiona. Automatyczne sprawdzanie co około 30 sekund.");
  return result;
}));

$("sync").addEventListener("click", () => doAction(async () => {
  const result = await call("SYNC");
  tell("Skrzynka odświeżona.");
  return result.status;
}));

$("send-form").addEventListener("submit", event => {
  event.preventDefault();
  void doAction(async () => {
    const result = await call("SEND", {content: $("message").value});
    $("message").value = "";
    tell(result.duplicate
      ? "Wysyłka była już zapisana (idempotencja)."
      : "Wiadomość zapisana na serwerze.");
    return call("GET_STATUS");
  });
});

$("bind-current-chatgpt").addEventListener("click", () => void doAction(async () => {
  const result = await call("BIND_ACTIVE_CHATGPT");
  if (result.chatgpt?.chatUrl) $("chat-url").value = result.chatgpt.chatUrl;
  tell("Przypięłam aktualnie otwartą kartę ChatGPT. Adres powiązano z Jagodą.");
  return result;
}));

$("bind-chatgpt").addEventListener("click", () => void doAction(async () => {
  const result = await call("BIND_CHATGPT", {chatUrl: $("chat-url").value});
  tell("Przypięto dedykowaną rozmowę ChatGPT. Jagoda może odpowiedzieć na wiadomość Niny.");
  return result;
}));

$("unbind-chatgpt").addEventListener("click", () => void doAction(async () => {
  const result = await call("UNBIND_CHATGPT");
  tell("Odpięto rozmowę ChatGPT.");
  return result;
}));

$("stop").addEventListener("click", () => {
  if (!confirm("STOP zakończy całą rozmowę również na serwerze. Kontynuować?")) return;
  void doAction(async () => {
    const result = await call("STOP");
    tell(result.remoteStopped
      ? "Rozmowa zatrzymana lokalnie i na serwerze."
      : "Zatrzymano lokalnie. STOP na serwerze NIEPOTWIERDZONY, ponów później.",
      !result.remoteStopped);
    return call("GET_STATUS");
  });
});

// Keep an open popup in sync with worker polling; no extra server requests.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "session" && changes[SNAPSHOT_KEY] && !busy) {
    void call("GET_STATUS").then(render).catch(() => {});
  }
});

void doAction(() => call("GET_STATUS"));
