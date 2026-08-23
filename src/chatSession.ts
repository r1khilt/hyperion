import * as vscode from "vscode";
import { AnthropicClient } from "./anthropicClient";
import { codingTools, WorkspaceToolExecutor } from "./agentTools";
import { ApiRequestError } from "./apiError";
import { ModelDecider } from "./gmiCloudEndEffector";
import { OpenAICompatibleClient } from "./openAICompatibleClient";
import {
  AgentToolDefinition,
  AgentTurn,
  ApiChatMessage,
  ChatAttachment,
  ChatConfiguration,
  ChatHistoryItem,
  ChatMessage,
  OptimizationMode,
  Provider,
} from "./types";

const API_KEY_SECRETS: Record<Provider, string> = {
  "openai-compatible": "hyperion.openaiCompatibleApiKey",
  anthropic: "hyperion.anthropicApiKey",
  "gmi-cloud": "hyperion.gmiCloudApiKey",
  openrouter: "hyperion.openRouterApiKey",
};
const MESSAGE_STORAGE_KEY = "hyperion.chatMessages.v1";
const HISTORY_STORAGE_KEY = "hyperion.chatHistory.v1";
const OPTIMIZATION_MODE_STORAGE_KEY = "hyperion.optimizationMode.v1";
const MAX_AGENT_TURNS = 24;

const CURATED_MODELS: Partial<Record<Provider, Array<{ label: string; description: string; model: string }>>> = {
  "gmi-cloud": [
    { label: "Qwen3-Coder 480B", description: "Strongest suggested coding-agent option; larger and more deliberate.", model: "Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8" },
    { label: "Qwen3-Coder 30B", description: "Faster, lower-cost coding option for everyday repository work.", model: "Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8" },
    { label: "DeepSeek V3.2", description: "General-purpose option for agentic work outside focused coding tasks.", model: "deepseek-ai/DeepSeek-V3.2" },
    { label: "GLM-5.1", description: "Alternative general reasoning option; use when available to your GMI Cloud account.", model: "zai-org/GLM-5.1" },
  ],
  openrouter: [
    { label: "Claude Sonnet 4.6", description: "Balanced default for careful coding-agent work.", model: "anthropic/claude-sonnet-4.6" },
    { label: "GPT-5.4", description: "Premium option for difficult reasoning and implementation tasks.", model: "openai/gpt-5.4" },
    { label: "Gemini 3.1 Pro Preview", description: "Long-context alternative; preview availability and behavior may change.", model: "google/gemini-3.1-pro-preview" },
    { label: "Qwen3-Coder 30B", description: "Value-oriented coding option with a public routed price.", model: "qwen/qwen3-coder-30b-a3b-instruct" },
  ],
};

type WebviewRequest =
  | { type: "send"; content?: unknown; attachments?: unknown }
  | { type: "stop" }
  | { type: "newChat" }
  | { type: "setApiKey" }
  | { type: "selectProvider" }
  | { type: "openSettings" }
  | { type: "copy"; content?: unknown }
  | { type: "setOptimizationMode"; mode?: unknown }
  | { type: "openHistory"; id?: unknown }
  | { type: "updateSettings"; values?: unknown };

