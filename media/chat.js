const vscode = acquireVsCodeApi();

const elements = {
  conversation: document.getElementById("conversation"),
  emptyState: document.getElementById("empty-state"),
  messageList: document.getElementById("message-list"),
  prompt: document.getElementById("prompt"),
  send: document.getElementById("send"),
  stop: document.getElementById("stop"),
  newChat: document.getElementById("new-chat"),
  settings: document.getElementById("settings"),
  chatMode: document.getElementById("chat-mode"),
  providerSettings: document.getElementById("provider-settings"),
  providerName: document.getElementById("provider-name"),
  providerModel: document.getElementById("provider-model"),
  providerEndpoint: document.getElementById("provider-endpoint"),
  statusDot: document.getElementById("status-dot"),
  apiKey: document.getElementById("api-key"),
  keyDot: document.getElementById("key-dot"),
  keyLabel: document.getElementById("key-label"),
  errorBanner: document.getElementById("error-banner"),
  errorText: document.getElementById("error-text"),
  errorSettings: document.getElementById("error-settings"),
};

const state = {
  messages: [],
  isGenerating: false,
  configuration: undefined,
};

window.addEventListener("message", (event) => {
  const message = event.data;
  if (message?.type === "state") {
    state.messages = Array.isArray(message.messages) ? message.messages : [];
    state.isGenerating = Boolean(message.isGenerating);
    state.configuration = message.configuration;
    renderAll(message.error);
  } else if (message?.type === "messageDelta" && typeof message.delta === "string") {
    applyDelta(message.id, message.delta);
  }
});

elements.prompt.addEventListener("input", () => {
  resizePrompt();
  updateComposer();
});

elements.prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    sendPrompt();
  }
});

elements.send.addEventListener("click", sendPrompt);
elements.stop.addEventListener("click", () => vscode.postMessage({ type: "stop" }));
elements.newChat.addEventListener("click", () => vscode.postMessage({ type: "newChat" }));
elements.settings.addEventListener("click", openSettings);
elements.providerSettings.addEventListener("click", () =>
  vscode.postMessage({ type: "selectProvider" }),
);
elements.errorSettings.addEventListener("click", openSettings);
elements.apiKey.addEventListener("click", () => vscode.postMessage({ type: "setApiKey" }));

for (const suggestion of document.querySelectorAll(".suggestion")) {
  suggestion.addEventListener("click", () => {
    elements.prompt.value = suggestion.dataset.prompt ?? "";
    resizePrompt();
    updateComposer();
    elements.prompt.focus();
  });
}

function sendPrompt() {
  const content = elements.prompt.value.trim();
  if (!content || state.isGenerating) {
    return;
  }

  vscode.postMessage({ type: "send", content });
  elements.prompt.value = "";
  resizePrompt();
  updateComposer();
}

function openSettings() {
  vscode.postMessage({ type: "openSettings" });
}

function renderAll(error) {
  elements.messageList.replaceChildren();
  elements.emptyState.hidden = state.messages.length > 0;

  for (const message of state.messages) {
    elements.messageList.appendChild(renderMessage(message));
  }

  renderConfiguration();
  renderError(error);
  updateComposer();
  if (state.messages.length > 0) {
    scrollToBottom();
  } else {
    elements.conversation.scrollTop = 0;
  }
}

function renderMessage(message) {
  const article = document.createElement("article");
  article.className = `message ${message.role}`;
  article.dataset.messageId = message.id;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = message.role === "assistant" ? "H" : "You";

  const main = document.createElement("div");
  main.className = "message-main";

  const meta = document.createElement("div");
  meta.className = "message-meta";

  const author = document.createElement("span");
  author.className = "message-author";
  author.textContent = message.role === "assistant" ? "Hyperion" : "You";
  meta.appendChild(author);

  if (message.content) {
    const copy = document.createElement("button");
    copy.className = "copy-button";
    copy.type = "button";
    copy.textContent = "Copy";
    copy.addEventListener("click", () => {
      vscode.postMessage({ type: "copy", content: message.content });
      copy.textContent = "Copied";
      window.setTimeout(() => (copy.textContent = "Copy"), 1200);
    });
    meta.appendChild(copy);
  }

  const content = document.createElement("div");
  content.className = "message-content";
  renderMessageContent(content, message);

  main.append(meta, content);
  article.append(avatar, main);
  return article;
}

