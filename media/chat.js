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
  optimizationOptions: document.querySelectorAll(".optimization-option"),
  historyList: document.getElementById("history-list"),
  toggleHistory: document.getElementById("toggle-history"),
  contextPane: document.getElementById("context-pane"),
  contextToggle: document.getElementById("context-toggle"),
  closeContext: document.getElementById("close-context"),
  promptContext: document.getElementById("context-system-prompt"),
  contextMessageCount: document.getElementById("context-message-count"),
  contextProviderName: document.getElementById("context-provider-name"),
  attachmentTray: document.getElementById("attachment-tray"),
  attach: document.getElementById("attach"),
  fileInput: document.getElementById("file-input"),
  settingsPage: document.getElementById("settings-page"),
  composerWrap: document.getElementById("composer-wrap"),
  settingsKey: document.getElementById("settings-key"),
  saveSettings: document.getElementById("save-settings"),
  settingModel: document.getElementById("setting-model"),
  settingSystemPrompt: document.getElementById("setting-system-prompt"),
  settingTimeout: document.getElementById("setting-timeout"),
  settingThinking: document.getElementById("setting-thinking"),
  settingWorkspaceContext: document.getElementById("setting-workspace-context"),
};

const state = {
  messages: [],
  isGenerating: false,
  configuration: undefined,
  activity: "",
  history: [],
  attachments: [],
  view: "chat",
};

window.addEventListener("message", (event) => {
  const message = event.data;
  if (message?.type === "state") {
    state.messages = Array.isArray(message.messages) ? message.messages : [];
    state.isGenerating = Boolean(message.isGenerating);
    state.configuration = message.configuration;
    state.history = Array.isArray(message.history) ? message.history : [];
    if (!state.isGenerating) {
      state.activity = "";
    }
    renderAll(message.error);
  } else if (message?.type === "messageDelta" && typeof message.delta === "string") {
    applyDelta(message.id, message.delta);
  } else if (message?.type === "agentActivity" && typeof message.message === "string") {
    state.activity = message.message;
    renderConfiguration();
  } else if (message?.type === "thinkingDelta" && typeof message.delta === "string") {
    applyThinkingDelta(message.id, message.delta);
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
elements.settings.addEventListener("click", () => state.view === "settings" ? showChat() : openSettings());
elements.contextToggle.addEventListener("click", () => { elements.contextPane.hidden = !elements.contextPane.hidden; });
elements.closeContext.addEventListener("click", () => { elements.contextPane.hidden = true; });
elements.toggleHistory.addEventListener("click", () => {
  const show = elements.historyList.hidden;
  elements.historyList.hidden = !show;
  elements.toggleHistory.textContent = show ? "Hide history" : "Show history";
});
elements.providerSettings.addEventListener("click", () =>
  vscode.postMessage({ type: "selectProvider" }),
);
elements.errorSettings.addEventListener("click", openSettings);
elements.apiKey.addEventListener("click", () => vscode.postMessage({ type: "setApiKey" }));
elements.settingsKey.addEventListener("click", () => vscode.postMessage({ type: "setApiKey" }));
elements.attach.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", () => {
  void addFiles(elements.fileInput.files);
  elements.fileInput.value = "";
});
elements.saveSettings.addEventListener("click", saveSettings);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.view === "settings") showChat();
});

for (const option of elements.optimizationOptions) {
  option.addEventListener("click", () => {
    if (!state.isGenerating) {
      vscode.postMessage({ type: "setOptimizationMode", mode: option.dataset.optimizationMode });
    }
  });
}

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
  if ((!content && !state.attachments.length) || state.isGenerating) {
    return;
  }

  vscode.postMessage({ type: "send", content, attachments: state.attachments });
  elements.prompt.value = "";
  state.attachments = [];
  renderAttachments();
  resizePrompt();
  updateComposer();
}

function openSettings() {
  state.view = "settings";
  elements.settingsPage.hidden = false;
  elements.messageList.hidden = true;
  elements.emptyState.hidden = true;
  elements.composerWrap.hidden = true;
  renderConfiguration();
}

function showChat() {
  state.view = "chat";
  elements.settingsPage.hidden = true;
  elements.messageList.hidden = false;
  elements.composerWrap.hidden = false;
  elements.emptyState.hidden = state.messages.length > 0 || state.view !== "chat";
}