export class ChatSession implements vscode.Disposable {
  private readonly openAIClient = new OpenAICompatibleClient();
  private readonly anthropicClient = new AnthropicClient();
  private readonly webviews = new Set<vscode.Webview>();
  private messages: ChatMessage[];
  private history: ChatHistoryItem[];
  private optimizationMode: OptimizationMode;
  private activeController: AbortController | undefined;
  private errorMessage: string | undefined;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly modelDecider?: ModelDecider,
  ) {
    this.messages = sanitizeStoredMessages(
      context.workspaceState.get<ChatMessage[]>(MESSAGE_STORAGE_KEY, []),
    );
    this.history = sanitizeHistory(
      context.workspaceState.get<ChatHistoryItem[]>(HISTORY_STORAGE_KEY, []),
    );
    this.optimizationMode = sanitizeOptimizationMode(
      context.workspaceState.get<unknown>(OPTIMIZATION_MODE_STORAGE_KEY),
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
    const configuration = getConfiguration();
    const providerName = providerLabel(configuration.provider);
    const secretKey = API_KEY_SECRETS[configuration.provider];
    const existing = await this.context.secrets.get(secretKey);
    const value = await vscode.window.showInputBox({
      title: `Hyperion ${providerName} API key`,
      prompt: existing
        ? "Enter a replacement key, or leave this blank to remove the saved key."
        : `Enter the API key for ${providerName}.`,
      placeHolder: existing
        ? "A key is currently saved"
        : apiKeyPlaceholder(configuration.provider),
      password: true,
      ignoreFocusOut: true,
    });

    if (value === undefined) {
      return;
    }

    if (value.trim()) {
      await this.context.secrets.store(secretKey, value.trim());
      void vscode.window.showInformationMessage(`${providerName} API key saved securely.`);
    } else {
      await this.context.secrets.delete(secretKey);
      void vscode.window.showInformationMessage(`${providerName} API key removed.`);
    }

    await this.broadcastState();
  }

  public async selectProvider(): Promise<void> {
    if (this.activeController) {
      void vscode.window.showInformationMessage(
        "Stop the current response before switching providers.",
      );
      return;
    }

    const current = getConfiguration().provider;
    const selected = await vscode.window.showQuickPick(
      [
        {
          label: "OpenAI-compatible",
          description: "Chat Completions API",
          provider: "openai-compatible" as const,
          picked: current === "openai-compatible",
        },
        {
          label: "Anthropic",
          description: "Native Claude Messages API",
          provider: "anthropic" as const,
          picked: current === "anthropic",
        },
        {
          label: "GMI Cloud",
          description: "Routed or direct hosted open-model inference",
          provider: "gmi-cloud" as const,
          picked: current === "gmi-cloud",
        },
        {
          label: "OpenRouter",
          description: "Curated tool-capable cross-provider model options",
          provider: "openrouter" as const,
          picked: current === "openrouter",
        },
      ],
      {
        title: "Select Hyperion chat provider",
        placeHolder: "Choose one provider for this chat",
      },
    );

    if (!selected) {
      return;
    }

    if (selected.provider === current) {
      await this.selectModel(selected.provider);
      return;
    }

    await vscode.workspace
      .getConfiguration("hyperion")
      .update("provider", selected.provider, vscode.ConfigurationTarget.Global);
    await this.selectModel(selected.provider);
    this.errorMessage = undefined;
    await this.broadcastState();
  }

  private async selectModel(provider: Provider): Promise<void> {
    const models = CURATED_MODELS[provider];
    if (!models?.length) {
      return;
    }
    const selected = await vscode.window.showQuickPick(
      models.map((model) => ({
        ...model,
        detail: model.model,
        picked: model.model === configuredModel(provider),
      })),
      {
        title: `Select a curated ${providerLabel(provider)} model`,
        placeHolder: "Only coding-agent-appropriate choices are shown; custom IDs remain available in settings.",
      },
    );
    if (selected) {
      await vscode.workspace
        .getConfiguration("hyperion")
        .update(modelSettingKey(provider), selected.model, vscode.ConfigurationTarget.Global);
    }
  }

  public async requestNewChat(): Promise<void> {
    this.activeController?.abort();
    this.archiveCurrentConversation();
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
          await this.send(request.content, sanitizeAttachments(request.attachments));
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
      case "selectProvider":
        await this.selectProvider();
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
      case "setOptimizationMode":
        if (!this.activeController && isOptimizationMode(request.mode)) {
          this.optimizationMode = request.mode;
          await this.context.workspaceState.update(
            OPTIMIZATION_MODE_STORAGE_KEY,
            this.optimizationMode,
          );
          await this.broadcastState();
        }
        break;
      case "openHistory":
        if (typeof request.id === "string") {
          await this.openHistory(request.id);
        }
        break;
      case "updateSettings":
        await this.updateSettings(request.values);
        break;
    }
  }

  private async send(rawContent: string, attachments: ChatAttachment[]): Promise<void> {
    const content = rawContent.trim();
    if ((!content && !attachments.length) || this.activeController) {
      return;
    }

    const configuration: ChatConfiguration = {
      ...getConfiguration(),
      optimizationMode: this.optimizationMode,
    };
    if (
      !configuration.model.trim() &&
      !(configuration.provider === "gmi-cloud" && this.modelDecider)
    ) {
      this.errorMessage = "Set a model identifier in Hyperion settings.";
      await this.broadcastState();
      return;
    }

    const userMessage = createMessage("user", content, attachments);
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
      const apiKey = await this.context.secrets.get(
        API_KEY_SECRETS[configuration.provider],
      );
      const effectiveConfiguration = configuration.provider === "gmi-cloud" && this.modelDecider
        ? {
            ...configuration,
            model: (await this.modelDecider.decide(content)).model.trim(),
          }
        : configuration;
      if (!effectiveConfiguration.model) {
        throw new ApiRequestError("The model decider returned an empty model identifier.");
      }
      const executor = vscode.workspace.workspaceFolders?.length
        ? new WorkspaceToolExecutor(
            (title, detail) => this.requestToolApproval(title, detail),
            (message) => this.broadcast({ type: "agentActivity", message }),
          )
        : undefined;
      await executor?.initialize();
      const apiMessages = requestMessages(effectiveConfiguration, this.messages);
      const client =
        effectiveConfiguration.provider === "anthropic"
          ? this.anthropicClient
          : this.openAIClient;
      await this.runAgentLoop(
        client,
        effectiveConfiguration,
        apiKey,
        apiMessages,
        executor,
        assistantMessage,
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
    const configuration = getConfiguration();
    const apiKey = await this.context.secrets.get(
      API_KEY_SECRETS[configuration.provider],
    );
    await webview.postMessage({
      type: "state",
      messages: this.messages,
      isGenerating: Boolean(this.activeController),
      error: this.errorMessage,
      configuration: {
        ...configuration,
        optimizationMode: this.optimizationMode,
        providerLabel: providerLabel(configuration.provider),
        hasApiKey: Boolean(apiKey),
        agentEnabled: true,
      },
      history: this.history.map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt })),
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
    await this.context.workspaceState.update(HISTORY_STORAGE_KEY, this.history);
  }

  private archiveCurrentConversation(): void {
    const meaningful = this.messages.filter((message) => message.content.trim() || message.attachments?.length);
    if (!meaningful.length) return;
    const createdAt = meaningful[0].createdAt;
    this.history = [{
      id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
      title: conversationTitle(meaningful),
      createdAt,
      updatedAt: Date.now(),
      messages: meaningful,
    }, ...this.history].slice(0, 24);
  }

  private async openHistory(id: string): Promise<void> {
    if (this.activeController) return;
    const index = this.history.findIndex((item) => item.id === id);
    if (index < 0) return;
    this.archiveCurrentConversation();
    const [selected] = this.history.splice(index, 1);
    this.messages = selected.messages;
    this.errorMessage = undefined;
    await this.persist();
    await this.broadcastState();
  }

  private async updateSettings(values: unknown): Promise<void> {
    if (!values || typeof values !== "object" || Array.isArray(values)) return;
    const input = values as Record<string, unknown>;
    const configuration = vscode.workspace.getConfiguration("hyperion");
    const model = typeof input.model === "string" ? input.model.trim() : undefined;
    const systemPrompt = typeof input.systemPrompt === "string" ? input.systemPrompt : undefined;
    const timeout = typeof input.requestTimeoutSeconds === "number" ? input.requestTimeoutSeconds : undefined;
    if (model !== undefined) await configuration.update(modelSettingKey(getConfiguration().provider), model, vscode.ConfigurationTarget.Global);
    if (systemPrompt !== undefined) await configuration.update("systemPrompt", systemPrompt, vscode.ConfigurationTarget.Global);
    if (timeout !== undefined && Number.isFinite(timeout)) await configuration.update("requestTimeoutSeconds", Math.max(10, Math.min(600, Math.round(timeout))), vscode.ConfigurationTarget.Global);
    if (typeof input.showThinking === "boolean") await configuration.update("showThinking", input.showThinking, vscode.ConfigurationTarget.Global);
    if (typeof input.includeWorkspaceContext === "boolean") await configuration.update("includeWorkspaceContext", input.includeWorkspaceContext, vscode.ConfigurationTarget.Global);
    await this.broadcastState();
  }

  private async runAgentLoop(
    client: {
      streamTurn(
        configuration: ChatConfiguration,
        apiKey: string | undefined,
        messages: ApiChatMessage[],
        tools: AgentToolDefinition[],
        onDelta: (content: string) => void,
        onThinking: (content: string) => void,
        signal: AbortSignal,
      ): Promise<AgentTurn>;
    },
    configuration: ChatConfiguration,
    apiKey: string | undefined,
    history: ApiChatMessage[],
    executor: WorkspaceToolExecutor | undefined,
    assistantMessage: ChatMessage,
    signal: AbortSignal,
  ): Promise<void> {
    for (let turnIndex = 0; turnIndex < MAX_AGENT_TURNS; turnIndex += 1) {
      if (signal.aborted) {
        throw abortError();
      }
      const turn = await client.streamTurn(
        configuration,
        apiKey,
        history,
        executor ? codingTools : [],
        (delta) => {
          assistantMessage.content += delta;
          this.broadcast({ type: "messageDelta", id: assistantMessage.id, delta });
        },
        (delta) => {
          assistantMessage.thinking = `${assistantMessage.thinking ?? ""}${delta}`;
          this.broadcast({ type: "thinkingDelta", id: assistantMessage.id, delta });
        },
        signal,
      );
      history.push({
        role: "assistant",
        content: turn.text,
        ...(turn.toolCalls.length ? { toolCalls: turn.toolCalls } : {}),
      });
      if (!turn.toolCalls.length) {
        return;
      }
      for (const toolCall of turn.toolCalls) {
        const result = executor
          ? await executor.execute(toolCall, signal)
          : { content: "Open a VS Code workspace before asking Hyperion to use coding tools.", isError: true };
        history.push({
          role: "tool",
          toolCallId: toolCall.id,
          name: toolCall.name,
          content: result.content,
          isError: result.isError,
        });
      }
    }
    throw new ApiRequestError(`Hyperion stopped after ${MAX_AGENT_TURNS} tool-assisted turns.`);
  }

  private async requestToolApproval(title: string, detail: string): Promise<boolean> {
    const autoApprove = vscode.workspace
      .getConfiguration("hyperion")
      .get<boolean>("autoApproveTools", true);
    if (autoApprove) {
      return true;
    }
    const action = await vscode.window.showWarningMessage(
      `Hyperion wants to ${title.toLocaleLowerCase()}: ${truncateApprovalDetail(detail)}`,
      { modal: true },
      "Allow once",
    );
    return action === "Allow once";
  }
}

