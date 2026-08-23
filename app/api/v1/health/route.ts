import { NextResponse } from "next/server";
import { modelRegistry } from "@/src/lib/model-registry";
import { isModelAvailable } from "@/src/lib/providers";

export function GET() {
  const providers = [...new Set(modelRegistry.map(model => model.provider))].map(provider => ({ provider, configured: isModelAvailable(provider) }));
  return NextResponse.json({ ok: true, providers, eligibleModels: modelRegistry.filter(model => isModelAvailable(model.provider)).map(model => model.id) });
}
