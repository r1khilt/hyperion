import { ApiRequestError } from "./apiError";
import {
  AgentToolCall,
  AgentToolDefinition,
  AgentTurn,
  ApiChatMessage,
  ChatConfiguration,
} from "./types";

interface AnthropicStreamEvent {
  type?: string;
  index?: number;
  delta?: { type?: string; text?: string; thinking?: string; partial_json?: string };
  content_block?: {
    type?: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  };
  error?: { message?: string };
}

interface AnthropicResponse {
  content?: Array<{
    type?: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  error?: { message?: string };
}

interface StreamToolCall {
  id: string;
  name: string;
  inputJson: string;
}

export class AnthropicClient {
  public async streamTurn(
    configuration: ChatConfiguration,
    apiKey: string | undefined,
    messages: ApiChatMessage[],
    tools: AgentToolDefinition[],
    onDelta: (content: string) => void,
    onThinking: (content: string) => void,
    signal: AbortSignal,
  ): Promise<AgentTurn> {
    const endpoint = messagesEndpoint(configuration.apiBaseUrl);
    const headers: Record<string, string> = {
      Accept: "text/event-stream, application/json",
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    if (apiKey?.trim()) {
      headers["x-api-key"] = apiKey.trim();
    }
    const converted = toAnthropicRequest(messages);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: configuration.model,
          max_tokens: configuration.maxOutputTokens,
          system: converted.system || undefined,
          messages: converted.messages,
          tools: tools.map((tool) => ({
            name: tool.function.name,
            description: tool.function.description,
            input_schema: tool.function.parameters,
          })),
          stream: true,
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
    const payload = await response.json() as AnthropicResponse;
    const text = (payload.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
    if (text) {
      onDelta(text);
    }
    return {
      text,
      toolCalls: (payload.content ?? [])
        .filter((block) => block.type === "tool_use")
        .map((block, index) => ({
          id: block.id || `tool-${index}`,
          name: block.name || "",
          input: block.input ?? {},
        })),
    };
  }
}

function toAnthropicRequest(messages: ApiChatMessage[]): {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }>;
} {
  const system = messages.find((message) => message.role === "system")?.content ?? "";
  const result: Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }> = [];
  let index = 0;
  while (index < messages.length) {
    const message = messages[index];
    if (message.role === "system") {
      index += 1;
      continue;
    }
    if (message.role === "tool") {
      const toolResults: Array<Record<string, unknown>> = [];
      while (messages[index]?.role === "tool") {
        const tool = messages[index] as Extract<ApiChatMessage, { role: "tool" }>;
        toolResults.push({
          type: "tool_result",
          tool_use_id: tool.toolCallId,
          content: tool.content,
          is_error: tool.isError === true,
        });
        index += 1;
      }
      result.push({ role: "user", content: toolResults });
      continue;
    }
    if (message.role === "assistant") {
      const content: Array<Record<string, unknown>> = [];
      if (message.content) {
        content.push({ type: "text", text: message.content });
      }
      for (const toolCall of message.toolCalls ?? []) {
        content.push({ type: "tool_use", id: toolCall.id, name: toolCall.name, input: toolCall.input });
      }
      result.push({ role: "assistant", content: content.length ? content : "" });
    } else {
      result.push({ role: "user", content: toAnthropicUserContent(message.content) });
    }
    index += 1;
  }
  return { system, messages: result };
}

function messagesEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!normalized) {
    throw new ApiRequestError("Set an Anthropic API base URL in Hyperion settings.");
  }
  return normalized.endsWith("/messages") || normalized.includes("/messages?")
    ? normalized
    : `${normalized}/messages`;
}

async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (content: string) => void,
  onThinking: (content: string) => void,
  signal: AbortSignal,
): Promise<AgentTurn> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const calls = new Map<number, StreamToolCall>();
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
      input: parseToolInput(call.inputJson),
    })),
  };
}

function parseEventLine(
  line: string,
  onDelta: (content: string) => void,
  onThinking: (content: string) => void,
  calls: Map<number, StreamToolCall>,
): string {
  if (!line.startsWith("data:")) {
    return "";
  }
  const data = line.slice(5).trim();
  if (!data) {
    return "";
  }
  let event: AnthropicStreamEvent;
  try {
    event = JSON.parse(data) as AnthropicStreamEvent;
  } catch {
    return "";
  }
  if (event.type === "error") {
    throw new ApiRequestError(event.error?.message || "The Anthropic stream returned an error.");
  }
  if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
    // Anthropic starts streamed tool calls with input: {} and follows it with
    // input_json_delta chunks. Keeping that placeholder would turn a valid
    // streamed object into `{}{...}`, so preserve it only when it is non-empty.
    const initialInput = event.content_block.input;
    calls.set(event.index ?? calls.size, {
      id: event.content_block.id || `tool-${calls.size}`,
      name: event.content_block.name || "",
      inputJson: initialInput && Object.keys(initialInput).length
        ? JSON.stringify(initialInput)
        : "",
    });
    return "";
  }
  if (event.type === "content_block_delta" && event.delta?.type === "input_json_delta") {
    const call = calls.get(event.index ?? 0);
    if (call && event.delta.partial_json) {
      call.inputJson += event.delta.partial_json;
    }
    return "";
  }
  if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
    onDelta(event.delta.text);
    return event.delta.text;
  }
  if (event.type === "content_block_delta" && event.delta?.type === "thinking_delta" && event.delta.thinking) {
    onThinking(event.delta.thinking);
    return "";
  }
  if (event.type === "content_block_start" && event.content_block?.type === "text" && event.content_block.text) {
    onDelta(event.content_block.text);
    return event.content_block.text;
  }
  return "";
}

function toAnthropicUserContent(
  content: Extract<ApiChatMessage, { role: "user" }>['content'],
): string | Array<Record<string, unknown>> {
  if (typeof content === "string") return content;
  return content.map((part) => {
    if (part.type === "text") return part;
    const match = /^data:([^;]+);base64,(.+)$/.exec(part.image_url.url);
    return match
      ? { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } }
      : { type: "text", text: "[Image attachment could not be sent.]" };
  });
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

async function responseError(response: Response): Promise<ApiRequestError> {
  const raw = await response.text();
  let message = raw.trim();
  try {
    message = (JSON.parse(raw) as AnthropicResponse).error?.message?.trim() || message;
  } catch {
    // Keep a concise non-JSON error response.
  }
  if (message.length > 500) {
    message = `${message.slice(0, 500)}…`;
  }
  return new ApiRequestError(message || `The Anthropic API returned HTTP ${response.status}.`, response.status);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function abortError(): Error {
  const error = new Error("The request was stopped.");
  error.name = "AbortError";
  return error;
}
