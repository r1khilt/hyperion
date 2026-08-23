# Model registry

`models.json` defines a 50-model working cohort and its documented benchmark results. Each model is implicitly paired with **every** ID in `benchmarks.json`.

An empty `results` array is intentional: it means no result has been added yet, not that the model scored zero or has not been evaluated. This keeps Hyperion from treating missing public data as a performance signal.

Only compare records with the same benchmark version, metric, harness, tool permissions, retry count, and date window. In particular, do not merge SWE-bench Verified, SWE-bench Pro, and SWE-bench Lite, or different Terminal-Bench versions.

To add a result, append an object matching `resultShape` to that model's `results` array. Keep the primary source URL and protocol note. A future ingestion pass can expand coverage without changing the model or benchmark schemas.
