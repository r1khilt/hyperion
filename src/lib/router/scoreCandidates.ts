import { CandidateScore, ModelCandidate, OptimizationMode, QualityPredictor, TaskAnalysis } from "../types";

const weights: Record<OptimizationMode, { quality: number; reliability: number; latency: number; cost: number }> = {
  quality: { quality: .65, reliability: .15, latency: .1, cost: .1 }, cost: { quality: .3, reliability: .1, latency: .1, cost: .5 }, speed: { quality: .3, reliability: .1, latency: .5, cost: .1 }, balanced: { quality: .5, reliability: .15, latency: .18, cost: .17 }
};
const expectedOutput = (task: TaskAnalysis) => task.expectedOutputLength === "long" ? 1600 : task.expectedOutputLength === "medium" ? 700 : 250;

export class HeuristicQualityPredictor implements QualityPredictor {
  async predict(task: TaskAnalysis, candidate: ModelCandidate) {
    const x = candidate.profile.capabilities;
    const denominator = task.codingRequired + task.reasoningRequired + task.creativityRequired + task.factualAccuracyImportance + (task.primaryTask === "math" ? 1 : 0) + (task.primaryTask === "research" ? 1 : 0) || 1;
    const capability = (task.codingRequired * x.coding + task.reasoningRequired * x.reasoning + task.creativityRequired * x.writing + task.factualAccuracyImportance * x.instructionFollowing + (task.primaryTask === "math" ? x.math : 0) + (task.primaryTask === "research" ? x.research : 0)) / denominator;
    const intelligence = (candidate.profile.metrics?.intelligence ?? 75) / 100;
    const effort = candidate.configuration.reasoningEffort === "high" ? .04 : candidate.configuration.reasoningEffort === "low" ? -.02 : 0;
    return Math.max(0, Math.min(1, capability * .8 + intelligence * .2 + effort));
  }
}
export function estimateFor(task: TaskAnalysis, c: ModelCandidate) {
  const input = Math.max(1, Math.ceil(task.contextRequirement * 20_000));
  const output = expectedOutput(task);
  return { cost: (input * c.profile.pricing.inputPerMillion + output * c.profile.pricing.outputPerMillion) / 1_000_000, latency: c.profile.typicalLatencyMs * (task.expectedOutputLength === "long" ? 1.7 : task.expectedOutputLength === "medium" ? 1.2 : 1) * (c.configuration.reasoningEffort === "high" ? 1.5 : 1) };
}
export async function scoreCandidates(task: TaskAnalysis, candidates: ModelCandidate[], mode: OptimizationMode, predictor: QualityPredictor = new HeuristicQualityPredictor()): Promise<CandidateScore[]> {
  const raw = await Promise.all(candidates.map(async candidate => ({ candidate, predictedQuality: await predictor.predict(task, candidate), ...estimateFor(task, candidate) })));
  const maxCost = Math.max(...raw.map(x => x.cost), .00001), maxLatency = Math.max(...raw.map(x => x.latency), 1), w = weights[mode];
  return raw.map(x => {
    const metrics = x.candidate.profile.metrics;
    const efficiency = (metrics?.efficiency ?? 75) / 100, speed = (metrics?.speed ?? 75) / 100, optimization = (metrics?.optimization ?? 75) / 100;
    const score = w.quality * x.predictedQuality + w.reliability * x.candidate.profile.reliability + w.cost * (1 - x.cost / maxCost) * efficiency + w.latency * (1 - x.latency / maxLatency) * speed + .05 * optimization;
    return { candidate: x.candidate, score, predictedQuality: x.predictedQuality, specialization: x.predictedQuality, reliability: x.candidate.profile.reliability, cost: 1 - x.cost / maxCost, latency: 1 - x.latency / maxLatency, estimatedCostUsd: x.cost, estimatedLatencyMs: x.latency };
  }).sort((a, b) => b.score - a.score);
}