function getConfiguration(): Omit<ChatConfiguration, "optimizationMode"> {
  const configuration = vscode.workspace.getConfiguration("hyperion");
  const configuredProvider = configuration.get<string>("provider", "openai-compatible");
  const provider: Provider =
    configuredProvider === "anthropic" || configuredProvider === "gmi-cloud" || configuredProvider === "openrouter"
      ? configuredProvider
      : "openai-compatible";
  const anthropic = provider === "anthropic";
  const gmiCloud = provider === "gmi-cloud";
  return {
    provider,
    apiBaseUrl: provider === "gmi-cloud"
      ? configuration.get<string>("gmiApiBaseUrl", "https://api.gmi-serving.com/v1")
      : provider === "openrouter"
        ? configuration.get<string>("openRouterApiBaseUrl", "https://openrouter.ai/api/v1")
        : anthropic
          ? configuration.get<string>("anthropicApiBaseUrl", "https://api.anthropic.com/v1")
          : configuration.get<string>("apiBaseUrl", "https://api.openai.com/v1"),
    model: configuredModel(provider),
    systemPrompt: configuration.get<string>(
      "systemPrompt",
      "You are a helpful software engineering assistant.",
    ),
    requestTimeoutSeconds: configuration.get<number>("requestTimeoutSeconds", 120),
    maxOutputTokens: anthropic
      ? configuration.get<number>("anthropicMaxOutputTokens", 4096)
      : gmiCloud
        ? configuration.get<number>("gmiMaxOutputTokens", 4096)
        : 0,
    organizationId: gmiCloud
      ? configuration.get<string>("gmiOrganizationId", "")
      : undefined,
    showThinking: configuration.get<boolean>("showThinking", true),
    includeWorkspaceContext: configuration.get<boolean>("includeWorkspaceContext", true),
  };
}

