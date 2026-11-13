/* Isolated content script, installed programmatically in ONE bound conversation. */
(() => {
  // V2 uses distinct message names so an older content script lingering in
  // the same tab after an extension reload cannot answer our readiness check.
  if (globalThis.__JNB_CHAT_BRIDGE_V2__) return;
  globalThis.__JNB_CHAT_BRIDGE_V2__ = true;
  let running = false;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const normalize = text => String(text ?? "").replace(/\s+/g, " ").trim();
  function requireBound(url) {
    if (location.origin !== "https://chatgpt.com" ||
        location.origin + location.pathname.toLowerCase() !== url ||
        location.search || location.hash) {
      throw new Error("Karta nie jest przypiętą rozmową ChatGPT.");
    }
  }
  function visible(node) {
    return Boolean(node && node.isConnected && node.getClientRects().length &&
      getComputedStyle(node).visibility !== "hidden");
  }
  function editor() {
    // Prefer attributes specific to the MAIN ChatGPT composer. The newer
    // app-shell no longer always supplies #prompt-textarea. Never use a
    // completely unscoped .ProseMirror: edit-message boxes share that class.
    const selectors = [
      '#prompt-textarea[contenteditable="true"]',
      '#prompt-textarea[contenteditable="plaintext-only"]',
      'textarea#prompt-textarea',
      'textarea[name="prompt-textarea"]',
      'textarea#mobile-composer-prompt',
      '[data-testid="prompt-textarea"][contenteditable="true"]',
      'form[data-chatgpt-composer] [data-composer-markdown][contenteditable="true"][role="textbox"]',
      'form[data-chatgpt-composer] [data-composer-markdown][contenteditable="true"]',
      '[data-composer-input] [contenteditable="true"][role="textbox"]',
      '[data-composer-input] [contenteditable="true"]',
      'form[data-chatgpt-composer] [contenteditable="true"][role="textbox"]',
      'form[data-chatgpt-composer] textarea',
      '[data-composer-markdown][contenteditable="true"][role="textbox"]',
      '[data-composer-markdown][contenteditable="true"]',
      'form [data-testid="composer-input"][contenteditable="true"]',
    ];
    for (const selector of selectors) {
      const nodes = [...document.querySelectorAll(selector)]
        .filter(n => visible(n) && !n.closest('[role="dialog"],[aria-hidden="true"]') &&
          (n instanceof HTMLTextAreaElement || n.isContentEditable) &&
          n.getAttribute("aria-disabled") !== "true" && !n.hasAttribute("disabled"));
      if (nodes.length === 1) return nodes[0];
      if (nodes.length > 1) return null; // Ambiguous composer, fail closed.
    }
    return null;
  }
  function editorDiagnostics() {
    // Structural counts only. No text, URLs, titles, editor values or personal
    // content are ever included in diagnostics.
    const all = [...document.querySelectorAll('[contenteditable],textarea,[role="textbox"]')];
    const editable = all.filter(n => n.isContentEditable ||
      n instanceof HTMLTextAreaElement);
    return [
      "formularze=" + document.querySelectorAll('form[data-chatgpt-composer]').length,
      "composer=" + document.querySelectorAll('[data-composer-input],[data-composer-markdown]').length,
      "edytowalne=" + editable.length,
      "widoczne=" + editable.filter(visible).length,
      "iframe=" + document.querySelectorAll('iframe').length,
    ].join(", ");
  }
  const editorText = node => String(node?.value ?? node?.innerText ?? node?.textContent ?? "");
  function messages(role) {
    return [...document.querySelectorAll('[data-message-author-role="' + role + '"]')]
      .filter(visible);
  }
  function textOf(node) {
    if (!node) return "";
    if (node.getAttribute("data-message-author-role") === "user") {
      return node.querySelector(".whitespace-pre-wrap")?.textContent ??
        node.innerText ?? node.textContent ?? "";
    }
    const body = node.querySelector(".markdown, .prose") || node;
    return body.innerText || body.textContent || "";
  }
  function generating() {
    return [...document.querySelectorAll(
      'button[data-testid="stop-button"],button[aria-label*="Stop generating"],button[aria-label*="Zatrzymaj"]'
    )].some(visible);
  }
  function probe(url) {
    requireBound(url);
    const node = editor();
    if (!node) throw new Error("Nie rozpoznano głównego edytora ChatGPT (" +
      editorDiagnostics() + "). Sprawdź, czy rozmowa jest załadowana i czy nie ma otwartego okna dialogowego.");
    if (normalize(editorText(node))) throw new Error("Edytor zawiera tekst. Usuń go przed eksperymentem.");
    if (generating()) throw new Error("ChatGPT już generuje odpowiedź.");
    return {ready: true, url, assistantCount: messages("assistant").length};
  }
  async function probeWithWait(url) {
    const deadline = Date.now() + 5500;
    let lastError;
    while (Date.now() < deadline) {
      requireBound(url);
      try { return probe(url); }
      catch (error) {
        if (!String(error.message).startsWith("Nie rozpoznano głównego edytora")) {
          throw error;
        }
        lastError = error;
      }
      await sleep(220);
    }
    throw lastError || new Error("Edytor ChatGPT nie pojawił się w przewidzianym czasie.");
  }
  function insert(node, text) {
    node.focus();
    if (node instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(node, text);
      node.dispatchEvent(new Event("input", {bubbles: true}));
    } else if (node.isContentEditable) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(node);
      selection?.removeAllRanges();
      selection?.addRange(range);
      const okay = document.execCommand("insertText", false, text);
      if (!okay || normalize(editorText(node)) !== normalize(text)) {
        node.textContent = text;
        node.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText", data: text}));
      }
    }
    if (normalize(editorText(node)) !== normalize(text)) {
      throw new Error("Nie potwierdzono całego promptu w edytorze; nie wysłano.");
    }
  }
  async function send(node, prompt, beforeUsers, boundUrl) {
    const end = Date.now() + 7000;
    let button;
    while (Date.now() < end) {
      requireBound(boundUrl);
      button = [...document.querySelectorAll(
        'button[data-testid="send-button"],button[aria-label="Send prompt"],button[aria-label="Wyślij"]'
      )].find(b => visible(b) && !b.disabled && b.getAttribute("aria-disabled") !== "true");
      if (button) break;
      await sleep(150);
    }
    if (!button) throw new Error("Brak aktywnego przycisku wysyłania ChatGPT.");
    if (normalize(editorText(editor())) !== normalize(prompt)) {
      throw new Error("Zawartość edytora zmieniła się przed wysyłką.");
    }
    button.click();
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      requireBound(boundUrl);
      const latest = messages("user");
      if (latest.length > beforeUsers &&
          latest.slice(beforeUsers).some(n => normalize(textOf(n)) === normalize(prompt))) return;
      await sleep(250);
    }
    throw new Error("Nie udało się potwierdzić wysłanej wiadomości w ChatGPT; nie ponawiaj automatycznie.");
  }
  async function awaitResponse(boundUrl, assistantCount) {
    const deadline = Date.now() + 150000;
    let previous = "", lastChanged = Date.now();
    let firstSeen = null;
    while (Date.now() < deadline) {
      requireBound(boundUrl);
      const nodes = messages("assistant");
      // Never read older assistant replies. Virtualization that hides existing
      // nodes is considered uncertain and must not silently return old content.
      if (nodes.length > assistantCount) {
        const text = String(textOf(nodes[nodes.length - 1])).trim();
        if (text !== previous) {previous = text; lastChanged = Date.now();}
        if (text) firstSeen ??= Date.now();
        if (text && firstSeen && Date.now() - firstSeen > 2000 &&
            Date.now() - lastChanged > 1400 && !generating()) {
          return text;
        }
      }
      await sleep(350);
    }
    throw new Error("Nie potwierdzono zakończenia nowej odpowiedzi ChatGPT; wymagana ręczna kontrola.");
  }
  async function run(job) {
    if (running) throw new Error("Ten wątek ma już aktywny przebieg.");
    running = true;
    try {
      const baseline = await probeWithWait(job.chatUrl);
      if (!job.jobId || !job.prompt || String(job.prompt).length > 6000) {
        throw new Error("Błędny format zadania.");
      }
      const node = editor();
      const userCount = messages("user").length;
      insert(node, job.prompt);
      await send(node, job.prompt, userCount, job.chatUrl);
      const content = await awaitResponse(job.chatUrl, baseline.assistantCount);
      return {content};
    } finally { running = false; }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type === "JNB_PROBE_V2") {
      void probeWithWait(message.chatUrl).then(
        result => respond({ok:true, result}),
        error => respond({ok:false,error:String(error.message).slice(0,320)}),
      );
      return true;
    }
    if (message?.type === "JNB_RUN_V2") {
      if (running) {
        respond({ok:false,error:"Przebieg już trwa."});
        return false;
      }
      // Start without holding a worker request open throughout generation.
      // The server records dispatch-start before this message is emitted.
      respond({ok:true, started:true});
      void run(message).then(
        value => chrome.runtime.sendMessage({
          type:"JNB_BRIDGE_RESULT", jobId:message.jobId, result:value.content,
        }),
        error => chrome.runtime.sendMessage({
          type:"JNB_BRIDGE_ERROR", jobId:message.jobId,
          error:String(error?.message ?? error).slice(0,300),
        }),
      ).catch(() => { /* Worker invalidated: manual recovery is required. */ });
      return false;
    }
    return false;
  });
})();
