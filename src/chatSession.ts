import * as vscode from "vscode";
import { ApiRequestError, OpenAICompatibleClient } from "./openAICompatibleClient";
import { ApiChatMessage, ChatConfiguration, ChatMessage } from "./types";

const API_KEY_SECRET = "hyperion.openaiCompatibleApiKey";
const MESSAGE_STORAGE_KEY = "hyperion.chatMessages.v1";

type WebviewRequest =
  | { type: "send"; content?: unknown }
  | { type: "stop" }
  | { type: "newChat" }
  | { type: "setApiKey" }
  | { type: "openSettings" }
  | { type: "copy"; content?: unknown };

export class ChatSession implements vscode.Disposable {
  private readonly client = new OpenAICompatibleClient();
  private readonly webviews = new Set<vscode.Webview>();
  private messages: ChatMessage[];
  private activeController: AbortController | undefined;
  private errorMessage: string | undefined;

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.messages = sanitizeStoredMessages(
      context.workspaceState.get<ChatMessage[]>(MESSAGE_STORAGE_KEY, []),
    );
  }

  public attach(webview: vscode.Webview): vscode.Disposable {
    this.webviews.add(webview);
    const messageListener = webview.onDidReceiveMessage((request: WebviewRequest) => {
      void this.handleRequest(request);
    });

    void this.postState(webview);

    return new vscode.Disposable(() => {
      messageListener.dispose();
      this.webviews.delete(webview);
    });
  }

  public async setApiKey(): Promise<void> {
    const existing = await this.context.secrets.get(API_KEY_SECRET);
    const value = await vscode.window.showInputBox({
      title: "Hyperion API key",
      prompt: existing
        ? "Enter a replacement key, or leave this blank to remove the saved key."
        : "Enter the API key for your OpenAI-compatible provider.",
      placeHolder: existing ? "A key is currently saved" : "sk-…",
      password: true,
      ignoreFocusOut: true,
    });

    if (value === undefined) {
      return;
    }

    if (value.trim()) {
      await this.context.secrets.store(API_KEY_SECRET, value.trim());
      void vscode.window.showInformationMessage("Hyperion API key saved securely.");
    } else {
      await this.context.secrets.delete(API_KEY_SECRET);
      void vscode.window.showInformationMessage("Hyperion API key removed.");
    }

    await this.broadcastState();
  }

  public async requestNewChat(): Promise<void> {
    if (this.messages.length > 0) {
      const answer = await vscode.window.showWarningMessage(
        "Start a new chat? This clears the current local conversation.",
        { modal: true },
        "New Chat",
      );
      if (answer !== "New Chat") {
        return;
      }
    }

    this.activeController?.abort();
    this.messages = [];
    this.errorMessage = undefined;
    await this.persist();
    await this.broadcastState();
  }

  public configurationChanged(): void {
    void this.broadcastState();
  }

  public dispose(): void {
    this.activeController?.abort();
    this.webviews.clear();
  }

  private async handleRequest(request: WebviewRequest): Promise<void> {
    switch (request.type) {
      case "send":
        if (typeof request.content === "string") {
          await this.send(request.content);
        }
        break;
      case "stop":
        this.activeController?.abort();
        break;
      case "newChat":
        await this.requestNewChat();
        break;
      case "setApiKey":
        await this.setApiKey();
        break;
      case "openSettings":
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "@ext:hyperion.hyperion",
        );
        break;
      case "copy":
        if (typeof request.content === "string") {
          await vscode.env.clipboard.writeText(request.content);
        }
        break;
    }
  }

  private async send(rawContent: string): Promise<void> {
    const content = rawContent.trim();
    if (!content || this.activeController) {
      return;
    }

    const configuration = getConfiguration();
    if (!configuration.model.trim()) {
      this.errorMessage = "Set a model identifier in Hyperion settings.";
      await this.broadcastState();
      return;
    }

    const userMessage = createMessage("user", content);
    const assistantMessage = createMessage("assistant", "");
    this.messages.push(userMessage, assistantMessage);
    this.errorMessage = undefined;
    const controller = new AbortController();
    this.activeController = controller;
    await this.broadcastState();

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, configuration.requestTimeoutSeconds * 1000);

    try {
      const apiKey = await this.context.secrets.get(API_KEY_SECRET);
      const apiMessages = requestMessages(configuration, this.messages);
      await this.client.streamChat(
        configuration,
        apiKey,
        apiMessages,
        (delta) => {
          assistantMessage.content += delta;
          this.broadcast({
            type: "messageDelta",
            id: assistantMessage.id,
            delta,
          });
        },
        controller.signal,
      );

      if (!assistantMessage.content) {
        assistantMessage.content = "The model returned no text.";
      }
    } catch (error) {
      if (isAbortError(error)) {
        if (!assistantMessage.content) {
          this.messages = this.messages.filter((message) => message.id !== assistantMessage.id);
        }
        if (timedOut) {
          this.errorMessage = `The request timed out after ${configuration.requestTimeoutSeconds} seconds.`;
        }
      } else {
        if (!assistantMessage.content) {
          this.messages = this.messages.filter((message) => message.id !== assistantMessage.id);
        }
        this.errorMessage = friendlyError(error);
      }
    } finally {
      clearTimeout(timeout);
      this.activeController = undefined;
      await this.persist();
      await this.broadcastState();
    }
  }

  private async postState(webview: vscode.Webview): Promise<void> {
    const apiKey = await this.context.secrets.get(API_KEY_SECRET);
    await webview.postMessage({
      type: "state",
      messages: this.messages,
      isGenerating: Boolean(this.activeController),
      error: this.errorMessage,
      configuration: {
        ...getConfiguration(),
        hasApiKey: Boolean(apiKey),
      },
    });
  }

  private async broadcastState(): Promise<void> {
    await Promise.all([...this.webviews].map((webview) => this.postState(webview)));
  }

  private broadcast(message: unknown): void {
    for (const webview of this.webviews) {
      void webview.postMessage(message);
    }
  }

  private async persist(): Promise<void> {
    await this.context.workspaceState.update(MESSAGE_STORAGE_KEY, this.messages);
  }
}

function getConfiguration(): ChatConfiguration {
  const configuration = vscode.workspace.getConfiguration("hyperion");
  return {
    apiBaseUrl: configuration.get<string>("apiBaseUrl", "https://api.openai.com/v1"),
    model: configuration.get<string>("model", "gpt-4o-mini"),
    systemPrompt: configuration.get<string>(
      "systemPrompt",
      "You are a helpful software engineering assistant.",
    ),
    requestTimeoutSeconds: configuration.get<number>("requestTimeoutSeconds", 120),
  };
}

function requestMessages(
  configuration: ChatConfiguration,
  messages: ChatMessage[],
): ApiChatMessage[] {
  const result: ApiChatMessage[] = [];
  if (configuration.systemPrompt.trim()) {
    result.push({ role: "system", content: configuration.systemPrompt.trim() });
  }

  result.push(
    ...messages
      .filter((message) => message.content.trim())
      .map((message) => ({ role: message.role, content: message.content })),
  );
  return result;
}

function createMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    role,
    content,
    createdAt: Date.now(),
  };
}

function sanitizeStoredMessages(messages: ChatMessage[]): ChatMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages.filter(
    (message) =>
      message &&
      (message.role === "user" || message.role === "assistant") &&
      typeof message.id === "string" &&
      typeof message.content === "string" &&
      typeof message.createdAt === "number",
  );
}

function friendlyError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    const prefix = error.status ? `API error ${error.status}` : "Connection error";
    return `${prefix}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
