# EvalForge — Design Doc

Date: 2026-05-02
Status: Approved for planning
Source spec: User-provided "EvalForge — Step-by-Step Build Plan (Gemini Edition)" (verbatim in this conversation)

## Purpose

Single-page web app that takes an AI feature spec as input, uses Gemini 2.5 Flash to:
1. Parse the spec into structured fields + detect domain.
2. Generate a 20-test suite tailored to that domain.
3. Generate an evaluation rubric with domain-specific dimensions.
4. Run the suite (Gemini-as-feature, then Gemini-as-judge) with live progress.
5. Render a scorecard + JSON export.

Demo / portfolio app. One user (the developer). No persistence, no auth, no multi-tenancy.

## Approved spec

The user-supplied build plan is the canonical functional spec. Phases, prompts, copy, design tokens, rate-limit numbers, and example chips are all binding. This doc records only **deltas, adaptations, and architectural decisions** that the source spec does not pin down.

## Tech stack (locked)

- **Next.js 16.2.4** (App Router) — already scaffolded. AGENTS.md flags breaking changes from training data; consult `node_modules/next/dist/docs/` before writing routes/layouts.
- **React 19.2.4**.
- **Tailwind v4** with `@tailwindcss/postcss` — design tokens live in `src/app/globals.css` under `@theme` (NOT `tailwind.config.ts` as the source spec assumes; semantically identical).
- **TypeScript 5**, strict.
- **`@google/genai` 1.51.0** — already installed.
- **Vitest + @testing-library/react + jsdom** — added in Plan A.
- **Vercel** — deploy target. `GEMINI_API_KEY` set via `vercel env`. Default Fluid Compute, Node.js runtime.

## Adaptations from source spec

| # | Source spec says | Actual approach | Why |
|---|------------------|-----------------|-----|
| 1 | `tailwind.config.ts` extending `colors`/`fontFamily` | `@theme` block in `globals.css` with same tokens | Tailwind v4 is CSS-first; v3 config syntax is gone |
| 2 | Model id `gemini-2.5-flash-preview-04-17` | Verified current Flash GA id at build time; surfaced as a single constant in `lib/gemini.ts` | The April-2024 preview alias has likely rotated |
| 3 | "streaming fade-in" (vague) | Server-Sent-Events-style framing over a POST + `ReadableStream` route handler; client reads via `fetch().body.getReader()` | Cleaner than `EventSource` (no session store), and Next.js 16 streams Web standard `Response` objects |
| 4 | No mention of testing | Vitest + RTL with all Gemini calls mocked via `vi.mock('@/lib/gemini')` | User chose full TDD; preserves the 250 RPD budget |
| 5 | Run history / persistence | None — single-page client state via `useReducer` in `page.tsx` | YAGNI for a demo; spec doesn't require it |

## Architecture

```
src/
├── app/
│   ├── layout.tsx                      # fonts, Nav, Footer, max-w-1200, dark bg
│   ├── page.tsx                        # client component, useReducer state machine
│   ├── globals.css                     # @theme tokens (Tailwind v4)
│   └── api/
│       ├── parse-spec/route.ts         # POST  → ParsedSpec JSON
│       ├── generate-tests/route.ts     # POST  → TestCase[] JSON
│       ├── generate-rubric/route.ts    # POST  → Rubric JSON
│       └── run-eval/route.ts           # POST  → ReadableStream of SSE events
├── components/
│   ├── Nav.tsx                Footer.tsx
│   ├── SpecInput.tsx          DomainBadge.tsx
│   ├── TestSuiteTable.tsx     RubricPanel.tsx
│   ├── EvalRunner.tsx         Scorecard.tsx
└── lib/
    ├── gemini.ts                       # client + generateJSON/generateText + withRetry + runBatched
    ├── prompts.ts                      # all 4 system prompts as exported strings
    └── types.ts                        # ParsedSpec, TestCase, Rubric, EvalResult, SSEEvent
```

### Client state machine (page.tsx)

