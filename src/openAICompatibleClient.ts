import { ApiRequestError } from "./apiError";
import { ApiChatMessage, ChatConfiguration } from "./types";

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: { content?: string | Array<{ text?: string }> };
  }>;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | Array<{ text?: string }> | null };
  }>;
  error?: { message?: string };
}

export class OpenAICompatibleClient {
  public async streamChat(
    configuration: ChatConfiguration,
    apiKey: string | undefined,
    messages: ApiChatMessage[],
    onDelta: (content: string) => void,
    signal: AbortSignal,
  ): Promise<void> {
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
          messages,
          stream: true,
          ...(configuration.maxOutputTokens > 0
            ? { max_tokens: configuration.maxOutputTokens }
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
      await readEventStream(response.body, onDelta, signal);
      return;
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const content = textContent(payload.choices?.[0]?.message?.content);
    if (!content) {
      throw new ApiRequestError("The API returned a response without assistant text.");
    }
    onDelta(content);
  }
}

function chatCompletionsEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!normalized) {
    throw new ApiRequestError("Set an API base URL in Hyperion settings.");
  }
  if (
    normalized.endsWith("/chat/completions") ||
    normalized.includes("/chat/completions?")
  ) {
    return normalized;
  }
  return `${normalized}/chat/completions`;
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
  if (!data || data === "[DONE]") {
    return;
  }

  let payload: ChatCompletionChunk;
  try {
    payload = JSON.parse(data) as ChatCompletionChunk;
  } catch {
    return;
  }

  const content = textContent(payload.choices?.[0]?.delta?.content);
  if (content) {
    onDelta(content);
  }
}

function textContent(content: string | Array<{ text?: string }> | null | undefined): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => part.text ?? "").join("");
  }
  return "";
}

async function responseError(response: Response): Promise<ApiRequestError> {
  const raw = await response.text();
  let message = raw.trim();

  try {
    const payload = JSON.parse(raw) as ChatCompletionResponse;
    message = payload.error?.message?.trim() || message;
  } catch {
    // Non-JSON errors are returned as a concise text excerpt below.
  }

  if (message.length > 500) {
    message = `${message.slice(0, 500)}…`;
  }

  return new ApiRequestError(
    message || `The API returned HTTP ${response.status}.`,
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
