# Hyperion

Hyperion provides a streaming chat foundation for a dynamic multi-model software-engineering agent. It can talk to a configurable OpenAI-compatible endpoint, Anthropic's native Messages API, or execute a model decider's result through GMI Cloud.

## Current surfaces

- A streaming chat in the Hyperion activity-bar view and an optional editor panel.
- Conversation history stored locally in VS Code workspace state.
- Stop generation, new chat, message/code copying, and provider error handling.
- OpenAI-compatible, Anthropic, and GMI Cloud provider settings, models, system prompt, and timeout.
- Separate provider API keys stored through VS Code SecretStorage rather than settings or source files.
- A typed GMI Cloud end effector that accepts a prompt plus the decider's exact GMI model identifier, streams the request, and returns the complete response.

## Configure a provider

1. Run **Hyperion: Select Chat Provider** and choose OpenAI-compatible, Anthropic, or GMI Cloud.
2. Run **Hyperion: Set API Key** and enter the key for the selected provider. Anonymous OpenAI-compatible local endpoints can skip this step.
3. Open VS Code settings and search for **Hyperion** to set provider-specific API base URLs and model identifiers.
4. Run **Hyperion: Open Chat** or select the Hyperion activity-bar icon.

The OpenAI-compatible default base URL is `https://api.openai.com/v1`; Hyperion appends `/chat/completions` automatically. The Anthropic default is `https://api.anthropic.com/v1`; Hyperion appends `/messages` automatically.

## Configure GMI Cloud

1. In the Extension Development Host, run **Hyperion: Select Chat Provider** and select **GMI Cloud**.
2. Run **Hyperion: Set API Key** and paste your GMI Cloud API key into the password input. This is the only place you need to enter it. The key is stored in VS Code SecretStorage and is not written to this repository.
3. Optionally set **Hyperion › Gmi: Organization Id** if your GMI account uses multi-organization access.
4. Until the model decider is connected, set **Hyperion › Gmi: Fallback Model** to an exact model ID available to your GMI account.

Hyperion uses GMI's OpenAI-compatible `https://api.gmi-serving.com/v1/chat/completions` endpoint with Bearer authentication. See the [GMI Cloud LLM API reference](https://docs.gmicloud.ai/inference-engine/api-reference/llm-api-reference).

## Connect the model decider

The integration boundary is intentionally small. A decider supplies the exact GMI model identifier:

```ts
import { ModelDecider } from "./gmiCloudEndEffector";

const modelDecider: ModelDecider = {
  async decide(prompt) {
    return { model: await chooseGmiModel(prompt) };
  },
};

const session = new ChatSession(context, modelDecider);
```

Replace the `new ChatSession(context)` call in `src/extension.ts` with the final line above when the decider is available. For GMI Cloud chat, `ChatSession` invokes the decider once per user prompt and passes its result to `GmiCloudEndEffector`; the configured fallback is only used when no decider is injected.

The end effector can also be used independently:

```ts
const result = await new GmiCloudEndEffector().execute(
  { decision: { model: "deepseek-ai/DeepSeek-R1" }, prompt: "Explain this diff." },
  gmiApiKey,
);

console.log(result.content);
```

## Develop locally

```sh
npm install
npm run compile
```

Open this folder in VS Code and press `F5` to launch an Extension Development Host. Run `Hyperion: Open Chat` from the Command Palette.

## Model pricing data

`data/model-pricing.json` contains a source-linked catalog spanning 50 model developers. Major-provider entries use official first-party prices, while the wider catalog uses normalized OpenRouter route prices. Prices are USD per one million tokens; provider-specific long-context and cache charges are represented where applicable.

## Model latency data

`data/model-latency.json` contains endpoint-specific latency and generation-throughput snapshots for the exact same provider/model set as `data/model-pricing.json`, spanning 50 model developers. Measurements keep TTFT, post-first-token throughput, end-to-end latency, hosting provider, workload, region, service tier, source, and confidence separate; unavailable metrics are `null`. Most numeric entries are rolling p50 Artificial Analysis measurements, so consumers should treat them as time-sensitive observations rather than fixed properties of a model.

## Planned, not implemented

- Codebase profiling
- Model benchmark and capability data
- Cost and latency scoring
- Task decomposition and the model-decider implementation
- Tools, repository mutation, telemetry, and agent execution

The current chat does not read workspace files, use tools, select among models, or delegate subtasks.
