import * as vscode from "vscode";
import { ChatSession } from "./chatSession";
import { ChatViewProvider } from "./chatView";

const DASHBOARD_COMMAND = "hyperion.openDashboard";

export function activate(context: vscode.ExtensionContext): void {
  const session = new ChatSession(context);
  const chatView = new ChatViewProvider(context.extensionUri, session);

  context.subscriptions.push(
    session,
    chatView,
    vscode.commands.registerCommand(DASHBOARD_COMMAND, () => chatView.show()),
    vscode.commands.registerCommand("hyperion.setApiKey", () => session.setApiKey()),
    vscode.commands.registerCommand("hyperion.selectProvider", () =>
      session.selectProvider(),
    ),
    vscode.commands.registerCommand("hyperion.clearChat", () => session.requestNewChat()),
    vscode.commands.registerCommand("hyperion.openSettings", () =>
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "@ext:hyperion.hyperion",
      ),
    ),
    vscode.window.registerWebviewViewProvider("hyperion.chat", chatView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("hyperion")) {
        session.configurationChanged();
      }
    }),
  );

  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBar.name = "Hyperion";
  statusBar.text = "$(comment-discussion) Hyperion";
  statusBar.tooltip = "Open Hyperion chat";
  statusBar.command = DASHBOARD_COMMAND;

  if (vscode.workspace.getConfiguration("hyperion").get<boolean>("showStatusBar", true)) {
    statusBar.show();
  }

  context.subscriptions.push(
    statusBar,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("hyperion.showStatusBar")) {
        return;
      }
      if (
        vscode.workspace.getConfiguration("hyperion").get<boolean>("showStatusBar", true)
      ) {
        statusBar.show();
      } else {
        statusBar.hide();
      }
    }),
  );
}

export function deactivate(): void {
  // Reserved for future agent and service cleanup.
}
