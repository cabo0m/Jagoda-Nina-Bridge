import {ACTIVE_KEY, ALARM_NAME, normalizeConfig, permissionOrigin, SNAPSHOT_KEY} from "./bridge-core.mjs";

const $ = id => document.getElementById(id);
let lastState = null;
let busy = false;
let stopping = false;
let initialFormLoaded = false;

function tell(text, isError = false) {
  const target = $("notice");
  target.textContent = text;
  target.dataset.error = isError ? "true" : "false";
}

function setBusy(value) {
  busy = value;
  // Emergency STOP must never be disabled by a concurrent operation.
  for (const id of ["save", "recover-local", "use-current", "start", "sync", "send", "bind-chatgpt", "bind-current-chatgpt", "bind-selected-chatgpt", "unbind-chatgpt"]) {
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
  if (!config) return;
  if (initialFormLoaded) {
    if (document.activeElement !== $("conversation-id")) {
      $("conversation-id").value = config.conversationId;
    }
    return;
  }
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
  $("use-current").disabled = busy || !state.tokenReady || state.active;
  $("start").disabled = busy || !state.tokenReady || state.active ||
    conversation.status === "stopped" || Boolean(snapshot.remoteStopUnknown);
  $("sync").disabled = busy || !state.tokenReady;
  $("recover-local").disabled = busy || !state.config || state.tokenReady ||
    state.config.participant !== "jagoda" || state.config.serverUrl !== "http://127.0.0.1:8765";
  $("stop").disabled = stopping || (
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
  $("bind-selected-chatgpt").disabled = $("bind-chatgpt").disabled;
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

$("use-current").addEventListener("click", () => void doAction(async () => {
  const result = await call("USE_CURRENT_CONVERSATION");
  tell("Nowa rozmowa Bridge aktywna. Token zachowany. Możesz przypiąć kartę ChatGPT.");
  return result;
}));

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

function chatFeedback(text, isError = false, pending = false) {
  const node = $("chatgpt-feedback");
  node.textContent = text;
  node.dataset.error = String(isError);
  node.dataset.busy = String(pending);
}

function showChatTabChoices(candidates) {
  const select = $("chatgpt-tab-choice");
  select.replaceChildren();
  for (const tab of candidates) {
    const option = document.createElement("option");
    option.value = String(tab.tabId);
    const threadId = String(tab.chatUrl).split("/").pop().slice(0, 8);
    option.textContent = `Wątek ${threadId}… · karta ${tab.tabId}${tab.active ? " · aktywna" : ""}`;
    select.append(option);
  }
  $("chatgpt-choices").hidden = !candidates.length;
}

async function bindWithFeedback(type, payload = {}) {
  if (busy) {
    chatFeedback("Trwa inna operacja panelu. Poczekaj na jej zakończenie.", true);
    return;
  }
  setBusy(true);
  chatFeedback("Sprawdzam otwarte karty i gotowość edytora ChatGPT…", false, true);
  try {
    const result = await call(type, payload);
    if (result?.selectionRequired && Array.isArray(result.candidates)) {
      showChatTabChoices(result.candidates);
      chatFeedback(`Znalazłam ${result.candidates.length} otwarte wątki. Wybierz właściwy z listy i kliknij „Przypnij wybraną kartę”.`);
    } else {
      const state = result?.snapshot ? result : await call("GET_STATUS");
      render(state);
      if (!state.chatgpt) {
        throw new Error("Brak potwierdzenia przypięcia w stanie rozszerzenia.");
      }
      $("chat-url").value = state.chatgpt.chatUrl;
      $("chatgpt-choices").hidden = true;
      chatFeedback("Przypięto wątek ChatGPT. Powiązanie z Bridge jest aktywne.");
    }
  } catch (error) {
    chatFeedback("Nie przypięto: " + String(error?.message || error).slice(0, 320), true);
    try { render(await call("GET_STATUS")); }
    catch { /* Keep the visible error when the worker is unavailable. */ }
  } finally {
    setBusy(false);
    if (lastState) render(lastState);
  }
}

$("bind-current-chatgpt").addEventListener("click", () =>
  void bindWithFeedback("BIND_ACTIVE_CHATGPT"));

$("bind-selected-chatgpt").addEventListener("click", () =>
  void bindWithFeedback("BIND_SELECTED_CHATGPT", {
    tabId: Number($("chatgpt-tab-choice").value),
  }));

$("bind-chatgpt").addEventListener("click", () =>
  void bindWithFeedback("BIND_CHATGPT", {chatUrl: $("chat-url").value}));

$("unbind-chatgpt").addEventListener("click", () => void doAction(async () => {
  const result = await call("UNBIND_CHATGPT");
  tell("Odpięto rozmowę ChatGPT.");
  return result;
}));

$("recover-local").addEventListener("click", () => void doAction(async () => {
  const result = await call("RECOVER_LOCAL_TOKEN");
  tell("Token Jagody przywrócony z hosta. START nie został uruchomiony.");
  return result;
}));

$("stop").addEventListener("click", async () => {
  if (stopping) return;
  stopping = true;
  $("stop").disabled = true;
  tell("STOP: zatrzymuję lokalnie i wysyłam żądanie do serwera...");
  // First shut down polling in the local extension context, even if
  // the background worker is busy, disconnected or restarting.
  try {
    await chrome.storage.local.set({[ACTIVE_KEY]: false});
    await chrome.alarms.clear(ALARM_NAME);
    const result = await call("STOP");
    tell(result.remoteStopped
      ? "STOP POTWIERDZONY: rozmowa zatrzymana lokalnie i na serwerze."
      : "STOP LOKALNY. Serwer nie potwierdził zatrzymania. Ponów STOP po odzyskaniu połączenia.",
      !result.remoteStopped);
  } catch (error) {
    tell("STOP LOKALNY. Nie udało się potwierdzić serwera: " +
      String(error?.message || error).slice(0, 210) + ". Ponów STOP.", true);
  } finally {
    stopping = false;
    $("stop").disabled = false;
    try {
      render(await call("GET_STATUS"));
    } catch {
      // Preserve the visible emergency-stop error if the worker is unavailable.
    }
  }
});

// Keep an open popup in sync with worker polling; no extra server requests.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "session" && changes[SNAPSHOT_KEY] && !busy) {
    void call("GET_STATUS").then(render).catch(() => {});
  }
});

void doAction(() => call("GET_STATUS"));
