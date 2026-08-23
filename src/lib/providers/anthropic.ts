import Anthropic from "@anthropic-ai/sdk";
import { modelRegistry } from "../model-registry";
import { ModelProvider, ProviderGenerationRequest, ProviderGenerationResult } from "../types";
export class AnthropicProvider implements ModelProvider {
  private client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : undefined;
  isAvailable() { return Boolean(this.client); }
  estimateCost(input: number, output: number, modelId: string) { const p = modelRegistry.find(x => x.id === modelId)?.pricing; return p ? (input * p.inputPerMillion + output * p.outputPerMillion) / 1_000_000 : 0; }
  async generate(request: ProviderGenerationRequest): Promise<ProviderGenerationResult> {
    if (!this.client) throw new Error("ANTHROPIC_API_KEY is not configured");
    const response = await this.client.messages.create({ model: request.model, max_tokens: 4096, messages: [{ role: "user", content: request.prompt }], temperature: request.configuration?.temperature });
    return { output: response.content.filter(x => x.type === "text").map(x => x.text).join(""), inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
  }
}
