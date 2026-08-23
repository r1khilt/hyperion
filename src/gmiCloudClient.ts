import { ApiRequestError } from "./apiError";

export interface GmiCloudModel {
  id: string;
  ownedBy?: string;
}

interface ModelsResponse {
  data?: Array<{ id?: unknown; owned_by?: unknown }>;
}

/** Lists the models enabled for an inference API key. */
export class GmiCloudClient {
  public async listModels(
    apiBaseUrl: string,
    apiKey: string,
    organizationId?: string,
  ): Promise<GmiCloudModel[]> {
    if (!apiKey.trim()) {
      throw new ApiRequestError("Enter a GMI Cloud API key before loading models.");
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey.trim()}`,
    };
    if (organizationId?.trim()) {
      headers["X-Organization-ID"] = organizationId.trim();
    }

    let response: Response;
    const endpoint = modelsEndpoint(apiBaseUrl);
    try {
      response = await fetch(endpoint, { headers });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new ApiRequestError(`Could not reach GMI Cloud at ${endpoint}: ${detail}`);
    }
    if (!response.ok) {
      const detail = await response.text();
      const message = errorMessage(detail) || `GMI Cloud returned HTTP ${response.status}.`;
      if (response.status === 401 || response.status === 403) {
        throw new ApiRequestError(
          `GMI Cloud rejected this API key (${response.status}): ${message}`,
          response.status,
        );
      }
      throw new ApiRequestError(message, response.status);
    }

    let payload: ModelsResponse;
    try {
      payload = await response.json() as ModelsResponse;
    } catch {
      throw new ApiRequestError("GMI Cloud returned an invalid model catalog response.");
    }
    const models = (payload.data ?? [])
      .flatMap((model) => typeof model.id === "string" && model.id.trim()
        ? [{ id: model.id.trim(), ownedBy: typeof model.owned_by === "string" ? model.owned_by : undefined }]
        : [])
      .sort((left, right) => left.id.localeCompare(right.id));
    if (!models.length) {
      throw new ApiRequestError("This GMI Cloud API key has no available chat models.");
    }
    return models;
  }
}

function modelsEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!normalized) {
    throw new ApiRequestError("Set a GMI Cloud API base URL in Hyperion settings.");
  }
  if (normalized.endsWith("/models") || normalized.includes("/models?")) {
    return normalized;
  }
  return normalized.replace(/\/chat\/completions(?:\?.*)?$/, "") + "/models";
}

function errorMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: unknown }; message?: unknown };
    const message = parsed.error?.message ?? parsed.message;
    return typeof message === "string" ? message.trim() : raw.trim();
  } catch {
    return raw.trim();
  }
}
