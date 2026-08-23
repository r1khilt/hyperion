# Hyperion

Hyperion is a VS Code extension shell for a future dynamic multi-model software-engineering agent. It is intentionally presentation-only for now: it does not inspect a repository, call a model, route tasks, collect benchmark data, or store credentials.

## Current surfaces

- **Hyperion: Open Dashboard** shows the product overview and empty routing state.
- **Hyperion: Analyze Workspace** opens the dashboard with a clear placeholder notice.
- The **Hyperion** activity-bar view provides the same entry point.
- A status-bar item makes the dashboard easy to reopen.

## Develop locally

```sh
npm install
npm run compile
```

Open this folder in VS Code and press `F5` to launch an Extension Development Host. Run `Hyperion: Open Dashboard` from the Command Palette.

## Planned, not implemented

- Codebase profiling
- Model benchmark and capability data
- Cost and latency scoring
- Task decomposition and live routing
- Model execution, tools, credentials, telemetry, and persistence
