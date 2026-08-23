import { ApiRequestError } from "./apiError";
import {
  AgentToolCall,
  AgentToolDefinition,
  AgentTurn,
  ApiChatMessage,
  ChatConfiguration,
} from "./types";

interface OpenAIToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ text?: string }>;
      tool_calls?: OpenAIToolCallDelta[];
      reasoning?: string;
      reasoning_content?: string;
    };
  }>;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string }> | null;
      tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
    };
  }>;
  error?: { message?: string };
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export class OpenAICompatibleClient {
  public async streamTurn(
    configuration: ChatConfiguration,
    apiKey: string | undefined,
    messages: ApiChatMessage[],
    tools: AgentToolDefinition[],
    onDelta: (content: string) => void,
    onThinking: (content: string) => void,
    signal: AbortSignal,
  ): Promise<AgentTurn> {
    const endpoint = chatCompletionsEndpoint(configuration.apiBaseUrl);
    const headers: Record<string, string> = {
      Accept: "text/event-stream, application/json",
      "Content-Type": "application/json",
    };
    if (apiKey?.trim()) {
      headers.Authorization = `Bearer ${apiKey.trim()}`;
    }
    if (configuration.organizationId?.trim()) {
      headers["X-Organization-ID"] = configuration.organizationId.trim();
    }

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: configuration.model,
          messages: toOpenAIMessages(messages),
          tools,
          tool_choice: "auto",
          stream: true,
          ...(configuration.maxOutputTokens > 0
            ? { max_tokens: configuration.maxOutputTokens }
            : {}),
          ...(configuration.provider === "openrouter"
            ? { provider: { require_parameters: true } }
            : {}),
        }),
        signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new ApiRequestError(`Could not reach ${endpoint}: ${detail}`);
    }
    if (!response.ok) {
      throw await responseError(response);
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("text/event-stream") && response.body) {
      return readEventStream(response.body, onDelta, onThinking, signal);
    }

    const message = (await response.json() as ChatCompletionResponse).choices?.[0]?.message;
    const text = textContent(message?.content);
    if (text) {
      onDelta(text);
    }
    return {
      text,
      toolCalls: (message?.tool_calls ?? []).map((toolCall, index) => ({
        id: toolCall.id || `tool-${index}`,
        name: toolCall.function?.name || "",
        input: parseToolInput(toolCall.function?.arguments || ""),
      })),
    };
  }
}

function toOpenAIMessages(messages: ApiChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((message) => {
    if (message.role === "tool") {
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    }
    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: message.content || null,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                type: "function",
                function: { name: toolCall.name, arguments: JSON.stringify(toolCall.input) },
              })),
            }
          : {}),
      };
    }
    return { role: message.role, content: message.content };
  });
}

function chatCompletionsEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!normalized) {
    throw new ApiRequestError("Set an API base URL in Hyperion settings.");
  }
  return normalized.endsWith("/chat/completions") || normalized.includes("/chat/completions?")
    ? normalized
    : `${normalized}/chat/completions`;
}

async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (content: string) => void,
  onThinking: (content: string) => void,
  signal: AbortSignal,
): Promise<AgentTurn> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const calls = new Map<number, AccumulatedToolCall>();
  let text = "";
  let buffer = "";
  try {
    while (true) {
      if (signal.aborted) {
        throw abortError();
      }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        text += parseEventLine(line, onDelta, onThinking, calls);
      }
    }
    if (buffer.trim()) {
      text += parseEventLine(buffer, onDelta, onThinking, calls);
    }
  } finally {
    reader.releaseLock();
  }
  return {
    text,
    toolCalls: [...calls.values()].map((call) => ({
      id: call.id,
      name: call.name,
      input: parseToolInput(call.arguments),
    })),
  };
}

function parseEventLine(
  line: string,
  onDelta: (content: string) => void,
  onThinking: (content: string) => void,
  calls: Map<number, AccumulatedToolCall>,
): string {
  if (!line.startsWith("data:")) {
    return "";
  }
  const data = line.slice(5).trim();
  if (!data || data === "[DONE]") {
    return "";
  }
  let payload: ChatCompletionChunk;
  try {
    payload = JSON.parse(data) as ChatCompletionChunk;
  } catch {
    return "";
  }
  const delta = payload.choices?.[0]?.delta;
  const content = textContent(delta?.content);
  if (content) {
    onDelta(content);
  }
  const thinking = delta?.reasoning ?? delta?.reasoning_content;
  if (thinking) onThinking(thinking);
  for (const toolCall of delta?.tool_calls ?? []) {
    const index = toolCall.index ?? 0;
    const current = calls.get(index) ?? {
      id: toolCall.id || `tool-${index}`,
      name: toolCall.function?.name || "",
      arguments: "",
    };
    if (toolCall.id) {
      current.id = toolCall.id;
    }
    if (toolCall.function?.name) {
      current.name = toolCall.function.name;
    }
    if (toolCall.function?.arguments) {
      current.arguments += toolCall.function.arguments;
    }
    calls.set(index, current);
  }
  return content;
}

function parseToolInput(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function textContent(content: string | Array<{ text?: string }> | null | undefined): string {
  return typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => part.text ?? "").join("")
      : "";
}

async function responseError(response: Response): Promise<ApiRequestError> {
  const raw = await response.text();
  let message = raw.trim();
  try {
    message = (JSON.parse(raw) as ChatCompletionResponse).error?.message?.trim() || message;
  } catch {
    // Keep non-JSON server responses as concise text.
  }
  if (message.length > 500) {
    message = `${message.slice(0, 500)}…`;
  }
  return new ApiRequestError(message || `The API returned HTTP ${response.status}.`, response.status);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function abortError(): Error {
  const error = new Error("The request was stopped.");
  error.name = "AbortError";
  return error;
}
