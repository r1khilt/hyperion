export type ChatRole = "user" | "assistant";
export type Provider = "openai-compatible" | "anthropic" | "gmi-cloud" | "openrouter";
export type OptimizationMode =
  | "balanced"
  | "cost"
  | "latency"
  | "intelligence"
  | "cost-latency"
  | "cost-intelligence"
  | "latency-intelligence";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  durationMs?: number;
  thinking?: string;
  attachments?: ChatAttachment[];
}

export interface ImageAttachment {
  kind: "image";
  name: string;
  mimeType: string;
  dataUrl: string;
  size: number;
}

export interface TextAttachment {
  kind: "text";
  name: string;
  content: string;
  size: number;
}

export type ChatAttachment = ImageAttachment | TextAttachment;

export interface ChatHistoryItem {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface SystemApiMessage {
  role: "system";
  content: string;
}

export interface UserApiMessage {
  role: "user";
  content: string | Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  >;
}

export interface AssistantApiMessage {
  role: "assistant";
  content: string;
  toolCalls?: AgentToolCall[];
}

export interface ToolApiMessage {
  role: "tool";
  toolCallId: string;
  name: string;
  content: string;
  isError?: boolean;
}

export type ApiChatMessage =
  | SystemApiMessage
  | UserApiMessage
  | AssistantApiMessage
  | ToolApiMessage;

export interface AgentToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AgentToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AgentTurn {
  text: string;
  toolCalls: AgentToolCall[];
}

export interface ChatConfiguration {
  provider: Provider;
  apiBaseUrl: string;
  model: string;
  systemPrompt: string;
  requestTimeoutSeconds: number;
  maxOutputTokens: number;
  organizationId?: string;
  showThinking: boolean;
  includeWorkspaceContext: boolean;
  optimizationMode: OptimizationMode;
}