function renderAll(error) {
  elements.messageList.replaceChildren();
  elements.emptyState.hidden = state.messages.length > 0;

  for (const message of state.messages) {
    elements.messageList.appendChild(renderMessage(message));
  }

  renderConfiguration();
  renderHistory();
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

  const main = document.createElement("div");
  main.className = "message-main";

  if (message.role === "assistant") {
    main.appendChild(renderWorkSummary(message));
  }

  const meta = document.createElement("div");
  meta.className = "message-meta";

  const author = document.createElement("span");
  author.className = "message-author";
  author.textContent = "You";
  meta.appendChild(author);

  if (message.role === "user" && message.content) {
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
  if (Array.isArray(message.attachments) && message.attachments.length) {
    content.appendChild(renderMessageAttachments(message.attachments));
  }
  const body = document.createElement("div");
  body.className = "message-body";
  renderMessageContent(body, message);
  content.appendChild(body);

  if (message.role === "user") {
    main.appendChild(meta);
  }
  main.appendChild(content);
  article.appendChild(main);
  return article;
}

function renderMessageAttachments(attachments) {
  const list = document.createElement("div");
  list.className = "message-attachments";
  for (const attachment of attachments) {
    const item = document.createElement("div");
    item.className = `message-attachment ${attachment.kind === "image" ? "image" : ""}`;
    if (attachment.kind === "image" && attachment.dataUrl) {
      const image = document.createElement("img");
      image.src = attachment.dataUrl;
      image.alt = attachment.name;
      item.appendChild(image);
    } else item.textContent = attachment.name;
    list.appendChild(item);
  }
  return list;
}

function renderWorkSummary(message) {
  const showTrace = Boolean(message.thinking && state.configuration?.showThinking);
  const container = document.createElement(showTrace ? "details" : "div");
  container.className = "work-summary";
  const header = document.createElement(showTrace ? "summary" : "div");
  header.className = "work-summary-header";

  const label = document.createElement("span");
  label.className = "work-summary-label";
  label.dataset.messageId = message.id;
  label.dataset.startedAt = String(message.createdAt);
  label.textContent = workSummaryLabel(message);
  header.appendChild(label);

  if (showTrace) {
    const chevron = document.createElement("span");
    chevron.className = "work-summary-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "›";
    header.appendChild(chevron);
  }

  if (message.content) {
    const copy = document.createElement("button");
    copy.className = "copy-button work-copy";
    copy.type = "button";
    copy.textContent = "Copy";
    copy.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      vscode.postMessage({ type: "copy", content: message.content });
      copy.textContent = "Copied";
      window.setTimeout(() => (copy.textContent = "Copy"), 1200);
    });
    header.appendChild(copy);
  }

  container.appendChild(header);
  if (showTrace) {
    const trace = document.createElement("div");
    trace.className = "work-trace";
    const traceLabel = document.createElement("span");
    traceLabel.textContent = "Reasoning trace";
    const pre = document.createElement("pre");
    pre.textContent = message.thinking;
    trace.append(traceLabel, pre);
    container.appendChild(trace);
  }
  return container;
}

function workSummaryLabel(message) {
  const active = state.isGenerating && lastAssistantMessageId() === message.id;
  if (!active && !Number.isFinite(message.durationMs)) {
    return "Worked";
  }
  const duration = Number.isFinite(message.durationMs)
    ? message.durationMs
    : Math.max(0, Date.now() - message.createdAt);
  return `${active ? "Working for" : "Worked for"} ${formatDuration(duration)}`;
}

function formatDuration(durationMs) {
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function lastAssistantMessageId() {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    if (state.messages[index].role === "assistant") return state.messages[index].id;
  }
  return undefined;
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
    renderMessageContent(article.querySelector(".message-body"), message);
  }
  if (shouldFollow) {
    scrollToBottom();
  }
}

function applyThinkingDelta(id, delta) {
  const message = state.messages.find((candidate) => candidate.id === id);
  if (!message) return;
  message.thinking = (message.thinking || "") + delta;
  const article = [...elements.messageList.children].find((candidate) => candidate.dataset.messageId === id);
  const existing = article?.querySelector(".work-summary");
  if (!existing) return;
  const wasOpen = existing.open;
  const replacement = renderWorkSummary(message);
  if (wasOpen && replacement instanceof HTMLDetailsElement) replacement.open = true;
  existing.replaceWith(replacement);
}