function configuredModel(provider: Provider): string {
  const configuration = vscode.workspace.getConfiguration("hyperion");
  return configuration.get<string>(modelSettingKey(provider), defaultModel(provider));
}

function modelSettingKey(provider: Provider): string {
  switch (provider) {
    case "anthropic": return "anthropicModel";
    case "gmi-cloud": return "gmiFallbackModel";
    case "openrouter": return "openRouterModel";
    default: return "model";
  }
}

function defaultModel(provider: Provider): string {
  switch (provider) {
    case "anthropic": return "claude-sonnet-5";
    case "gmi-cloud": return "deepseek-ai/DeepSeek-R1";
    case "openrouter": return "anthropic/claude-sonnet-4.6";
    default: return "gpt-4o-mini";
  }
}

function providerLabel(provider: Provider): string {
  switch (provider) {
    case "anthropic": return "Anthropic";
    case "gmi-cloud": return "GMI Cloud";
    case "openrouter": return "OpenRouter";
    default: return "OpenAI-compatible";
  }
}

function apiKeyPlaceholder(provider: Provider): string {
  if (provider === "anthropic") return "sk-ant-…";
  if (provider === "gmi-cloud") return "GMI Cloud API key";
  if (provider === "openrouter") return "sk-or-v1-…";
  return "sk-…";
}

