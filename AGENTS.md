# Engineering requirements

For changes affecting paid APIs, background jobs, polling, retries, cache keys or invalidation:

- Calculate steady-state, cold-start/cache-invalidation and upstream-failure request volume using current production population (baseline: 25,000 identities across three chains). Include batch members, concurrency, retries and process restarts. State assumptions and distinguish requests from provider billing credits.
- Add or update executable request-volume regression tests. Functional correctness alone is insufficient. Mock paid services in tests; do not use production credentials.
- Default new recurring work to disabled. Preserve persistent global and workload budgets; reject before network I/O. Enrichment must not consume ingestion's reserved capacity.
- Never enable bulk work, raise production budgets, change the production budget policy or bypass deployment checks without explicit user authorization for that change. Existing authorization for ordinary feature work does not authorize increased recurring spending.
- Before enabling recurring work, run a bounded trial with an expiry and request cap; report measured requests by workload and method, errors and projected daily volume. Preserve a rollback path and cached serving when reads stop.
- Run the indexer tests and TypeScript checks before declaring the work complete. Explain operational limitations and distinguish measured results from estimates.

Deployment is a separate manual workflow action after CI passes. Do not restore deployment on push or remove these checks as part of unrelated changes. Instructions are guidance: keep cost limits enforced in code and independently in infrastructure wherever available.
