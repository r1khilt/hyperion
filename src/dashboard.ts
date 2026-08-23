import * as vscode from "vscode";

export class HyperionDashboard {
  private panel: vscode.WebviewPanel | undefined;

  public constructor(private readonly extensionUri: vscode.Uri) {}

  public show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "hyperion.dashboard",
      "Hyperion",
      vscode.ViewColumn.One,
      { enableScripts: false },
    );
    this.panel.webview.html = this.html();
    this.panel.onDidDispose(() => (this.panel = undefined));
  }

  public html(): string {
    // The dashboard is intentionally static until the agent services exist.
    void this.extensionUri;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root { color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
    body { margin: 0; padding: 28px; max-width: 980px; }
    .eyebrow { color: var(--vscode-descriptionForeground); font-size: 12px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; }
    h1 { font-size: 32px; margin: 8px 0; }
    .lede { color: var(--vscode-descriptionForeground); font-size: 16px; line-height: 1.6; max-width: 720px; }
    .notice { border: 1px solid var(--vscode-editorWidget-border); border-radius: 6px; margin: 28px 0; padding: 16px; background: var(--vscode-editorWidget-background); }
    .notice strong { display: block; margin-bottom: 5px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
    .card { border: 1px solid var(--vscode-editorWidget-border); border-radius: 6px; padding: 16px; }
    .card h2 { font-size: 14px; margin: 0 0 8px; }
    .card p { color: var(--vscode-descriptionForeground); font-size: 13px; line-height: 1.5; margin: 0; }
    .status { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 28px; }
  </style>
</head>
<body>
  <div class="eyebrow">Software-agent intelligence layer</div>
  <h1>Hyperion</h1>
  <p class="lede">Choose the best model for each step of a software-engineering task, using global capability data and local project context.</p>
  <section class="notice">
    <strong>Setup mode</strong>
    This extension currently provides only the product shell. It has not analyzed this workspace, connected to models, or made any routing decisions.
  </section>
  <section class="grid">
    <article class="card"><h2>Workspace profile</h2><p>Awaiting codebase analysis.</p></article>
    <article class="card"><h2>Model intelligence</h2><p>Awaiting benchmark and capability sources.</p></article>
    <article class="card"><h2>Live routing</h2><p>No active task or delegated subtasks.</p></article>
    <article class="card"><h2>Cost and latency</h2><p>No estimates available yet.</p></article>
  </section>
  <p class="status">Planned next: connect services, define a task model, and add explicit user-controlled routing.</p>
</body>
</html>`;
  }
}
