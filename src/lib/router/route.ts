import { expandCandidates } from "../model-registry";
import { estimateFor, scoreCandidates } from "./scoreCandidates";
import { analyzeTask } from "./analyzeTask";
import { filterCandidates, RouteConstraints } from "./filterCandidates";
import { CandidateScore, OptimizationMode, TaskAnalysis } from "../types";
export interface RoutingResult { task: TaskAnalysis; candidates: CandidateScore[]; selected: CandidateScore; confidence: number; reason: string; alternativeReason: string; }
export async function routePrompt(prompt: string, optimize: OptimizationMode, constraints: RouteConstraints = {}): Promise<RoutingResult> {
  const task=await analyzeTask(prompt); const eligible=filterCandidates(expandCandidates(),task,constraints,c=>estimateFor(task,c).cost,c=>estimateFor(task,c).latency);
  if (!eligible.length) throw new Error("No configured model can satisfy these requirements. Add a provider key or relax constraints.");
  const candidates=await scoreCandidates(task,eligible,optimize); const selected=candidates[0]; const second=candidates[1]; const margin=second ? Math.max(0,Math.min(1,(selected.score-second.score)/.25)) : .9; const confidence=Math.round((.55*margin+.45*task.confidence)*100)/100;
  const emphasis=task.codingRequired>.6 ? "coding" : task.reasoningRequired>.6 ? "reasoning" : task.creativityRequired>.6 ? "writing" : task.primaryTask;
  return {task,candidates,selected,confidence,reason:`Selected for the strongest predicted ${emphasis} performance while fitting your ${optimize} objective and stated constraints.`,alternativeReason: second ? `${second.candidate.profile.id} was not selected because its combined quality, reliability, cost, and latency score was lower.` : "No other eligible candidate was available."};
}