function requestMessages(
  configuration: ChatConfiguration,
  messages: ChatMessage[],
): ApiChatMessage[] {
  const result: ApiChatMessage[] = [];
  result.push({ role: "system", content: agentSystemPrompt(configuration) });

  result.push(
    ...messages
      .filter((message) => message.content.trim() || message.attachments?.length)
      .map(toApiMessage),
  );
  return result;
}

function toApiMessage(message: ChatMessage): ApiChatMessage {
  return message.role === "assistant"
    ? { role: "assistant", content: message.content }
    : { role: "user", content: apiMessageContent(message) };
}

function createMessage(
  role: ChatMessage["role"],
  content: string,
  attachments: ChatAttachment[] = [],
): ChatMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    role,
    content,
    createdAt: Date.now(),
    ...(attachments.length ? { attachments } : {}),
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

function sanitizeHistory(history: ChatHistoryItem[]): ChatHistoryItem[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter((item) => item && typeof item.id === "string" && typeof item.title === "string" && typeof item.createdAt === "number" && typeof item.updatedAt === "number")
    .map((item) => ({ ...item, messages: sanitizeStoredMessages(item.messages) }))
    .filter((item) => item.messages.length)
    .slice(0, 24);
}

function sanitizeAttachments(value: unknown): ChatAttachment[] {
  if (!Array.isArray(value)) return [];
  const attachments: ChatAttachment[] = [];
  for (const item of value.slice(0, 4)) {
    if (!item || typeof item !== "object") continue;
    const input = item as Record<string, unknown>;
    const name = typeof input.name === "string" ? input.name.slice(0, 160) : "attachment";
    const size = typeof input.size === "number" && input.size >= 0 && input.size <= 900_000 ? input.size : undefined;
    if (size === undefined) continue;
    if (input.kind === "image" && typeof input.mimeType === "string" && typeof input.dataUrl === "string" && /^data:image\/[\w.+-]+;base64,/.test(input.dataUrl) && input.dataUrl.length <= 1_250_000) {
      attachments.push({ kind: "image", name, mimeType: input.mimeType, dataUrl: input.dataUrl, size });
    } else if (input.kind === "text" && typeof input.content === "string") {
      attachments.push({ kind: "text", name, content: input.content.slice(0, 120_000), size });
    }
  }
  return attachments;
}

