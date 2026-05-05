# EvalForge

**Paste an AI feature spec. Get a working eval suite in under a minute.**

Live demo: https://evalforge-eosin.vercel.app

---

## Why this exists

Every team building with LLMs knows they should write evals. Almost nobody does. The activation energy is too high — write 20 test cases by hand, design a rubric, calibrate it, run it. By the time you're done, the feature shipped and broke twice.

EvalForge takes that whole loop and runs it for you. You paste a spec, an agent does the boring eval work, and you get back a structured suite you can edit, export, and run anywhere.

## What it does

You paste a feature spec. An agent (Gemini 2.5 Pro doing tool calls) decides one step at a time how to build the eval suite, calling tools and watching the scores until every dimension passes — or it hits a budget cap. The whole loop streams to the UI as it thinks.

Concrete pipeline:

1. **Parse** the spec into structured `feature`, `inputs`, `outputs`, `constraints`, and `domain` (`legal | sales | healthcare | general`).
2. **Generate 20 tests** distributed across happy-path, edge-case, and adversarial.
3. **Generate a weighted rubric** with 4–6 scoring dimensions.
4. **Run the eval** — every test fed through Gemini-as-feature, every output judged against every dimension.
5. **Iterate when scores are weak** — diagnose the weakest dimension, then either tighten the rubric description, add harder adversarials, rewrite a brittle test, or revise the whole rubric. After every mutation, rerun.
6. **Stop** when all dimensions pass the threshold (default 0.8), the agent decides further work won't help, or the budget cap is reached.

The agent can also **pause to ask clarifying questions** when the spec is ambiguous, and resume from where it left off. State persists in Upstash Redis, so a serverless cold start doesn't lose your run.

Outputs are exportable as JSON (full bundle or just results) and CSV.

## Who it's for

- Solo AI builders shipping LLM features without a platform team
- Startup engineering leads who can't justify a Braintrust / Humanloop seat yet
- PMs and founders who want a fast read on whether the AI part is doing its job
- Eval researchers playing with agentic, self-improving eval design

## Honest limitations

EvalForge is a high-quality **starter kit**, not a verdict system. The judge and the actor are the same model family right now, so the score is directional — useful for catching obvious gaps, not load-bearing for production decisions. The roadmap below is the harder version: dual-judge agreement, human-labeled anchor sets, kappa-calibrated thresholds, abstention bands, drift detection.

## How it works

```
src/
├── app/
│   ├── page.tsx                            # Reducer-driven UI, streams from all routes
│   └── api/
│       ├── parse-spec/route.ts             # SSE: spec → ParsedSpec
│       ├── generate-tests/route.ts         # SSE: ParsedSpec → 20 TestCases
│       ├── generate-rubric/route.ts        # SSE: ParsedSpec → Rubric
│       ├── run-eval/route.ts               # SSE: runs all tests + judges
│       ├── improve/route.ts                # SSE: agent loop on existing suite
│       └── orchestrate/
│           ├── route.ts                    # SSE: full agent from raw spec
│           └── resume/route.ts             # SSE: resumes after clarification
├── lib/
│   ├── agent/
│   │   ├── orchestrator.ts                 # Async generator, planner picks one tool/iter
│   │   ├── orchestratorTools.ts            # 12-tool registry
│   │   ├── planner.ts                      # Improver loop (used by /api/improve)
│   │   ├── budget.ts                       # Token + iteration caps
│   │   └── tools/                          # Each tool, isolated + tested
│   ├── orchState/store.ts                  # Upstash KV for pause/resume
│   ├── refinement.ts                       # Generate→critique→revise loop (per stage)
│   ├── prompts.ts                          # Prompt builders, "humanizer" voice
│   └── pageReducer.ts                      # Discriminated-union state machine
└── components/                             # SpecForm, OrchestratorPanel, Scorecard, …
```

**The 12 agent tools:**

