# Hyperion

Hyperion currently provides a polished single-model chat foundation for a future dynamic multi-model software-engineering agent. It talks to a configurable OpenAI-compatible Chat Completions endpoint and deliberately contains no model routing or project-agent behavior yet.

## Current surfaces

- A streaming chat in the Hyperion activity-bar view and an optional editor panel.
- Conversation history stored locally in VS Code workspace state.
- Stop generation, new chat, message/code copying, and provider error handling.
- A configurable OpenAI-compatible base URL, model, system prompt, and timeout.
- API keys stored through VS Code SecretStorage rather than settings or source files.

## Configure a provider

1. Run **Hyperion: Set API Key** and enter the provider key. Anonymous local endpoints can skip this step.
2. Open VS Code settings and search for **Hyperion** to set the API base URL and model identifier.
3. Run **Hyperion: Open Chat** or select the Hyperion activity-bar icon.

The default API base URL is `https://api.openai.com/v1`. For another compatible provider, set the base URL to its versioned API root; Hyperion appends `/chat/completions` automatically.

## Develop locally

```sh
npm install
npm run compile
```

Open this folder in VS Code and press `F5` to launch an Extension Development Host. Run `Hyperion: Open Chat` from the Command Palette.

## Planned, not implemented

- Codebase profiling
- Model benchmark and capability data
- Cost and latency scoring
- Task decomposition and live routing
- Tools, repository mutation, telemetry, and agent execution

The current chat does not read workspace files, use tools, select among models, or delegate subtasks.
