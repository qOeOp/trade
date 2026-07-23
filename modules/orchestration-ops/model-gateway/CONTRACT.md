# Model Gateway Contract

## Responsibility

- Execute one bounded provider-neutral model task through a fixed profile and the `SILICONFLOW_API_KEY` process secret.
- Probe Chat JSON、SSE stream、single / multi tool call、tool continuation and Responses endpoint as a sanitized capability matrix; raw model/provider payloads are never persisted.
- Enforce capability, timeout, retry, input/output/token budgets, non-thinking JSON generation, JSON parsing, truncation handling, redacted trace refs, and typed failure classes.
- Provide a fixed, argument-free `provider:smoke` probe that requires an exact JSON semantic marker and returns only the sanitized task result; it does not persist evidence or grant authority.

## Boundaries

- Does not validate a research hypothesis, persist/queue domain output, call tools, databases, exchange, or event stores.
- Never returns credential, Authorization header, prompt text, raw response body, reasoning content, or private provider error body.
- A completed result remains `execution_authority=none`; the domain owner must validate the parsed proposal.
