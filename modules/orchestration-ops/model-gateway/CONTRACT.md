# Model Gateway Contract

## Responsibility

- Execute one bounded provider-neutral model task through a fixed profile and the `SILICONFLOW_API_KEY` process secret.
- Enforce capability, timeout, retry, input/output/token budgets, JSON parsing, truncation handling, redacted trace refs, and typed failure classes.

## Boundaries

- Does not validate a research hypothesis, persist/queue domain output, call tools, databases, exchange, or event stores.
- Never returns credential, Authorization header, prompt text, raw response body, reasoning content, or private provider error body.
- A completed result remains `execution_authority=none`; the domain owner must validate the parsed proposal.
