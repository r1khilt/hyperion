import { getProvider } from "./providers";
import { repository } from "./repository";
import { routePrompt } from "./router/route";
import { RouteConstraints } from "./router/filterCandidates";
import { AgentSpec, ExecutionPlan, OptimizationMode } from "./types";

type Generation = { id: string; output: string; model: { provider: string; name: string }; routing: { confidence: number; task: { primary: string; subtask: string }; reason: string; candidates: { model: string; score: number }[]; fallback_used: boolean; original_model: string; alternative_reason: string }; usage: { input_tokens: number; output_tokens: number; cost_usd: number }; latency_ms: number };

async function generateSingle(prompt: string, optimize: OptimizationMode, constraints: RouteConstraints = {}): Promise<Generation> {
  const routing = await routePrompt(prompt, optimize, constraints);
  const request = await repository.logRequest({ prompt, primaryTask: routing.task.primaryTask, subtask: routing.task.subtask, taskAnalysis: routing.task, optimizationMode: optimize });
  await repository.logDecision({ requestId: request.id, selectedModel: routing.selected.candidate.profile.id, selectedConfiguration: routing.selected.candidate.configuration, score: routing.selected.score, confidence: routing.confidence, candidateScores: routing.candidates.map(c => ({ model: c.candidate.id, score: c.score })), reason: routing.reason });
  let lastError: unknown;
  for (const choice of routing.candidates) {
    const started = Date.now(), p = getProvider(choice.candidate.profile.provider);
    try {
      if (!p) throw new Error("Provider unavailable");
      const result = await p.generate({ prompt, model: choice.candidate.profile.model, configuration: choice.candidate.configuration, structuredOutput: routing.task.structuredOutputRequired });
      const latency = Date.now() - started, actual = p.estimateCost(result.inputTokens, result.outputTokens, choice.candidate.profile.id);
      await repository.logRun({ requestId: request.id, provider: choice.candidate.profile.provider, model: choice.candidate.profile.model, configuration: choice.candidate.configuration, latencyMs: latency, inputTokens: result.inputTokens, outputTokens: result.outputTokens, estimatedCost: choice.estimatedCostUsd, actualCost: actual, output: result.output, success: true });
      return { id: request.id, output: result.output, model: { provider: choice.candidate.profile.provider, name: choice.candidate.profile.model }, routing: { confidence: routing.confidence, task: { primary: routing.task.primaryTask, subtask: routing.task.subtask }, reason: routing.reason, candidates: routing.candidates.map(c => ({ model: c.candidate.profile.id, score: Number(c.score.toFixed(3)) })), fallback_used: choice !== routing.selected, original_model: routing.selected.candidate.profile.id, alternative_reason: routing.alternativeReason }, usage: { input_tokens: result.inputTokens, output_tokens: result.outputTokens, cost_usd: actual }, latency_ms: latency };
    } catch (error) {
      lastError = error;
      await repository.logRun({ requestId: request.id, provider: choice.candidate.profile.provider, model: choice.candidate.profile.model, configuration: choice.candidate.configuration, latencyMs: Date.now() - started, inputTokens: 0, outputTokens: 0, estimatedCost: choice.estimatedCostUsd, actualCost: 0, output: "", success: false, error: error instanceof Error ? error.message : "Unknown provider failure" });
    }
  }
  throw lastError instanceof Error ? lastError : new Error("All eligible providers failed");
}

const roleInstructions: Record<AgentSpec["role"], string> = {
  researcher: "Investigate the problem, surface key facts and assumptions. Return concise evidence and recommendations.", analyst: "Break down the problem rigorously. Identify trade-offs, gaps, and a sound approach.", critic: "Stress-test the proposed work. Find mistakes, risks, and specific improvements.", writer: "Draft a clear, useful response that directly answers the request.", coder: "Design or implement the technical solution carefully. Explain important decisions.", synthesizer: "Synthesize the team’s work into the final answer. Resolve conflicts and do not mention internal agents."
};

export async function generate(prompt: string, optimize: OptimizationMode, constraints: RouteConstraints = {}, execution: ExecutionPlan = {}): Promise<Generation & { execution?: { mode: string; agents: { id: string; role: string; model: string; output: string }[] } }> {
  if (execution.mode === "manual") return generateSingle(prompt, optimize, { ...constraints, allowed_models: [execution.modelId!] });
  if (execution.mode !== "multi-agent") return generateSingle(prompt, optimize, constraints);
  const transcript: { id: string; role: string; model: string; output: string }[] = [];
  let lastResult: Generation | undefined;
  for (const agent of execution.agents ?? []) {
    const context = transcript.length ? `\n\nWork from prior agents:\n${transcript.map(x => `[${x.role}] ${x.output}`).join("\n\n").slice(-24_000)}` : "";
    const agentPrompt = `You are the ${agent.role} in a collaborative AI team. ${roleInstructions[agent.role]} ${agent.instructions ?? ""}\n\nUser request:\n${prompt}${context}`;
    const result = await generateSingle(agentPrompt, optimize, agent.modelId ? { ...constraints, allowed_models: [agent.modelId] } : constraints);
    lastResult = result;
    transcript.push({ id: agent.id, role: agent.role, model: `${result.model.provider}/${result.model.name}`, output: result.output });
  }
  const final = transcript.at(-1);
  if (!final) throw new Error("A multi-agent run needs at least one agent.");
  return { ...lastResult!, output: final.output, execution: { mode: "multi-agent", agents: transcript } };
}