| Build pipeline | Improvers | Control |
| --- | --- | --- |
| `parse_spec` | `diagnose_failures` | `clarify_with_user` |
| `generate_tests` | `add_tests` | `early_stop` |
| `generate_rubric` | `add_adversarial_tests` | |
| `run_eval_now` | `revise_rubric` | |
| | `tighten_rubric_descriptors` | |
| | `rewrite_test` | |

Every iteration: planner sees current state + budget + recent history, picks ONE tool, the tool runs and returns a state update, tokens get charged, and the loop continues.

## Stack

- **Next.js 16.2.4** (App Router, Turbopack, Server Actions for SSE)
- **React 19**, **TypeScript 5**, **Tailwind 4**
- **Vercel AI SDK v6** with `@ai-sdk/google` provider (direct, no Gateway)
- **Gemini 2.5 Pro** as planner, judge, and actor
- **Upstash Redis** (via Vercel Marketplace) for orchestrator state
- **Vitest** + React Testing Library — 275 tests across 52 files

## Quickstart

Requires Node 20+ and a Gemini API key.

```bash
git clone https://github.com/siddharthkiit1-PM-gif/evalforge
cd evalforge
npm install
echo 'GOOGLE_GENERATIVE_AI_API_KEY="your-key-here"' > .env.local
npm run dev
```

Open http://localhost:3000, paste a spec (or click an example chip), and hit **Run agent**.

For pause/resume to survive cold starts in production, set up an Upstash Redis instance and add `KV_REST_API_URL` + `KV_REST_API_TOKEN`. Without these the orchestrator falls back to in-memory state (works for local dev, not for serverless).

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Dev server on port 3000 |
| `npm run build` | Production build |
| `npm run start` | Run production build |
| `npm run lint` | ESLint with the Next.js config |
| `npm run test` | Vitest in watch mode |
| `npm run test:run` | Single Vitest run (CI) |

## Roadmap

The 15 features that take EvalForge from starter kit to trustworthy verdict system, ordered by dependency:

**Tier 0 — quick wins (no prerequisites)**
1. Spec auditor (pre-flight ambiguity check)
2. Counterfactual generator
3. Multi-turn conversational eval
4. Bias auditor (demographic-swap delta)
5. Champion-challenger harness (A/B prompt comparison)

**Tier 1 — calibration spine**
6. Dual-judge architecture (Claude + Gemini agreement)
7. Anchor set + kappa machinery (human-labeled ground truth)

**Tier 2 — depend on the spine**
8. Active learning for anchor selection
9. Cost-optimized judge routing
10. Regression bisector

**Tier 3 — production integration**
11. Production trace replayer
12. Coverage gap detector (prod traffic vs eval suite)
13. Cost-of-failure estimator

**Tier 4 — specialty agents**
14. Red-team agent (jailbreaks, PII extraction, prompt injection)
15. Hallucination / grounding checker (retrieval-backed fact verification)

Compliance-policy mapping (HIPAA/GDPR/SOC2 dimension generation) and a self-improving meta-eval loop are stretch goals.

## Project history

| Stage | What landed |
| --- | --- |
| Plan A | Core 3-stage pipeline (parse → tests → rubric) |
| Plan B | Domain-aware generation, example chips, parsed spec card |
| Sub-project 1 | Refinement loops (generate → critique → revise) |
| Plan C | Eval runner (feeds tests through Gemini, scores against rubric) |
| Sub-project 2 (V1) | Improver loop (`/api/improve` agent, 6 tools, snapshot rollback) |
| Sub-project 2 (V2) | Full orchestrator with pause/resume, KV-persisted state, 12 tools |

## Contributing

Issues and PRs welcome. The code follows a few opinionated conventions worth knowing:

- **TDD everywhere.** Every tool, prompt builder, and reducer branch has a test. Add the test first.
- **Discriminated unions, not optional booleans.** Stage states and SSE events are unions you narrow on.
- **One tool per file** under `src/lib/agent/tools/`, registered in `orchestratorTools.ts`.
- **No untyped tool inputs.** Each tool defines a Zod schema for its args.
- **Humanizer voice in prompts.** Tests should look like real users typed them, not test scaffolding.

## License

MIT.
