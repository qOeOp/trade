# Development chunks

## Select a scope

Select one deliverable, readable outcome from a user story. Identify its Owner, input producer, actual consumer
and permission boundary. It may be an internal function or a service handoff; a missing homepage node does not
prevent development. Complete missing design before implementation and update it with the measurement.

## Minimal check

| Question                   | Required clarity                                                        |
| -------------------------- | ----------------------------------------------------------------------- |
| What does the user receive | Observable outcome and completion condition                             |
| Who owns it                | One fact writer, necessary inputs and consumer                          |
| What is reused             | Current Nautilus API or existing service operation and the concrete gap |
| What happens on failure    | Refusal, unknown state, duplicate request and recovery behavior         |
| How is it verified         | Real consumer, necessary boundary checks and current repository gates   |

The Agent organizes planning and evidence. Prose, source references and execution results suffice; no fixed planning
JSON, default full test suite, diagram registration or general task state machine is required. Larger changes may be
split into deliveries, each preserving unique authority, permissions and existing refusals.

## Evidence and permission

Evidence identifies the actual candidate, inputs and execution result. An outdated reference cannot replace
current source verification. The [Agent implementation guide](./agent-implementation/) explains native API checks.
Update owning chapters when architecture or business boundaries change; changes to user purpose, trading authority
or protected seals follow `AGENTS.md`.

The existing `validate:development-chunk` utility is optional for structured records. Its strict fields, immutable
Git resolution and validation still apply when used. It grants no development or production authority and is not a
required entry for ordinary development, research experiments or native strategy submission.
