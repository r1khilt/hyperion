import * as vscode from "vscode";
import { HyperionDashboard } from "./dashboard";

const DASHBOARD_COMMAND = "hyperion.openDashboard";

export function activate(context: vscode.ExtensionContext): void {
  const dashboard = new HyperionDashboard(context.extensionUri);

  context.subscriptions.push(
    vscode.commands.registerCommand(DASHBOARD_COMMAND, () => dashboard.show()),
    vscode.commands.registerCommand("hyperion.analyzeWorkspace", () => {
      dashboard.show();
      void vscode.window.showInformationMessage(
        "Workspace analysis is a planned Hyperion capability; no analysis has run.",
      );
    }),
    vscode.window.registerWebviewViewProvider("hyperion.overview", {
      resolveWebviewView(webviewView) {
        webviewView.webview.options = { enableScripts: false };
        webviewView.webview.html = dashboard.html();
      },
    }),
  );

  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBar.name = "Hyperion";
  statusBar.text = "$(sparkle) Hyperion";
  statusBar.tooltip = "Open the Hyperion dashboard";
  statusBar.command = DASHBOARD_COMMAND;

  if (vscode.workspace.getConfiguration("hyperion").get<boolean>("showStatusBar", true)) {
    statusBar.show();
  }

  context.subscriptions.push(statusBar);
}

export function deactivate(): void {
  // Reserved for future agent and service cleanup.
}
