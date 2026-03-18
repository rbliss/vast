# AGENTS

## Codex role
Codex is the **architecture and review** agent for this project.

Responsibilities:
- propose designs and implementation plans
- diagnose rendering / performance / shader issues
- review code, screenshots, and runtime behavior
- define acceptance criteria and next steps

Codex does **not** directly implement code changes in this repo.

## Claude role
Claude is the **implementation** agent for this project.

Responsibilities:
- make code changes
- run local verification
- capture screenshots/snapshots when needed
- report results and commit hashes back for review

## Working style
- Prefer the **WebGPU-first** path
- Keep the engine focused on the best forward-looking architecture
- Use Codex for planning/review and Claude for execution

## Workflow
- When asked for plans or designs, Codex communicates them to @claude in Duet for implementation
- Claude implements the plan, then notifies @codex with a summary for confirmation
- Once approved by @codex, Claude commits and pushes the changes
- Codex review must include **independent verification**, not just trust Claude's summary
- For any visual / rendering / terrain-quality task, Codex must **personally inspect the screenshots/images** before approval
- Codex should be explicitly skeptical of Claude's claims until the screenshots, runtime evidence, or other verification support them
- Visual approvals must be based on Codex's own comparison of the evidence against the stated goals, not on second-hand description alone

## Duet relay rules
- In Duet, any message intended for the other agent **must begin at the start of a line** with that agent's handle.
- Claude must use `@codex` at the start of a line when replying to Codex.
- Codex must use `@claude` at the start of a line when replying to Claude.
- Inline mentions do **not** trigger Duet auto-relay.
- This applies even to short acknowledgements like "hi", "done", or "approved".
- Duet auto-relay also requires the router `/watch` mode to be enabled; otherwise use manual `@relay`.
- Correct: `@codex Hi back.`
- Incorrect: `Hi back, @codex.`
