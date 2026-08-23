import { ApiRequestError } from "./apiError";
import { ApiChatMessage, ChatConfiguration } from "./types";

interface AnthropicStreamEvent {
  type?: string;
  delta?: {
    type?: string;
    text?: string;
  };
  content_block?: {
    type?: string;
    text?: string;
  };
  error?: {
    message?: string;
  };
}

interface AnthropicResponse {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  error?: {
    message?: string;
  };
}

export class AnthropicClient {
  public async streamChat(
    configuration: ChatConfiguration,
    apiKey: string | undefined,
    messages: ApiChatMessage[],
    onDelta: (content: string) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const endpoint = messagesEndpoint(configuration.apiBaseUrl);
    const headers: Record<string, string> = {
      Accept: "text/event-stream, application/json",
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    };

    if (apiKey?.trim()) {
      headers["x-api-key"] = apiKey.trim();
    }

    const system = messages.find((message) => message.role === "system")?.content.trim();
    const conversation = messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({ role: message.role, content: message.content }));

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: configuration.model,
          max_tokens: configuration.maxOutputTokens,
          messages: conversation,
          stream: true,
          ...(system ? { system } : {}),
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
      await readEventStream(response.body, onDelta, signal);
      return;
    }

    const payload = (await response.json()) as AnthropicResponse;
    const content = (payload.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
    if (!content) {
      throw new ApiRequestError("The Anthropic API returned a response without assistant text.");
    }
    onDelta(content);
  }
}

function messagesEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!normalized) {
    throw new ApiRequestError("Set an Anthropic API base URL in Hyperion settings.");
  }
  if (normalized.endsWith("/messages") || normalized.includes("/messages?")) {
    return normalized;
  }
  return `${normalized}/messages`;
}

async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (content: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
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
        parseEventLine(line, onDelta);
      }
    }

    if (buffer.trim()) {
      parseEventLine(buffer, onDelta);
    }
  } finally {
    reader.releaseLock();
  }
}

function parseEventLine(line: string, onDelta: (content: string) => void): void {
  if (!line.startsWith("data:")) {
    return;
  }

  const data = line.slice(5).trim();
  if (!data) {
    return;
  }

  let event: AnthropicStreamEvent;
  try {
    event = JSON.parse(data) as AnthropicStreamEvent;
  } catch {
    return;
  }

  if (event.type === "error") {
    throw new ApiRequestError(event.error?.message || "The Anthropic stream returned an error.");
  }

  if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
    if (event.delta.text) {
      onDelta(event.delta.text);
    }
    return;
  }

  if (event.type === "content_block_start" && event.content_block?.type === "text") {
    if (event.content_block.text) {
      onDelta(event.content_block.text);
    }
  }
}

async function responseError(response: Response): Promise<ApiRequestError> {
  const raw = await response.text();
  let message = raw.trim();

  try {
    const payload = JSON.parse(raw) as AnthropicResponse;
    message = payload.error?.message?.trim() || message;
  } catch {
    // Non-JSON errors are returned as a concise text excerpt below.
  }

  if (message.length > 500) {
    message = `${message.slice(0, 500)}…`;
  }

  return new ApiRequestError(
    message || `The Anthropic API returned HTTP ${response.status}.`,
    response.status,
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function abortError(): Error {
  const error = new Error("The request was stopped.");
  error.name = "AbortError";
  return error;
}
