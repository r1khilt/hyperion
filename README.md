# Hyperion

Hyperion is a Next.js model-routing API and polished developer demo. It classifies a request, deterministically filters provider/model configurations, scores eligible candidates across quality, reliability, cost, and latency, then executes the best available provider.

## Run locally

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

## VS Code extension

This repository also ships the existing Hyperion VS Code chat extension. It has its own streaming-chat provider configuration and stores extension API keys with VS Code SecretStorage. Build it with `npm run compile`, then press `F5` in VS Code to launch an Extension Development Host. The web app and extension are separate surfaces; the extension has not yet been wired to the web router or multi-agent API.
