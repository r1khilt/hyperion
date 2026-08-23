# Benchmark catalog

`benchmarks.json` is Hyperion's simple, local registry of major model and agent evaluations. It holds stable metadata only; it intentionally contains **no leaderboard snapshots**.

Benchmarks are not interchangeable. A result must always retain:

- benchmark ID and dataset version or date window;
- exact model identifier;
- metric and direction;
- evaluation harness and agent/tool configuration;
- date evaluated; and
- a link to the official leaderboard or experiment artifact.

Use the `scoreRecordShape` object in `benchmarks.json` as the minimum shape for future result records. Keep records in a separate `scores.json` file or database table so stale or incomparable scores cannot be mistaken for current model intelligence.

For initial routing, prioritize the closest capability category rather than averaging unrelated benchmarks. For example: use SWE-bench Verified, Terminal-Bench, and LiveCodeBench for a coding agent; use BFCL/tau-bench for tool use; and use RULER/LongBench only when context length is a genuine requirement.
