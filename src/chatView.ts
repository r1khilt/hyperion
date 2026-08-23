import * as vscode from "vscode";
import { ChatSession } from "./chatSession";

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private panelSession: vscode.Disposable | undefined;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly session: ChatSession,
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    configureWebview(webviewView.webview, this.extensionUri);
    webviewView.webview.html = chatHtml(webviewView.webview, this.extensionUri);
    const attachment = this.session.attach(webviewView.webview);
    webviewView.onDidDispose(() => attachment.dispose());
  }

  public show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "hyperion.chatPanel",
      "Hyperion Chat",
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, "media", "hyperion.svg");
    configureWebview(this.panel.webview, this.extensionUri);
    this.panel.webview.html = chatHtml(this.panel.webview, this.extensionUri);
    this.panelSession = this.session.attach(this.panel.webview);
    this.panel.onDidDispose(() => {
      this.panelSession?.dispose();
      this.panelSession = undefined;
      this.panel = undefined;
    });
  }

  public dispose(): void {
    this.panelSession?.dispose();
    this.panel?.dispose();
  }
}

function configureWebview(webview: vscode.Webview, extensionUri: vscode.Uri): void {
  webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
  };
}

function chatHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "chat.css"),
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "chat.js"),
  );
  const markUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "hyperion.svg"),
  );
  const brandUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "hyperion-brand.png"),
  );
  const nonce = randomNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Hyperion Chat</title>