function renderMessageContent(container, message) {
  container.replaceChildren();
  if (!message.content && message.role === "assistant" && state.isGenerating) {
    const typing = document.createElement("div");
    typing.className = "typing";
    typing.setAttribute("aria-label", "Generating response");
    typing.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
    container.appendChild(typing);
    return;
  }

  appendFormattedContent(container, message.content);
}

function appendFormattedContent(container, content) {
  const fence = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match;

  while ((match = fence.exec(content)) !== null) {
    appendText(container, content.slice(cursor, match.index));
    appendCode(container, match[2], match[1].trim());
    cursor = match.index + match[0].length;
  }

  appendText(container, content.slice(cursor));
}

function appendText(container, content) {
  if (!content) {
    return;
  }
  const text = document.createElement("div");
  text.className = "message-text";
  text.textContent = content;
  container.appendChild(text);
}

function appendCode(container, content, language) {
  const block = document.createElement("div");
  block.className = "code-block";

  const header = document.createElement("div");
  header.className = "code-header";
  const label = document.createElement("span");
  label.textContent = language || "code";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy code";
  copy.addEventListener("click", () => {
    vscode.postMessage({ type: "copy", content });
    copy.textContent = "Copied";
    window.setTimeout(() => (copy.textContent = "Copy code"), 1200);
  });
  header.append(label, copy);

  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = content;
  pre.appendChild(code);
  block.append(header, pre);
  container.appendChild(block);
}

function applyDelta(id, delta) {
  const message = state.messages.find((candidate) => candidate.id === id);
  if (!message) {
    return;
  }

  const shouldFollow = isNearBottom();
  message.content += delta;
  const article = [...elements.messageList.children].find(
    (candidate) => candidate.dataset.messageId === id,
  );
  if (!article) {
    elements.messageList.appendChild(renderMessage(message));
  } else {
    renderMessageContent(article.querySelector(".message-content"), message);
  }
  if (shouldFollow) {
    scrollToBottom();
  }
}

function renderConfiguration() {
  const configuration = state.configuration;
  if (!configuration) {
    return;
  }

  elements.providerModel.textContent = configuration.model || "No model selected";
  elements.providerName.textContent = configuration.providerLabel;
  elements.providerEndpoint.textContent = endpointLabel(configuration.apiBaseUrl);
  elements.chatMode.textContent = `${configuration.providerLabel} chat`;
  elements.statusDot.classList.toggle("configured", Boolean(configuration.hasApiKey));
  elements.keyDot.classList.toggle("configured", Boolean(configuration.hasApiKey));
  elements.keyLabel.textContent = configuration.hasApiKey
    ? `${configuration.providerLabel} key saved`
    : `Set ${configuration.providerLabel} key`;
  elements.apiKey.title = configuration.hasApiKey
    ? "Replace or remove the saved API key"
    : "Set API key";
}

function endpointLabel(value) {
  try {
    const url = new URL(value);
    return url.host;
  } catch {
    return value;
  }
}

function renderError(error) {
  const visible = typeof error === "string" && error.length > 0;
  elements.errorBanner.hidden = !visible;
  elements.errorText.textContent = visible ? error : "";
}

function updateComposer() {
  const hasContent = elements.prompt.value.trim().length > 0;
  elements.send.disabled = !hasContent || state.isGenerating;
  elements.send.hidden = state.isGenerating;
  elements.stop.hidden = !state.isGenerating;
  elements.prompt.disabled = false;
}

function resizePrompt() {
  elements.prompt.style.height = "auto";
  elements.prompt.style.height = `${Math.min(elements.prompt.scrollHeight, 150)}px`;
}

function isNearBottom() {
  return (
    elements.conversation.scrollHeight -
      elements.conversation.scrollTop -
      elements.conversation.clientHeight <
    90
  );
}

function scrollToBottom() {
  elements.conversation.scrollTop = elements.conversation.scrollHeight;
}

updateComposer();
