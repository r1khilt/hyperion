# Hyperion

Hyperion currently provides a polished single-model chat foundation for a future dynamic multi-model software-engineering agent. It talks to either a configurable OpenAI-compatible Chat Completions endpoint or Anthropic's native Messages API and deliberately contains no model routing or project-agent behavior yet.

## Current surfaces

- A streaming chat in the Hyperion activity-bar view and an optional editor panel.
- Conversation history stored locally in VS Code workspace state.
- Stop generation, new chat, message/code copying, and provider error handling.
- Manually selected OpenAI-compatible or Anthropic provider settings, models, system prompt, and timeout.
- Separate provider API keys stored through VS Code SecretStorage rather than settings or source files.

## Configure a provider

1. Run **Hyperion: Select Chat Provider** and choose OpenAI-compatible or Anthropic.
2. Run **Hyperion: Set API Key** and enter the key for the selected provider. Anonymous OpenAI-compatible local endpoints can skip this step.
3. Open VS Code settings and search for **Hyperion** to set provider-specific API base URLs and model identifiers.
4. Run **Hyperion: Open Chat** or select the Hyperion activity-bar icon.

The OpenAI-compatible default base URL is `https://api.openai.com/v1`; Hyperion appends `/chat/completions` automatically. The Anthropic default is `https://api.anthropic.com/v1`; Hyperion appends `/messages` automatically.

## Develop locally

```sh
npm install
npm run compile
```

Open this folder in VS Code and press `F5` to launch an Extension Development Host. Run `Hyperion: Open Chat` from the Command Palette.

## Model pricing data

`data/model-pricing.json` contains a source-linked catalog spanning 50 model developers. Major-provider entries use official first-party prices, while the wider catalog uses normalized OpenRouter route prices. Prices are USD per one million tokens; provider-specific long-context and cache charges are represented where applicable.

## Planned, not implemented

- Codebase profiling
- Model benchmark and capability data
- Cost and latency scoring
- Task decomposition and live routing
- Tools, repository mutation, telemetry, and agent execution

The current chat does not read workspace files, use tools, select among models, or delegate subtasks.
