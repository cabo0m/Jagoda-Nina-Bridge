/** Pure validation and protocol helpers. No Chrome API, DOM or network calls. */
export const POLL_MINUTES = 0.5;
export const ALARM_NAME = "jnb.inbox";
export const CONFIG_KEY = "jnb.config";
export const ACTIVE_KEY = "jnb.active";
export const TOKEN_KEY = "jnb.token";
export const SNAPSHOT_KEY = "jnb.snapshot";
export const OUTGOING_KEY = "jnb.outgoing";
export const LEASES_KEY = "jnb.leases";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateUuid(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error("Nieprawidłowy UUID rozmowy lub wiadomości.");
  }
  return value.toLowerCase();
}

export function normalizeServerUrl(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("Podaj adres serwera.");
  }
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Nieprawidłowy adres URL serwera.");
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (!(url.protocol === "https:" || (url.protocol === "http:" && local))) {
    throw new Error("Wymagany HTTPS. HTTP działa wyłącznie na localhost/127.0.0.1.");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Wpisz sam adres serwera (bez ścieżki, hasła i parametrów).");
  }
  return url.origin;
}

export function permissionOrigin(serverUrl) {
  // Chrome match patterns cannot contain ports; permissions are host+scheme scoped.
  const url = new URL(normalizeServerUrl(serverUrl));
  return `${url.protocol}//${url.hostname}/*`;
}

export function normalizeConfig(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Brak konfiguracji.");
  }
  if (value.participant !== "nina" && value.participant !== "jagoda") {
    throw new Error("Wybierz uczestniczkę: Nina lub Jagoda.");
  }
  return {
    serverUrl: normalizeServerUrl(value.serverUrl),
    conversationId: validateUuid(value.conversationId),
    participant: value.participant,
  };
}

export function validateToken(value) {
  if (typeof value !== "string" || value.trim().length < 32 || value.trim().length > 512) {
    throw new Error("Token uczestniczki powinien zawierać 32–512 znaków.");
  }
  return value.trim();
}

export function outgoingMessage(config, content, replyToId, idempotencyKey) {
  const {participant} = normalizeConfig(config);
  const message = String(content ?? "").trim();
  if (!message || message.length > 4000) {
    throw new Error("Treść wiadomości powinna mieć 1–4000 znaków.");
  }
  const recipient_id = participant === "nina" ? "jagoda" : "nina";
  const reply_to_id = participant === "jagoda" ? validateUuid(replyToId) : null;
  if (!UUID_PATTERN.test(idempotencyKey ?? "")) {
    throw new Error("Nieprawidłowy klucz idempotencji.");
  }
  return {
    recipient_id,
    content: message,
    reply_to_id,
    idempotency_key: idempotencyKey,
  };
}

export function outboundMatches(left, right) {
  return Boolean(left && right &&
    left.recipient_id === right.recipient_id &&
    left.content === right.content &&
    left.reply_to_id === right.reply_to_id);
}

export function extractProblem(value, code) {
  if (typeof value?.detail === "string" && value.detail.trim()) {
    return `HTTP ${code}: ${value.detail.slice(0, 250)}`;
  }
  return `Błąd serwera HTTP ${code}.`;
}

export function publicMessage(message) {
  // Strict field selection; never forward arbitrary server properties or credentials.
  return {
    id: validateUuid(message.id),
    sender_id: message.sender_id === "jagoda" ? "jagoda" : "nina",
    content: String(message.content ?? "").slice(0, 4000),
    status: String(message.status ?? "").slice(0, 30),
    reply_to_id: message.reply_to_id ? validateUuid(message.reply_to_id) : null,
    created_at: String(message.created_at ?? "").slice(0, 40),
  };
}