</head>
<body>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <img class="brand-mark" src="${markUri}" alt="" />
        <div class="brand-copy">
          <strong>Hyperion</strong>
          <span id="chat-mode">Coding agent</span>
        </div>
      </div>
      <div class="topbar-actions">
        <button class="icon-button" id="context-toggle" type="button" title="View context" aria-label="View context">
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="M10 7v3.5l2 1.2"/></svg>
        </button>
        <button class="icon-button" id="new-chat" type="button" title="New chat" aria-label="New chat">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
        </button>
        <button class="icon-button" id="settings" type="button" title="Settings" aria-label="Open settings">
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3"/><path d="M10 2.7v2M10 15.3v2M2.7 10h2M15.3 10h2M4.8 4.8l1.4 1.4M13.8 13.8l1.4 1.4M15.2 4.8l-1.4 1.4M6.2 13.8l-1.4 1.4" /></svg>
        </button>
      </div>
    </header>

    <div class="provider-bar">
      <button class="provider-button" id="provider-settings" type="button" title="Switch provider">
        <span class="status-dot" id="status-dot"></span>
        <span class="provider-name" id="provider-name">OpenAI-compatible</span>
        <span class="provider-model" id="provider-model">Loading…</span>
        <span class="provider-endpoint" id="provider-endpoint"></span>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
      </button>
    </div>

    <section class="history-dock" id="history-dock">
      <div class="history-heading"><span>Conversations</span><button id="toggle-history" type="button">Show history</button></div>
      <div class="history-list" id="history-list" hidden></div>
    </section>

    <main class="conversation" id="conversation" aria-live="polite">
      <section class="empty-state" id="empty-state">
        <div class="empty-mark brand-art" aria-hidden="true"><img src="${brandUri}" alt="" /></div>
        <p class="eyebrow">HYPERION / WORKSPACE ASSISTANT</p>
        <h1>Build with more context.</h1>
        <p>Bring a file, image, or problem. Hyperion keeps your conversations and scopes workspace actions to this project.</p>
        <div class="suggestion-grid">
          <button class="suggestion" type="button" data-prompt="Inspect this codebase and explain its architecture and main entry points.">
            <strong>Explain code</strong><span>Understand behavior and edge cases</span>
          </button>
          <button class="suggestion" type="button" data-prompt="Investigate the current test or build failure, fix it if appropriate, and run focused verification.">
            <strong>Debug a problem</strong><span>Work through an issue together</span>
          </button>
          <button class="suggestion" type="button" data-prompt="Implement a small, well-scoped improvement in this repository and verify it.">
            <strong>Plan a feature</strong><span>Turn an idea into clear steps</span>
          </button>
          <button class="suggestion" type="button" data-prompt="Review the current workspace for a concrete bug or maintainability issue and propose a focused fix.">
            <strong>Review an approach</strong><span>Surface risks and tradeoffs</span>
          </button>
        </div>
      </section>
      <div class="message-list" id="message-list"></div>
      <section class="settings-page" id="settings-page" hidden>
        <p class="eyebrow">PREFERENCES</p><h1>Configure Hyperion</h1><p>Credentials stay in VS Code's secure storage.</p>
        <div class="settings-card"><label>Model<input id="setting-model" type="text" /></label><label>System instructions<textarea id="setting-system-prompt" rows="4"></textarea></label><label>Request timeout (seconds)<input id="setting-timeout" type="number" min="10" max="600" /></label><label class="switch-row"><input id="setting-thinking" type="checkbox" /> Show provider thinking traces when available</label><label class="switch-row"><input id="setting-workspace-context" type="checkbox" /> Include workspace and active-file context</label><div class="settings-actions"><button class="key-button" id="settings-key" type="button">Manage API key</button><button class="send-button" id="save-settings" type="button">Save changes</button></div></div>
      </section>
    </main>

    <aside class="context-pane" id="context-pane" hidden><div class="pane-header"><div><p class="eyebrow">CONTEXT INSPECTOR</p><strong>What Hyperion can see</strong></div><button class="icon-button" id="close-context" type="button" aria-label="Close context">×</button></div><div class="context-section"><span class="context-label">SYSTEM INSTRUCTIONS</span><pre id="context-system-prompt"></pre></div><div class="context-section"><span class="context-label">SESSION</span><div class="context-row"><span>Messages</span><strong id="context-message-count">0</strong></div><div class="context-row"><span>Provider</span><strong id="context-provider-name">—</strong></div></div><div class="context-section"><span class="context-label">TRANSPARENCY</span><p id="thinking-note">Thinking traces appear on supported models.</p></div></aside>

    <section class="error-banner" id="error-banner" role="alert" hidden>
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M10 6.5v4M10 13.5h.01" /></svg>
      <span id="error-text"></span>
      <button id="error-settings" type="button">Configure</button>
    </section>

    <footer class="composer-wrap" id="composer-wrap">
      <div class="attachment-tray" id="attachment-tray" hidden></div>
      <div class="composer" id="composer">
        <textarea id="prompt" rows="1" placeholder="Message Hyperion" aria-label="Chat message"></textarea>
        <div class="composer-footer">
          <input id="file-input" type="file" multiple accept="image/*,.txt,.md,.json,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.css,.html,.yml,.yaml" hidden />
          <button class="attach-button" id="attach" type="button" title="Attach images or text files" aria-label="Add context">+</button>
          <div class="optimization-switch" role="group" aria-label="Response focus">
            <span class="optimization-label">Focus</span>
            <div class="optimization-options" role="group" aria-label="Choose one or more response focuses">
              <button class="optimization-option" type="button" data-optimization-dimension="cost" aria-pressed="true" title="Use fewer tokens and tool calls">Cost</button>
              <button class="optimization-option" type="button" data-optimization-dimension="latency" aria-pressed="true" title="Favor a quicker response">Speed</button>
              <button class="optimization-option" type="button" data-optimization-dimension="intelligence" aria-pressed="true" title="Favor deeper investigation and validation">Intelligence</button>
            </div>
            <span class="optimization-summary" id="optimization-summary">All three</span>
          </div>
          <button class="key-button" id="api-key" type="button">
            <span class="key-dot" id="key-dot"></span>
            <span id="key-label">API key</span>
          </button>
          <span class="input-hint">Shift + Enter for a new line</span>
          <button class="send-button" id="send" type="button" title="Send message" aria-label="Send message">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 15V5M6 9l4-4 4 4" /></svg>
          </button>
          <button class="stop-button" id="stop" type="button" title="Stop generating" aria-label="Stop generating" hidden>
            <span></span>
          </button>
        </div>
      </div>
      <p class="disclaimer">Responses come directly from your configured provider and may be inaccurate.</p>
    </footer>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function randomNonce(): string {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let index = 0; index < 32; index += 1) {
    nonce += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return nonce;
}
