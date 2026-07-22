# Model Task Contract

## Responsibility

- Freeze one bounded, provider-neutral semantic request with refs, prompt/schema versions, data classification, budgets, idempotency, trace identity, and canonical hash.
- First adopted task type is `research_hypothesis`; later task types require their own domain validator and adoption evidence.

## Boundaries

- Carries no credential, endpoint, provider model id, shell command, database path, exchange request, or tool invocation.
- Allows only public/project-internal context; private account facts and secrets are rejected.
- Model output is a proposal and has `execution_authority=none`; domain owners still validate and decide persistence.
