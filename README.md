# EvalForge

Paste an AI feature spec. Get a domain-aware eval suite — a parsed spec, 20 realistic test cases, and a scoring rubric — produced and refined by Gemini in three streamed stages.

## What it does

EvalForge takes a free-form description of an AI feature (e.g. "summarize medical visits into ICD-10 codes") and runs a three-stage pipeline:

1. **Parse spec** → extracts feature, inputs, outputs, constraints, and domain (`legal | sales | healthcare | general`).
2. **Generate tests** → produces 20 test cases distributed across happy-path, edge-case, and adversarial categories.
3. **Generate rubric** → defines 4–6 weighted scoring dimensions tailored to the domain.

Each stage runs through a bounded **generate → critique → revise** refinement loop (max 2 passes), with progress streamed to the UI as Server-Sent Events.

## Stack

- Next.js 16.2.4 (App Router, Turbopack)
- React 19, TypeScript 5
- Tailwind CSS 4
- Google Gemini via `@google/genai`
- Vitest + React Testing Library

## Getting started

Requires Node 20+ and a Gemini API key.

```bash
npm install
cp .env.example .env.local   # then add GEMINI_API_KEY
npm run dev
```

Open http://localhost:3000, click an example chip, and hit **Generate Eval Suite**.

## Scripts

| Command            | What it does                          |
| ------------------ | ------------------------------------- |
| `npm run dev`      | Start dev server on port 3000         |
| `npm run build`    | Production build                      |
| `npm run start`    | Run production build                  |
| `npm run lint`     | ESLint (Next.js config)               |
| `npm run test`     | Vitest in watch mode                  |
| `npm run test:run` | Vitest single run (CI mode)           |

## Architecture

```
src/
├── app/
│   ├── page.tsx                       # Client: drives 3 SSE stages via useReducer
│   └── api/
│       ├── parse-spec/route.ts        # SSE: spec → ParsedSpec
│       ├── generate-tests/route.ts    # SSE: ParsedSpec → TestCase[]
│       └── generate-rubric/route.ts   # SSE: ParsedSpec → Rubric
├── lib/
│   ├── refinement.ts                  # Bounded generate→critique→revise generator
│   ├── prompts.ts                     # Prompt builders for each stage
│   ├── gemini.ts                      # Gemini client wrapper
│   ├── pageReducer.ts                 # Per-stage state machine
│   └── types.ts                       # ParsedSpec, TestCase, Rubric, RefinementEvent
└── components/                        # SpecForm, TestSuiteTable, RubricPanel, etc.
```

Each API route is a `text/event-stream` producer that emits typed `RefinementEvent` frames (`generated → critiquing → critiqued → revising → revised → done`). The client consumes them, dispatches into a per-stage reducer, and renders results progressively.

## Testing

102 tests across 16 files cover prompt builders, the refinement loop, SSE route handlers, the page reducer, and end-to-end UI flows (with Gemini mocked).

```bash
npm run test:run
```

## Project status

- **Plan A** — Core pipeline (parse, generate, render) ✅
- **Plan B** — Domain-aware generation, example chips, parsed spec card ✅
- **Sub-project 1** — Refinement loops with critique/revise ✅
- **Plan C** — Eval runner (feeds tests through Gemini, scores against the rubric) — next
