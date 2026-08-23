# Model costs

`model-costs.json` joins each of the 50 registry models to its token pricing. It points back to `models.json` by `modelId` and to `model-pricing.json` where the existing catalog already has the exact model.

All numeric prices are USD per one million tokens. `cachedInput` may be `null` when a route does not publish a separate cache-read rate. Prices exclude tool calls, search, batch, priority, hosting, and regional fees.

`pricing: null` means that no current public price was found for the exact model, usually because it is a retired API SKU or open-weight. It must never be treated as free; self-hosted cost depends on the hardware and deployment configuration.

The data is deliberately route-aware. Benchmark results identify the model; pricing identifies the exact model route whose price was observed. When those differ within a model family, the note names the priced variant.
