export type ChatRole = "user" | "assistant";

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
  apiBaseUrl: string;
  model: string;
  systemPrompt: string;
  requestTimeoutSeconds: number;
}
