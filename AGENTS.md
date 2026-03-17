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
