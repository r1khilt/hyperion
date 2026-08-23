# Hyperion

Hyperion combines a Next.js model-routing API with an approval-gated VS Code coding agent. The web API classifies requests, filters and scores eligible models, and executes the best provider. The extension can inspect, edit, and verify the open workspace through native tool calls using OpenAI-compatible, Anthropic, GMI Cloud, or OpenRouter models.

## Run the web app locally

```sh
cp .env.example .env.local
npm install
npm run dev
```

Add at least one provider key to `.env.local`, then open http://localhost:3000. Restart the server whenever you change a key. The server starts without keys, but no model is eligible until a provider is configured.

## API

```ts
const response = await fetch("http://localhost:3000/api/v1/generate", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: "Implement A* in Python", optimize: "quality" })
});
const result = await response.json();
console.log(result.output, result.model, result.routing.reason);
```

- `POST /api/v1/route` selects a model without executing it.
- `POST /api/v1/generate` selects and runs it, with provider-failure fallback.
- `POST /api/v1/compare` runs explicitly requested candidates in parallel.

## Architecture

`data/models/catalog.json` is the single editable source for model metadata and pricing; `src/lib/model-registry.ts` loads it. `src/lib/router/` owns analysis, deterministic filters, scoring, confidence, and explanations. `src/lib/providers/` isolates real OpenAI, Anthropic, and Google SDK calls. `src/lib/repository.ts` provides an in-memory store behind a Postgres-ready interface.

The task analyzer currently uses a validated deterministic fallback so routing works without spending an extra model call. A multi-agent run executes the user-defined team sequentially and carries earlier work into later agents. Output judging, historical priors, semantic retrieval, shadow routing, and Postgres persistence are intentionally isolated extension points and disabled/not implemented rather than simulated.

## Environment variables

`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `GOOGLE_API_KEY` enable their respective providers. The remaining variables in `.env.example` reserve analyzer, judge, shadow-routing, and database configuration.

Run `npm run typecheck`, `npm run build`, and `npm run benchmark` (with a provider key) to verify the application.

## VS Code coding agent

The extension provides streaming chat, local conversation history, image and text attachments, provider reasoning traces, and settings for the active model and workspace context. It stores provider keys in VS Code SecretStorage.

Run **Hyperion: Select Chat Provider**, choose OpenAI-compatible, Anthropic, GMI Cloud, or OpenRouter, then run **Hyperion: Set API Key**. GMI Cloud can use an injected model-decider result and otherwise falls back to its configured model. OpenRouter requests tool-capable routes.

Build the extension with `npm run compile`, then press `F5`. The development host opens the current checkout through a relative workspace file, keeping workspace tools scoped to that repository.

## Agent safety

Hyperion asks for approval before every workspace read, search, edit, or command. It never follows a path outside the first open workspace folder, including through existing symlinks. It always excludes `.git`, `node_modules`, and `.hyperionignore`; add a root `.hyperionignore` file for additional files or directories. The matcher supports common `*`, `**`, `?`, directory, and `!` patterns.

Commands run from the workspace root and return capped output to the model. Treat command approval as equivalent to allowing a local shell command under your VS Code user account.

## Planned, not implemented

- Codebase profiling
- Model benchmark and capability data
- Cost and latency scoring
- Task decomposition and live routing
- Semantic/vector codebase indexing
- Automated approval policies
- Wiring the extension directly to the web router and multi-agent API
