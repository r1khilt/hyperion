"use client";
import { FormEvent, useEffect, useMemo, useState } from "react";

type Model = { id: string; displayName?: string; provider: string; metrics?: { intelligence: number; speed: number; efficiency: number; optimization: number }; pricing: { inputPerMillion: number; outputPerMillion: number }; typicalLatencyMs: number };
type Agent = { id: string; role: "researcher" | "analyst" | "critic" | "writer" | "coder" | "synthesizer"; modelId?: string };
type Result = { output: string; model: { provider: string; name: string }; routing: { confidence: number; reason: string; candidates: { model: string; score: number }[]; alternative_reason: string }; usage: { cost_usd: number }; latency_ms: number; execution?: { mode: string; agents: { id: string; role: string; model: string; output: string }[] } };

const roles: Agent["role"][] = ["researcher", "analyst", "critic", "writer", "coder", "synthesizer"];
const defaultAgents: Agent[] = [{ id: "research", role: "researcher" }, { id: "analysis", role: "analyst" }, { id: "synthesis", role: "synthesizer" }];
const title = (model: Model) => model.displayName ?? model.id;

export default function Home() {
  const [prompt, setPrompt] = useState("Create a Python implementation of A* and explain it.");
  const [objective, setObjective] = useState("balanced");
  const [mode, setMode] = useState<"route" | "manual" | "multi-agent">("route");
  const [models, setModels] = useState<Model[]>([]);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [fineTunes, setFineTunes] = useState<{ displayName: string; baseModel: string; status: string; specializations: string[] }[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [agents, setAgents] = useState<Agent[]>(defaultAgents);
  const [status, setStatus] = useState<"idle" | "routing" | "generating">("idle");
  const [route, setRoute] = useState<any>(); const [result, setResult] = useState<Result>(); const [error, setError] = useState("");
  useEffect(() => { Promise.all([fetch("/api/v1/models").then(r => r.json()), fetch("/api/v1/health").then(r => r.json())]).then(([catalog, health]) => { setModels(catalog.models ?? []); setFineTunes(catalog.fineTunes ?? []); setConfiguredProviders((health.providers ?? []).filter((p: { configured: boolean }) => p.configured).map((p: { provider: string }) => p.provider)); }).catch(() => setError("Could not load the model catalog.")); }, []);
  const modelName = useMemo(() => Object.fromEntries(models.map(m => [m.id, title(m)])), [models]);
  const execution = mode === "manual" ? { mode, modelId: selectedModel } : mode === "multi-agent" ? { mode, agents } : { mode };
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(""); setResult(undefined); setStatus("routing");
    try {
      const constraints = mode === "manual" ? { allowed_models: [selectedModel] } : undefined;
      const r = await fetch("/api/v1/route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, optimize: objective, constraints }) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error); setRoute(data); setStatus("generating");
      const g = await fetch("/api/v1/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, optimize: objective, constraints, execution }) });
      const generated = await g.json(); if (!g.ok) throw new Error(generated.error); setResult(generated); setStatus("idle");
    } catch (err) { setError(err instanceof Error ? err.message : "Request failed"); setStatus("idle"); }
  }
  function updateAgent(index: number, value: Partial<Agent>) { setAgents(current => current.map((agent, i) => i === index ? { ...agent, ...value } : agent)); }
  return <main>
    <nav><span className="mark">✦</span><strong>HYPERION</strong><span className="provider-state">{configuredProviders.length ? `${configuredProviders.join(" + ")} connected` : "no provider connected"}</span><span className="tag">ORCHESTRATION CONSOLE</span></nav>
    <section className="hero"><p className="eyebrow">MODEL INTELLIGENCE</p><h1>Build the right<br/><i>mind for the job.</i></h1><p className="lede">Route one prompt, deliberately choose one model, or assemble a team whose individual strengths are visible before it runs.</p></section>
    <form onSubmit={submit} className="composer">
      <textarea value={prompt} onChange={e => setPrompt(e.target.value)} aria-label="Prompt" />
      <div className="execution-tabs" aria-label="Execution mode">{(["route", "manual", "multi-agent"] as const).map(value => <button type="button" className={mode === value ? "active" : ""} onClick={() => setMode(value)} key={value}>{value === "route" ? "Auto route" : value === "manual" ? "Choose model" : "Multi-agent"}</button>)}</div>
      {mode === "manual" && <label className="picker">Run with <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)} required><option value="" disabled>Choose a model</option>{models.map(model => <option value={model.id} key={model.id}>{title(model)} · intelligence {model.metrics?.intelligence ?? "–"}</option>)}</select></label>}
      {mode === "multi-agent" && <div className="agent-builder"><div className="agent-head"><span>TEAM COMPOSITION</span><button type="button" onClick={() => setAgents(a => [...a, { id: crypto.randomUUID(), role: "critic" }])} disabled={agents.length >= 6}>+ Add agent</button></div>{agents.map((agent, index) => <div className="agent-row" key={agent.id}><select value={agent.role} onChange={e => updateAgent(index, { role: e.target.value as Agent["role"] })}>{roles.map(role => <option value={role} key={role}>{role}</option>)}</select><select value={agent.modelId ?? ""} onChange={e => updateAgent(index, { modelId: e.target.value || undefined })}><option value="">Auto-select by role</option>{models.map(model => <option value={model.id} key={model.id}>{title(model)}</option>)}</select><button type="button" className="remove" onClick={() => setAgents(a => a.filter((_, i) => i !== index))} disabled={agents.length === 1}>×</button></div>)}</div>}
      <div className="controls"><select value={objective} onChange={e => setObjective(e.target.value)} aria-label="Optimization objective"><option value="quality">Best quality</option><option value="balanced">Balanced</option><option value="speed">Fastest</option><option value="cost">Cheapest</option></select><button className="run" disabled={status !== "idle" || (mode === "manual" && !selectedModel)}>{status === "routing" ? "Planning…" : status === "generating" ? "Running…" : mode === "multi-agent" ? "Launch team →" : "Run prompt →"}</button></div>
    </form>
    {models.length > 0 && <section className="catalog"><div><p className="eyebrow">MODEL CATALOG</p><h2>Decision signals</h2></div><div className="model-grid">{models.map(model => <article key={model.id}><h3>{title(model)}</h3><p>{model.provider} · ${model.pricing.inputPerMillion}/${model.pricing.outputPerMillion} per M tokens</p><div className="signals">{Object.entries(model.metrics ?? {}).map(([key, value]) => <span key={key}>{key.slice(0, 3)} <b>{value}</b></span>)}</div></article>)}</div></section>}
    {fineTunes.length > 0 && <section className="finetunes"><p className="eyebrow">FINE-TUNE REGISTRY</p>{fineTunes.map(ft => <span key={ft.displayName}><b>{ft.displayName}</b> · {ft.status} · based on {modelName[ft.baseModel] ?? ft.baseModel} · {ft.specializations.join(", ")}</span>)}</section>}
    {error && <p className="error">{error}</p>}
    {route && <section className="results"><div className="analysis"><p className="eyebrow">EXECUTION PLAN</p><h2>{route.reason}</h2><div className="metrics"><span>Confidence <b>{Math.round(route.confidence * 100)}%</b></span><span>Est. cost <b>${route.estimated_cost_usd.toFixed(4)}</b></span><span>Est. latency <b>{Math.round(route.estimated_latency_ms)}ms</b></span></div></div><div className="candidates">{route.candidates.map((c: any, i: number) => <article className={i === 0 ? "chosen" : ""} key={c.model}><small>{i === 0 ? "SELECTED" : "ALTERNATIVE"}</small><h3>{modelName[c.model] ?? c.model}</h3><b>{Math.round(c.score * 100)} <em>utility</em></b></article>)}</div></section>}
    {result && <section className="answer"><div className="answer-head"><span>{result.execution ? "TEAM OUTPUT" : "OUTPUT"}</span><span>{result.model.provider}/{result.model.name} · {result.latency_ms}ms · ${result.usage.cost_usd.toFixed(4)}</span></div>{result.execution && <div className="run-log">{result.execution.agents.map(agent => <span key={agent.id}><b>{agent.role}</b> → {agent.model}</span>)}</div>}<pre>{result.output}</pre><p>{result.routing.alternative_reason}</p></section>}
    <footer>CATALOG-DRIVEN ROUTING · PROVIDER KEYS STAY SERVER-SIDE</footer>
  </main>;
}