States: `idle → parsing → tests_generating → rubric_generating → ready → running → done | error`.
Reducer handles transitions; each API call dispatches `*_STARTED`/`*_SUCCEEDED`/`*_FAILED`. SSE events from the run dispatch per-test `TEST_STARTED` / `TEST_COMPLETED`.

### `/api/run-eval` SSE protocol

Request body: `{ featureSpec: string, tests: TestCase[], rubric: Rubric }`.
Response: `text/event-stream`, lines framed as `event: <type>\ndata: <json>\n\n`.

Event types:
- `start` — `{ totalTests }`
- `test_started` — `{ testId, index }`
- `test_completed` — `{ testId, index, output, scores, passed }`
- `error` — `{ testId?, message }`
- `done` — `{ summary }`

Server iterates batches of 2 with a 15s gap (per source spec rate-limit math) and writes events into the stream as each test resolves.

### Rate-limit handling

`lib/gemini.ts` exports:
- `withRetry(fn)` — catches `status === 429`, retries with exponential backoff (10s, 20s, 40s; max 3 attempts).
- `runBatched(items, fn, { concurrency: 2, gapMs: 15000 })` — used only by the eval runner.

Spec parse / test generation / rubric generation are single calls; they get `withRetry` but no batching.

## Test strategy

- **Component tests** (RTL): render component, fire events, assert DOM. No network.
- **Pure logic tests**: prompts file (template substitution), rate limiter, retry handler with fake timers, JSON-from-Gemini parser tolerance.
- **Route handler tests**: import the route's exported `POST` function directly, hand it a `Request`, mock `lib/gemini`, assert response shape. No real network.
- **SSE integration test**: same as above but reads the stream via `Response.body.getReader()` and asserts the event sequence.
- **No real-API tests**: every Gemini import is mocked. Manual smoke runs (3 example specs end-to-end) gate each plan's completion.

## Plan decomposition

The work splits into three sequential plans. Each is reviewed and merged before the next starts.

**Plan A — Foundation (Phases 0-3)**
Scaffold polish, design tokens in v4, fonts, Nav/Footer/layout, SpecInput + 3 example chips + submit + hero. Vitest bootstrap. No API routes. Plan exits with the page rendering correctly and chip → textarea → submit interactions tested.

**Plan B — Generation pipeline (Phases 4-6)**
`lib/gemini.ts`, `lib/prompts.ts`, three POST routes (`parse-spec`, `generate-tests`, `generate-rubric`), `DomainBadge`, `TestSuiteTable`, `RubricPanel`. State machine wired through `parsing → tests_generating → rubric_generating → ready`. Plan exits with all 3 example specs producing a valid parsed spec, 20 tests, and a domain-aware rubric (verified manually).

**Plan C — Eval runner + scorecard (Phases 7-9)**
`/api/run-eval` SSE, `EvalRunner` component (progress bar, live row updates, expandable results), `Scorecard`, JSON export, mobile responsiveness, meta tags, 5000-char input cap. Plan exits with a full 20-test run streaming live and completing in ~4 min.

## Out of scope

- Persistence, auth, multi-user, run history, sharing.
- Design-system libraries (shadcn, Radix). Raw Tailwind only.
- Server-side caching of Gemini responses.
- Real-Gemini tests in CI.
- Internationalization, accessibility audit beyond semantic HTML + keyboard support.

## Risks / open items

1. **Model id rotation.** `lib/gemini.ts` will hard-code one current Flash id. If Google rotates it, we update one constant. Documented inline.
2. **Prompt quality for domain-hard tests** (Phase 5). Source spec flags this as the hardest step. Plan B includes explicit prompt-iteration time using AI Studio (not the app) to preserve RPD.
3. **Vercel function timeout.** A 4-minute streaming run is well under the 300s default function timeout — fine. But if the route is configured wrong (Edge runtime, or a stale 60s timeout), it will cut off. Plan C explicitly sets `export const maxDuration = 300` and `runtime = "nodejs"`.
4. **Next.js 16 deltas from training data.** Each plan begins by reading the relevant doc under `node_modules/next/dist/docs/` for the specific feature being touched (route handlers, streaming responses, fonts).