function apiMessageContent(message: ChatMessage): string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> {
  if (message.role === "assistant" || !message.attachments?.length) return message.content;
  const textFiles = message.attachments.filter((attachment): attachment is Extract<ChatAttachment, { kind: "text" }> => attachment.kind === "text");
  const text = [message.content, ...textFiles.map((file) => `\n\n<attached-file name="${file.name}">\n${file.content}\n</attached-file>`)].filter(Boolean).join("\n");
  return [
    { type: "text", text: text || "Please inspect the attached files." },
    ...message.attachments.filter((attachment): attachment is Extract<ChatAttachment, { kind: "image" }> => attachment.kind === "image").map((image) => ({ type: "image_url" as const, image_url: { url: image.dataUrl } })),
  ];
}

function conversationTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user");
  const source = firstUser?.content || firstUser?.attachments?.[0]?.name || "Untitled conversation";
  return source.replace(/\s+/g, " ").trim().slice(0, 52);
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

function agentSystemPrompt(configuration: ChatConfiguration): string {
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "(no workspace open)";
  const activeFile = vscode.window.activeTextEditor?.document.uri.scheme === "file"
    ? vscode.workspace.asRelativePath(vscode.window.activeTextEditor.document.uri, false)
    : undefined;
  const workspaceContext = configuration.includeWorkspaceContext
    ? `Your workspace root is ${workspace}.${activeFile ? ` The active editor file is ${activeFile}.` : ""}`
    : "The user has disabled automatic workspace metadata; use tools only when the user asks about their project.";
  return `${configuration.systemPrompt.trim() || "You are a helpful software engineering assistant."}

You are Hyperion, a workspace-scoped coding agent. ${workspaceContext}

${optimizationInstruction(configuration.optimizationMode)}

Use the provided tools to inspect the codebase, make requested changes, and run targeted verification. Do not invent file contents, command output, or completed edits. Read relevant files before changing existing code. Paths must be workspace-relative. Tool actions follow Hyperion's configured approval policy; if an action is denied, adapt or explain the blocker. Prefer precise replace_in_file edits over full-file rewrites. After tools finish, give the user a concise summary of changes and verification.`;
}

function optimizationInstruction(mode: OptimizationMode): string {
  switch (mode) {
    case "cost":
      return "Response focus: cost efficiency. Keep responses concise, avoid unnecessary tool calls, and use the minimum investigation needed for a reliable answer.";
    case "latency":
      return "Response focus: latency. Reach a useful answer quickly, prefer direct actions, and avoid broad exploration or repeated verification unless the user requests it.";
    case "intelligence":
      return "Response focus: intelligence. Reason carefully, investigate relevant context, validate important conclusions, and explain material tradeoffs.";
    case "balanced":
      return "Response focus: balanced. Balance response quality, latency, and cost based on the task.";
  }
}

function isOptimizationMode(value: unknown): value is OptimizationMode {
  return (
    value === "balanced" ||
    value === "cost" ||
    value === "latency" ||
    value === "intelligence"
  );
}

function sanitizeOptimizationMode(value: unknown): OptimizationMode {
  return isOptimizationMode(value) ? value : "balanced";
}

function truncateApprovalDetail(detail: string): string {
  return detail.length > 1_000 ? `${detail.slice(0, 1_000)}…` : detail;
}

function abortError(): Error {
  const error = new Error("The request was stopped.");
  error.name = "AbortError";
  return error;
}
