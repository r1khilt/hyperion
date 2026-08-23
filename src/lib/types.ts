export type OptimizationMode = "quality" | "balanced" | "speed" | "cost";
export type PrimaryTask = "coding" | "math" | "reasoning" | "writing" | "research" | "extraction" | "summarization" | "conversation" | "vision" | "agentic" | "other";

export interface TaskAnalysis {
  primaryTask: PrimaryTask; subtask: string; difficulty: number; reasoningRequired: number;
  creativityRequired: number; codingRequired: number; factualAccuracyImportance: number;
  contextRequirement: number; expectedOutputLength: "short" | "medium" | "long";
  visionRequired: boolean; toolUseRequired: boolean; structuredOutputRequired: boolean;
  latencySensitivity: "low" | "medium" | "high"; errorCost: "low" | "medium" | "high";
  likelySpecializations: string[]; confidence: number;
}

export interface ModelProfile {
  id: string; provider: "openai" | "anthropic" | "google"; model: string;
  displayName?: string;
  metrics?: { intelligence: number; speed: number; efficiency: number; optimization: number };
  capabilities: Record<"coding" | "reasoning" | "writing" | "math" | "research" | "vision" | "toolUse" | "longContext" | "instructionFollowing", number>;
  supports: { vision: boolean; tools: boolean; structuredOutput: boolean; reasoningControl: boolean };
  contextWindow: number; pricing: { inputPerMillion: number; outputPerMillion: number };
  typicalLatencyMs: number; reliability: number;
  configurations?: Array<{ id: string; reasoningEffort?: "low" | "medium" | "high"; temperature?: number }>;
}
export type AgentRole = "researcher" | "analyst" | "critic" | "writer" | "coder" | "synthesizer";
export interface AgentSpec { id: string; role: AgentRole; modelId?: string; instructions?: string; }
export interface ExecutionPlan { mode?: "route" | "manual" | "multi-agent"; modelId?: string; agents?: AgentSpec[]; }
export interface ModelCandidate { profile: ModelProfile; configuration: NonNullable<ModelProfile["configurations"]>[number]; id: string; }
export interface CandidateScore { candidate: ModelCandidate; score: number; predictedQuality: number; specialization: number; reliability: number; cost: number; latency: number; estimatedCostUsd: number; estimatedLatencyMs: number; }
export interface ProviderGenerationRequest { prompt: string; model: string; configuration?: ModelCandidate["configuration"]; structuredOutput?: boolean; }
export interface ProviderGenerationResult { output: string; inputTokens: number; outputTokens: number; }
export interface ModelProvider { generate(request: ProviderGenerationRequest): Promise<ProviderGenerationResult>; estimateCost(inputTokens: number, expectedOutputTokens: number, modelId: string): number; isAvailable(): boolean; }
export interface QualityPredictor { predict(task: TaskAnalysis, candidate: ModelCandidate): Promise<number>; }
