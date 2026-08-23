import { GoogleGenerativeAI } from "@google/generative-ai";
import { modelRegistry } from "../model-registry";
import { ModelProvider, ProviderGenerationRequest, ProviderGenerationResult } from "../types";
export class GoogleProvider implements ModelProvider {
  private client = process.env.GOOGLE_API_KEY ? new GoogleGenerativeAI(process.env.GOOGLE_API_KEY) : undefined;
  isAvailable() { return Boolean(this.client); }
  estimateCost(input: number, output: number, modelId: string) { const p = modelRegistry.find(x => x.id === modelId)?.pricing; return p ? (input * p.inputPerMillion + output * p.outputPerMillion) / 1_000_000 : 0; }
  async generate(request: ProviderGenerationRequest): Promise<ProviderGenerationResult> {
    if (!this.client) throw new Error("GOOGLE_API_KEY is not configured");
    const result = await this.client.getGenerativeModel({ model: request.model, generationConfig: { temperature: request.configuration?.temperature } }).generateContent(request.prompt);
    const usage = result.response.usageMetadata;
    return { output: result.response.text(), inputTokens: usage?.promptTokenCount ?? 0, outputTokens: usage?.candidatesTokenCount ?? 0 };
  }
}
