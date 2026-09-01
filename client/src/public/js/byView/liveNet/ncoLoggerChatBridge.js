(() => {
  "use strict";

  let boundChat = null;
  let boundConnection = null;
  let messageHandler = null;
  let observer = null;
  let slashChat = null;
  let slashAbort = null;
  let slashObserver = null;
  let originalExecuteSlashDescriptor = null;
  let slashEnabled = false;
  let slashEnterHandled = false;
  let attachQueued = false;
  const renderedMessageNodes = new Map();

  const slashComposer = chat => chat?.querySelector(
    ".chat-text-input, .chat-message-input, .chat-input, textarea[placeholder^='Message'], input[placeholder^='Message'], [contenteditable='true'][role='textbox']"
  );
  const composerText = input => {
    if (!input || (typeof input !== "object" && typeof input !== "function")) return "";
    return String("value" in input ? input.value ?? "" : input.textContent || "");
  };

  function suppressNativeSlashUi(chat) {
    const input = slashComposer(chat);
    if (!composerText(input).trimStart().startsWith("/")) return;
    chat?.querySelectorAll(".chat-slash-dropdown").forEach(element => element.remove());
  }

  function dispatchSlash(chat, text, source) {
    const raw = String(text || "");
    if (!raw.trimStart().startsWith("/")) return false;
    document.dispatchEvent(new CustomEvent("nch-helper-slash-command", {
      detail: JSON.stringify({ text: raw, source })
    }));
    return true;
  }

  function disableSlashBridge() {
    slashAbort?.abort();
    slashAbort = null;
    slashObserver?.disconnect();
    slashObserver = null;
    slashEnterHandled = false;
    if (slashChat) {
      slashChat.classList.remove("nch-helper-slash-owned");
      if (originalExecuteSlashDescriptor) Object.defineProperty(slashChat, "executeSlashCommand", originalExecuteSlashDescriptor);
      else delete slashChat.executeSlashCommand;
    }
    slashChat = null;
    originalExecuteSlashDescriptor = null;
  }

  function bindSlashBridge() {
    if (!slashEnabled) return disableSlashBridge();
    const chat = document.querySelector("hl-chat");
    if (!chat || chat === slashChat) return;
    disableSlashBridge();
    slashChat = chat;
    chat.classList.add("nch-helper-slash-owned");
    slashAbort = new AbortController();
    const options = { capture: true, signal: slashAbort.signal };
    slashObserver = new MutationObserver(() => suppressNativeSlashUi(chat));
    slashObserver.observe(chat, { childList: true, subtree: true });
    const blockSlashSubmission = event => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      suppressNativeSlashUi(chat);
    };
    const intercept = (event, source) => {
      const input = slashComposer(chat);
      if (!input || !dispatchSlash(chat, composerText(input), source)) return false;
      blockSlashSubmission(event);
      return true;
    };
    chat.addEventListener("input", () => queueMicrotask(() => suppressNativeSlashUi(chat)), options);
    chat.addEventListener("keydown", event => {
      const input = slashComposer(chat);
      if (!input || !event.composedPath().includes(input)) return;
      const slash = composerText(input).trimStart().startsWith("/");
      if (slash && event.key === "Tab") {
        event.stopPropagation();
        event.stopImmediatePropagation();
        chat.querySelectorAll(".chat-slash-dropdown").forEach(element => element.remove());
        return;
      }
      if (event.key !== "Enter" || event.shiftKey || event.isComposing || !slash) return;
      if (event.repeat) {
        blockSlashSubmission(event);
        return;
      }
      slashEnterHandled = intercept(event, "enter");
    }, options);
    chat.addEventListener("keypress", event => {
      const input = slashComposer(chat);
      const slash = Boolean(input && composerText(input).trimStart().startsWith("/"));
      if (event.key !== "Enter" || event.shiftKey || event.isComposing || !slash) return;
      if (event.repeat || slashEnterHandled) {
        blockSlashSubmission(event);
        return;
      }
      slashEnterHandled = intercept(event, "keypress");
    }, options);
    chat.addEventListener("keyup", event => {
      if (event.key === "Enter") slashEnterHandled = false;
    }, options);
    chat.addEventListener("click", event => {
      if (event.composedPath().some(node => node?.matches?.(".chat-send-btn"))) intercept(event, "send");
    }, options);
    chat.addEventListener("submit", event => intercept(event, "submit"), options);
    originalExecuteSlashDescriptor = Object.getOwnPropertyDescriptor(chat, "executeSlashCommand");
    Object.defineProperty(chat, "executeSlashCommand", {
      configurable: true,
      writable: true,
      value(cmdLine, textInput) {
        const input = textInput || slashComposer(chat);
        const inputText = composerText(input);
        const commandText = String(cmdLine ?? "");
        const raw = inputText.trimStart().startsWith("/")
          ? inputText
          : commandText.trimStart().startsWith("/") ? commandText : `/${commandText}`;
        dispatchSlash(chat, raw, "native-execute");
        return Promise.resolve();
      }
    });
    suppressNativeSlashUi(chat);
  }

  const messageNodes = root => {
    if (!(root instanceof Element)) return [];
    return [
      ...(root.matches("[data-message-id]") ? [root] : []),
      ...root.querySelectorAll("[data-message-id]")
    ];
  };

  function removeMessageNodes(root) {
    messageNodes(root).forEach(node => {
      const id = String(node.dataset.messageId || "");
      if (id && renderedMessageNodes.get(id) === node) renderedMessageNodes.delete(id);
    });
  }

  function addMessageNodes(root) {
    messageNodes(root).forEach(node => {
      const id = String(node.dataset.messageId || "");
      if (!id) return;
      const existing = renderedMessageNodes.get(id);
      if (existing?.isConnected && existing !== node) node.remove();
      else renderedMessageNodes.set(id, node);
    });
  }

  function deduplicateNativeChat(records = null) {
    if (!boundChat) return;
    if (Array.isArray(boundChat.messages)) {
      const seen = new Set();
      boundChat.messages = boundChat.messages.filter(message => {
        const id = String(message?.id || "");
        if (!id) return true;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    }
    if (!Array.isArray(records)) {
      renderedMessageNodes.clear();
      addMessageNodes(boundChat);
      return;
    }
    records.forEach(record => record.removedNodes.forEach(removeMessageNodes));
    records.forEach(record => record.addedNodes.forEach(addMessageNodes));
  }

  function detach() {
    if (boundConnection && messageHandler) boundConnection.off?.("message.new", messageHandler);
    observer?.disconnect();
    renderedMessageNodes.clear();
    boundChat = null;
    boundConnection = null;
    messageHandler = null;
    observer = null;
  }

  function attach() {
    const chat = document.querySelector("hl-chat");
    if (slashEnabled) bindSlashBridge();
    const connection = chat?.connection;
    if (!chat || !connection?.on) {
      if (boundChat && boundChat !== chat) detach();
      return;
    }
    if (chat === boundChat && connection === boundConnection) return;
    detach();
    boundChat = chat;
    boundConnection = connection;
    messageHandler = () => queueMicrotask(deduplicateNativeChat);
    connection.on("message.new", messageHandler);
    observer = new MutationObserver(deduplicateNativeChat);
    observer.observe(chat, { childList: true, subtree: true });
    deduplicateNativeChat();
    bindSlashBridge();
  }

  function queueAttach() {
    if (attachQueued) return;
    attachQueued = true;
    queueMicrotask(() => {
      attachQueued = false;
      attach();
    });
  }

  document.addEventListener("nch-helper-slash-enable", () => {
    slashEnabled = true;
    bindSlashBridge();
  });
  document.addEventListener("nch-helper-slash-disable", () => {
    slashEnabled = false;
    disableSlashBridge();
  });

  const attachObserver = new MutationObserver(queueAttach);
  attachObserver.observe(document.documentElement, { childList: true, subtree: true });
  attach();
  window.addEventListener("beforeunload", () => {
    attachObserver.disconnect();
    slashEnabled = false;
    disableSlashBridge();
    detach();
  }, { once: true });
})();

export {};
