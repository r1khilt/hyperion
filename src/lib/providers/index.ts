import { AnthropicProvider } from "./anthropic";
import { GoogleProvider } from "./google";
import { OpenAIProvider } from "./openai";
import { ModelProvider } from "../types";
const providers: Record<string, ModelProvider> = { openai: new OpenAIProvider(), anthropic: new AnthropicProvider(), google: new GoogleProvider() };
export function getProvider(name: string): ModelProvider | undefined { return providers[name]; }
export function isModelAvailable(provider: string): boolean { return providers[provider]?.isAvailable() ?? false; }
