export type ChatRole = "user" | "assistant";
export type Provider = "openai-compatible" | "anthropic" | "gmi-cloud";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
}

export interface ApiChatMessage {
  role: "system" | ChatRole;
  content: string;
}

export interface ChatConfiguration {
  provider: Provider;
  apiBaseUrl: string;
  model: string;
  systemPrompt: string;
  requestTimeoutSeconds: number;
  maxOutputTokens: number;
  organizationId?: string;
}
