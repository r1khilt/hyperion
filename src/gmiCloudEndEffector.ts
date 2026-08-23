import { ApiRequestError } from "./apiError";
import { OpenAICompatibleClient } from "./openAICompatibleClient";
import { ApiChatMessage, ChatConfiguration } from "./types";

export const GMI_CLOUD_API_BASE_URL = "https://api.gmi-serving.com/v1";

/** The model decider must return the exact model identifier accepted by GMI Cloud. */
export interface ModelDecision {
  model: string;
}

export interface ModelDecider {
  decide(prompt: string): Promise<ModelDecision>;
}

export interface GmiCloudExecutionRequest {
  decision: ModelDecision;
  prompt: string;
  history?: readonly ApiChatMessage[];
  systemPrompt?: string;
  maxOutputTokens?: number;
}

export interface GmiCloudExecutionOptions {
  apiBaseUrl?: string;
  organizationId?: string;
  onDelta?: (content: string) => void;
  signal?: AbortSignal;
}

export interface GmiCloudExecutionResponse {
  model: string;
  content: string;
}

/**
 * Terminal execution step for a routed prompt. It deliberately does not score,
 * translate, or second-guess the model decider's result.
 */
export class GmiCloudEndEffector {
  public constructor(
    private readonly client: OpenAICompatibleClient = new OpenAICompatibleClient(),
  ) {}

  public async execute(
    request: GmiCloudExecutionRequest,
    apiKey: string | undefined,
    options: GmiCloudExecutionOptions = {},
  ): Promise<GmiCloudExecutionResponse> {
    const model = request.decision.model.trim();
    const prompt = request.prompt.trim();
    if (!model) {
      throw new ApiRequestError("The model decider returned an empty GMI Cloud model identifier.");
    }
    if (!prompt) {
      throw new ApiRequestError("A prompt is required before GMI Cloud can be invoked.");
    }
    if (!apiKey?.trim()) {
      throw new ApiRequestError(
        "No GMI Cloud API key is configured. Run Hyperion: Set API Key while GMI Cloud is selected.",
      );
    }

    const configuration: ChatConfiguration = {
      provider: "gmi-cloud",
      apiBaseUrl: options.apiBaseUrl?.trim() || GMI_CLOUD_API_BASE_URL,
      model,
      systemPrompt: request.systemPrompt?.trim() ?? "",
      requestTimeoutSeconds: 0,
      maxOutputTokens: request.maxOutputTokens ?? 4096,
      organizationId: options.organizationId?.trim() || undefined,
    };
    const messages = executionMessages(request, prompt);
    const signal = options.signal ?? new AbortController().signal;
    let content = "";

    await this.client.streamChat(
      configuration,
      apiKey,
      messages,
      (delta) => {
        content += delta;
        options.onDelta?.(delta);
      },
      signal,
    );

    return { model, content };
  }
}

function executionMessages(
  request: GmiCloudExecutionRequest,
  prompt: string,
): ApiChatMessage[] {
  const messages: ApiChatMessage[] = [];
  const systemPrompt = request.systemPrompt?.trim();
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  for (const message of request.history ?? []) {
    if (message.content.trim() && message.role !== "system") {
      messages.push({ role: message.role, content: message.content });
    }
  }
  messages.push({ role: "user", content: prompt });
  return messages;
}