window.setInterval(() => {
  if (!state.isGenerating) return;
  for (const label of document.querySelectorAll(".work-summary-label")) {
    const message = state.messages.find((candidate) => candidate.id === label.dataset.messageId);
    if (message) label.textContent = workSummaryLabel(message);
  }
}, 1000);

function renderConfiguration() {
  const configuration = state.configuration;
  if (!configuration) {
    return;
  }

  elements.providerModel.textContent = configuration.model || "No model selected";
  elements.providerName.textContent = configuration.providerLabel;
  elements.providerEndpoint.textContent = endpointLabel(configuration.apiBaseUrl);
  elements.chatMode.textContent = state.activity
    ? state.activity
    : configuration.agentEnabled
      ? `${configuration.providerLabel} coding agent`
      : `${configuration.providerLabel} chat`;
  elements.statusDot.classList.toggle("configured", Boolean(configuration.hasApiKey));
  elements.keyDot.classList.toggle("configured", Boolean(configuration.hasApiKey));
  elements.keyLabel.textContent = configuration.hasApiKey
    ? `${configuration.providerLabel} key saved`
    : `Set ${configuration.providerLabel} key`;
  elements.apiKey.title = configuration.hasApiKey
    ? "Replace or remove the saved API key"
    : "Set API key";
  for (const option of elements.optimizationOptions) {
    const selected = option.dataset.optimizationMode === configuration.optimizationMode;
    option.classList.toggle("selected", selected);
    option.setAttribute("aria-checked", String(selected));
    option.disabled = state.isGenerating;
  }
  elements.promptContext.textContent = configuration.systemPrompt || "No system instructions configured.";
  elements.contextMessageCount.textContent = String(state.messages.length);
  elements.contextProviderName.textContent = configuration.providerLabel;
  elements.settingModel.value = configuration.model || "";
  elements.settingSystemPrompt.value = configuration.systemPrompt || "";
  elements.settingTimeout.value = String(configuration.requestTimeoutSeconds || 120);
  elements.settingThinking.checked = configuration.showThinking !== false;
  elements.settingWorkspaceContext.checked = configuration.includeWorkspaceContext !== false;
}

function renderHistory() {
  elements.historyList.replaceChildren();
  const current = document.createElement("button");
  current.className = "history-item active";
  current.type = "button";
  current.textContent = "Current conversation";
  current.addEventListener("click", showChat);
  elements.historyList.appendChild(current);
  for (const item of state.history) {
    const button = document.createElement("button");
    button.className = "history-item";
    button.type = "button";
    button.textContent = item.title || "Untitled conversation";
    button.addEventListener("click", () => { showChat(); vscode.postMessage({ type: "openHistory", id: item.id }); });
    elements.historyList.appendChild(button);
  }
}

function renderAttachments() {
  elements.attachmentTray.replaceChildren();
  elements.attachmentTray.hidden = state.attachments.length === 0;
  for (const [index, attachment] of state.attachments.entries()) {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    const label = document.createElement("span");
    label.textContent = attachment.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = `Remove ${attachment.name}`;
    remove.addEventListener("click", () => { state.attachments.splice(index, 1); renderAttachments(); updateComposer(); });
    chip.append(label, remove);
    elements.attachmentTray.appendChild(chip);
  }
}

async function addFiles(files) {
  for (const file of [...(files || [])].slice(0, Math.max(0, 4 - state.attachments.length))) {
    if (file.size > 900_000) continue;
    if (file.type.startsWith("image/")) state.attachments.push({ kind: "image", name: file.name, mimeType: file.type, dataUrl: await readAsDataUrl(file), size: file.size });
    else state.attachments.push({ kind: "text", name: file.name, content: (await file.text()).slice(0, 120_000), size: file.size });
  }
  renderAttachments();
  updateComposer();
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
}

function saveSettings() {
  vscode.postMessage({ type: "updateSettings", values: {
    model: elements.settingModel.value.trim(), systemPrompt: elements.settingSystemPrompt.value,
    requestTimeoutSeconds: Number(elements.settingTimeout.value), showThinking: elements.settingThinking.checked,
    includeWorkspaceContext: elements.settingWorkspaceContext.checked,
  } });
  showChat();
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
  const hasContent = elements.prompt.value.trim().length > 0 || state.attachments.length > 0;
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
