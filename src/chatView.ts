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
        <div class="brand-mark" aria-hidden="true">H</div>
        <div class="brand-copy">
          <strong>Hyperion</strong>
          <span id="chat-mode">Standard chat</span>
        </div>
      </div>
      <div class="topbar-actions">
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

    <main class="conversation" id="conversation" aria-live="polite">
      <section class="empty-state" id="empty-state">
        <div class="empty-mark" aria-hidden="true">H</div>
        <h1>What can I help with?</h1>
        <p>Chat directly with a configured provider, or execute routed model choices through GMI Cloud.</p>
        <div class="suggestion-grid">
          <button class="suggestion" type="button" data-prompt="Explain this code clearly and point out any edge cases.">
            <strong>Explain code</strong><span>Understand behavior and edge cases</span>
          </button>
          <button class="suggestion" type="button" data-prompt="Help me debug this problem step by step.">
            <strong>Debug a problem</strong><span>Work through an issue together</span>
          </button>
          <button class="suggestion" type="button" data-prompt="Draft an implementation plan for this feature.">
            <strong>Plan a feature</strong><span>Turn an idea into clear steps</span>
          </button>
          <button class="suggestion" type="button" data-prompt="Review this approach and identify the main tradeoffs.">
            <strong>Review an approach</strong><span>Surface risks and tradeoffs</span>
          </button>
        </div>
      </section>
      <div class="message-list" id="message-list"></div>
    </main>

    <section class="error-banner" id="error-banner" role="alert" hidden>
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M10 6.5v4M10 13.5h.01" /></svg>
      <span id="error-text"></span>
      <button id="error-settings" type="button">Configure</button>
    </section>

    <footer class="composer-wrap">
      <div class="composer" id="composer">
        <textarea id="prompt" rows="1" placeholder="Message Hyperion" aria-label="Chat message"></textarea>
        <div class="composer-footer">
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
