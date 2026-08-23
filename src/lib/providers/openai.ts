import OpenAI from "openai";
import { modelRegistry } from "../model-registry";
import { ModelProvider, ProviderGenerationRequest, ProviderGenerationResult } from "../types";
export class OpenAIProvider implements ModelProvider {
  private client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : undefined;
  isAvailable() { return Boolean(this.client); }
  estimateCost(input: number, output: number, modelId: string) { const p = modelRegistry.find(x => x.id === modelId)?.pricing; return p ? (input * p.inputPerMillion + output * p.outputPerMillion) / 1_000_000 : 0; }
  async generate(request: ProviderGenerationRequest): Promise<ProviderGenerationResult> {
    if (!this.client) throw new Error("OPENAI_API_KEY is not configured");
    const response = await this.client.chat.completions.create({ model: request.model, messages: [{ role: "user", content: request.prompt }], temperature: request.configuration?.temperature });
    return { output: response.choices[0]?.message.content ?? "", inputTokens: response.usage?.prompt_tokens ?? 0, outputTokens: response.usage?.completion_tokens ?? 0 };
  }
}
