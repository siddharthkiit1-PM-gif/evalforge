# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

EvalForge turns an AI feature spec into a runnable eval suite via a Gemini 2.5 Pro agent that picks one tool per iteration until all rubric dimensions pass (or a budget cap is hit). See `README.md` for the public-facing description and `AGENTS.md` for code conventions — both are required reading.

@AGENTS.md

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Next.js dev server (port 3000, Turbopack) |
| `npm run build` | Production build |
| `npm run lint` | ESLint (Next.js config) |
| `npm run test` | Vitest watch mode |
| `npm run test:run` | Vitest single CI-style run (use this for verification) |

Run a single test file: `npx vitest run src/lib/agent/__tests__/orchestrator.test.ts`
Run by test name: `npx vitest run -t "planner picks one tool"`
Run a single file in watch mode: `npx vitest src/lib/refinement.ts`

## Environment

- `GOOGLE_GENERATIVE_AI_API_KEY` — required. The provider is `@ai-sdk/google` **direct**, not the Vercel AI Gateway.
- `KV_REST_API_URL` + `KV_REST_API_TOKEN` — required in production for pause/resume to survive serverless cold starts. Without them the orchestrator falls back to in-memory state (fine for `npm run dev`, broken on Vercel).

## Architecture (the parts you must read multiple files to understand)

### The agent loop

`src/lib/agent/orchestrator.ts` is an **async generator**. The planner sees `{ state, budget, recentHistory }` and picks **exactly one tool per iteration**. The tool runs, returns a state update, tokens are charged against `budget.ts`, and the generator yields an SSE event. The loop terminates on `early_stop`, all-dimensions-pass, budget exhaustion, or `clarify_with_user` (which suspends to KV).

The 12 tools live one-per-file under `src/lib/agent/tools/` and are registered in `src/lib/agent/orchestratorTools.ts`. Every tool defines a Zod schema for its args — never accept untyped tool inputs. Split into three categories:

- **Build pipeline**: `parseSpec`, `generateTestsTool`, `generateRubricTool`, `runEvalNow`
- **Improvers**: `diagnose`, `addTests`, `addAdversarial`, `reviseRubric`, `tightenDescriptors`, `rewriteTest`, `rerunEval`
- **Control**: `clarify`, `earlyStop`

### State persistence

`src/lib/orchState/store.ts` wraps Upstash. On `clarify_with_user`, the orchestrator persists state keyed by run-id and the `/api/orchestrate/resume` route picks it back up. Treat KV state as the source of truth across HTTP requests — never reconstruct state from client-side data.

### SSE everywhere

All `/api/*` routes stream Server-Sent Events. The contract is a discriminated union — `event.type` narrows the payload. Consumer reducers (notably `src/lib/pageReducer.ts`) MUST narrow on `event.type` and handle unknown types as a no-op, never crash. When adding a new event type, add it to the union, add a reducer branch, and add tests for both.

### Refinement loop (separate from the agent)

`src/lib/refinement.ts` is the **per-stage** generate → critique → revise loop used inside individual pipeline steps (e.g., when generating tests once). Distinct from the agent loop, which orchestrates across stages. Don't conflate them.

### UI state machine

`src/app/page.tsx` is driven by `pageReducer.ts` — a discriminated-union state machine. Stage states are unions, not optional booleans. When adding a new stage or branch, extend the union and add a reducer test in `src/lib/__tests__/pageReducer.test.ts`.

## Stack notes

- **Next.js 16.2.4** has breaking changes vs prior majors. Before writing routing/server-action code, check `node_modules/next/dist/docs/` and heed deprecation notices. Do not rely on training-data Next.js APIs.
- **Vercel AI SDK v6** — `streamObject` / `generateObject` with Zod schemas. Use Gemini 2.5 Pro (`gemini-2.5-pro`) as planner, judge, and actor.
- **Tailwind 4** with `@tailwindcss/postcss`. No `tailwind.config.js` — config is in CSS.
- **Vitest 4** + jsdom + React Testing Library. ~275 tests across ~52 files; tests are co-located in `__tests__/` folders next to source.

## Conventions that bite if ignored

- **TDD is mandatory.** Every tool, prompt builder, and reducer branch has a Vitest test. Add the failing test first.
- **"Humanizer" voice** in prompt builders (`src/lib/prompts.ts`) — generated tests must read like real users typed them, not like test scaffolding. Don't sanitize the voice when refactoring.
- **One tool per file** under `src/lib/agent/tools/`. New tool = new file + register in `orchestratorTools.ts` + Zod schema + test.
- **Discriminated unions over optional booleans** for any state or event shape.

## Suggested improvements to this file over time

- If the tool count diverges from 12, update the count and the table in `README.md`.
- If a non-Gemini judge is added, the "single model family" caveat in `README.md` and the env section here both need an update.
- If pause/resume gains a different storage backend, update the environment section.

---

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
