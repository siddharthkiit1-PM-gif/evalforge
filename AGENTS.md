<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# EvalForge conventions

## Stack
- Next.js 16.2.4 App Router, React 19, TypeScript 5, Tailwind 4
- Vercel AI SDK v6 with `@ai-sdk/google` (direct provider — NOT the AI Gateway). Env var: `GOOGLE_GENERATIVE_AI_API_KEY`
- Gemini 2.5 Pro as planner/judge/actor
- Upstash Redis via `KV_REST_API_URL` / `KV_REST_API_TOKEN` for orchestrator pause/resume

## Code conventions
- TDD: write the failing test first. Every tool, prompt builder, and reducer branch has a Vitest test.
- Discriminated unions over optional booleans. Stage states and SSE events are unions you narrow on (`pageReducer.ts`).
- One tool per file under `src/lib/agent/tools/`, registered in `orchestratorTools.ts`.
- Every tool defines a Zod schema for its args. No untyped tool inputs.
- "Humanizer" voice in prompts (`src/lib/prompts.ts`) — generated tests should read like real users typed them.
- SSE routes stream events; consumer reducers narrow on `event.type`.

## Test commands
- `npm run test:run` — single CI-style run
- `npm run test` — watch mode
- `npm run lint` — ESLint (Next.js config)

## Architecture quick map
- `src/app/api/orchestrate/route.ts` — full agent loop (SSE)
- `src/app/api/orchestrate/resume/route.ts` — resumes after clarification
- `src/lib/agent/orchestrator.ts` — async generator, planner picks one tool per iteration
- `src/lib/agent/orchestratorTools.ts` — 12-tool registry
- `src/lib/orchState/store.ts` — Upstash KV persistence
- `src/lib/refinement.ts` — generate → critique → revise loop (per pipeline stage)
- `src/lib/pageReducer.ts` — discriminated-union UI state machine
