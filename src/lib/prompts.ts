import type { ParsedSpec, Issue, TestCase, Rubric } from '@/lib/types';

export function buildParseSpecPrompt(spec: string): string {
  return `You are an evaluation engineer. Read the AI feature spec below and return a single JSON object describing it.

Spec:
"""
${spec}
"""

Respond with ONLY a JSON object matching this exact schema (no prose, no markdown):

{
  "feature": "one-sentence summary of what the feature does",
  "inputs": ["bullet", "list", "of", "what the AI receives"],
  "outputs": ["bullet", "list", "of", "what the AI produces"],
  "constraints": ["bullet", "list", "of", "requirements the output must satisfy"],
  "domain": "legal" | "sales" | "healthcare" | "general"
}

Rules:
- Pick "domain" by matching the spec's subject. Use "general" if none of the three fit.
- Each list should have 1-6 short, specific items. No duplicates.
- Output JSON only.`;
}

export function buildGenerateTestsPrompt(parsed: ParsedSpec): string {
  return `You are an evaluation engineer. Generate a suite of 20 test cases for the AI feature below.

Feature: ${parsed.feature}
Domain: ${parsed.domain}
Inputs:
${parsed.inputs.map((s) => `- ${s}`).join('\n')}
Outputs:
${parsed.outputs.map((s) => `- ${s}`).join('\n')}
Constraints:
${parsed.constraints.map((s) => `- ${s}`).join('\n')}

Generate exactly 20 tests, distributed roughly:
- 8 happy_path tests (typical valid inputs that should pass)
- 7 edge_case tests (unusual but legal inputs: empty fields, very long inputs, ambiguity, multiple correct answers)
- 5 adversarial tests (inputs designed to surface a likely failure mode for this domain)

Each test must include a realistic, domain-appropriate \`input\` string. The input is what the feature will receive at runtime — not a description of the test.

Voice & realism (humanizer):
- Write each \`input\` as if a real user typed or pasted it, not as test scaffolding. No meta-language like "This test checks…", "Example input:", or placeholder tokens.
- Vary tone, register, and length across the 20 cases: some terse, some verbose, some polite, some blunt, some with abbreviations or rough grammar where plausible.
- Adversarial inputs may include realistic typos, ambiguous phrasing, contradictory requests, prompt-injection attempts, or off-topic noise — whatever a real user might actually send.
- Do not all sound like the same author. Different users have different voices.

Respond with ONLY a JSON array (no prose, no markdown), matching this schema:

[
  {
    "id": "test-01",
    "category": "happy_path" | "edge_case" | "adversarial",
    "input": "the literal input the feature will receive",
    "notes": "optional 1-line reason this test exists"
  },
  ...
]

Rules:
- IDs are zero-padded: test-01 through test-20.
- Inputs are concrete strings, not placeholders.
- Output JSON only.`;
}

export function buildGenerateRubricPrompt(parsed: ParsedSpec): string {
  return `You are an evaluation engineer. Define a scoring rubric for the AI feature below.

Feature: ${parsed.feature}
Domain: ${parsed.domain}
Inputs:
${parsed.inputs.map((s) => `- ${s}`).join('\n')}
Outputs:
${parsed.outputs.map((s) => `- ${s}`).join('\n')}
Constraints:
${parsed.constraints.map((s) => `- ${s}`).join('\n')}

Pick 4-6 scoring dimensions tailored to this domain and feature. Avoid generic dimensions like "quality" or "helpfulness" — every dimension should reflect a real failure mode for THIS feature.

Respond with ONLY a JSON object (no prose, no markdown), matching this schema:

{
  "dimensions": [
    {
      "id": "kebab-case-id",
      "label": "Human-readable label",
      "description": "1-2 sentences explaining what we are scoring",
      "weight": 0.0
    }
  ]
}

Rules:
- 4-6 dimensions.
- weight values are floats in [0, 1] and the sum must equal 1.0 (within ±0.01).
- Output JSON only.`;
}

function renderIssues(issues: Issue[]): string {
  return issues
    .map(
      (i) =>
        `- [${i.severity}] ${i.field}: ${i.description} Suggestion: ${i.suggestion}`,
    )
    .join('\n');
}

export function buildParseSpecCritiquePrompt(
  spec: string,
  parsed: ParsedSpec,
): string {
  return `You are an evaluation engineer reviewing a parsed feature spec.

Original spec:
"""
${spec}
"""

Parsed JSON:
${JSON.stringify(parsed)}

Evaluate the parsed JSON against this checklist. For every violation, emit one issue:
1. Domain correctness — domain is one of legal | sales | healthcare | general and matches the spec.
2. Feature summary fidelity — the feature field is a faithful one-line summary; no facts not present in the spec.
3. Inputs completeness — every distinct input the AI receives, per the spec, is in inputs.
4. Outputs completeness — every distinct output the AI produces is in outputs.
5. Constraints completeness — every requirement the output must satisfy is in constraints.
6. No hallucination — no item in inputs/outputs/constraints is unsupported by the spec.
7. Granularity — items are 1-6 short, specific bullets per list; no duplicates.

For each violation, emit an issue object:
{
  "field": "JSON path into the parsed object, e.g. inputs[0]",
  "severity": "major" | "minor",
  "description": "what is wrong",
  "suggestion": "how to fix"
}

Use "major" only for issues that would invalidate downstream test/rubric generation. Style nits are "minor".

Respond with ONLY this JSON (no prose, no markdown):
{ "issues": [ ... ] }

If everything is correct, respond with: { "issues": [] }`;
}

export function buildParseSpecRevisePrompt(
  current: ParsedSpec,
  issues: Issue[],
): string {
  return `You produced this parsed spec JSON:
${JSON.stringify(current)}

A reviewer found these issues:
${renderIssues(issues)}

Produce a corrected ParsedSpec that:
1. Fixes EVERY listed issue.
2. Preserves all unflagged content unchanged.
3. Returns the SAME schema shape — exactly these top-level fields: feature, inputs, outputs, constraints, domain.
4. Does not introduce new fields and does not omit any.

Respond with ONLY the corrected JSON object (no prose, no markdown).`;
}

export function buildGenerateTestsCritiquePrompt(
  parsed: ParsedSpec,
  tests: TestCase[],
): string {
  return `You are an evaluation engineer reviewing a generated test suite.

Feature: ${parsed.feature}
Domain: ${parsed.domain}
Inputs:
${parsed.inputs.map((s) => `- ${s}`).join('\n')}
Outputs:
${parsed.outputs.map((s) => `- ${s}`).join('\n')}
Constraints:
${parsed.constraints.map((s) => `- ${s}`).join('\n')}

Tests JSON:
${JSON.stringify(tests)}

Evaluate the tests against this checklist. For every violation, emit one issue:
1. Count — exactly 20 tests with IDs test-01..test-20.
2. Distribution — roughly 8 happy_path, 7 edge_case, 5 adversarial (±1 each).
3. Concrete inputs — every input is a literal string the feature would receive, not a description, placeholder, or meta-language ("This test checks…").
4. Coverage of inputs — every parsed-spec input is exercised by ≥1 test.
5. Coverage of constraints — every parsed-spec constraint is probed by ≥1 test.
6. Adversarial validity — adversarial-labeled tests actually attempt to break the agent (prompt injection, jailbreak, contradictory instructions, hostile input, ambiguous phrasing) — not merely informal phrasing or typos.
7. Realism — inputs resemble real user phrasing; tone/length/register varies.
8. Specificity — no input so vague the agent's behavior can't be evaluated.

For each violation, emit an issue object:
{
  "field": "JSON path into the tests array, e.g. tests[3].category",
  "severity": "major" | "minor",
  "description": "what is wrong",
  "suggestion": "how to fix"
}

Use "major" only for issues that would invalidate the test as a unit of evaluation. Style nits are "minor".

Respond with ONLY this JSON (no prose, no markdown):
{ "issues": [ ... ] }

If everything is correct, respond with: { "issues": [] }`;
}

export function buildGenerateTestsRevisePrompt(
  current: TestCase[],
  issues: Issue[],
): string {
  return `You produced this test suite:
${JSON.stringify(current)}

A reviewer found these issues:
${renderIssues(issues)}

Produce a corrected test suite that:
1. Fixes EVERY listed issue.
2. Preserves all unflagged tests unchanged.
3. Returns the SAME schema shape: an array of 20 objects, each with id, category, input, and optional notes.
4. Keeps IDs zero-padded (test-01..test-20) and unique.
5. Each input must remain a literal string the feature would receive — never a description.

Respond with ONLY the corrected JSON array (no prose, no markdown).`;
}

export function buildGenerateRubricCritiquePrompt(
  parsed: ParsedSpec,
  rubric: Rubric,
): string {
  return `You are an evaluation engineer reviewing a scoring rubric.

Feature: ${parsed.feature}
Domain: ${parsed.domain}
Inputs:
${parsed.inputs.map((s) => `- ${s}`).join('\n')}
Outputs:
${parsed.outputs.map((s) => `- ${s}`).join('\n')}
Constraints:
${parsed.constraints.map((s) => `- ${s}`).join('\n')}

Rubric JSON:
${JSON.stringify(rubric)}

Evaluate the rubric against this checklist. For every violation, emit one issue:
1. Dimension count — between 4 and 6 dimensions.
2. Weights — every weight is in [0, 1] and the weights sum to 1.0 within ±0.01.
3. ID format — every id is kebab-case (e.g. factual-accuracy).
4. Independence — dimensions don't overlap; no two score the same thing.
5. Measurability — each description provides scorable criteria, not opinion.
6. Coverage — every parsed-spec constraint is reflected in at least one dimension.
7. Domain specificity — no generic dimensions like "quality" or "helpfulness"; each reflects a real failure mode for THIS feature.
8. Naming clarity — labels are self-explanatory.

For each violation, emit an issue object:
{
  "field": "JSON path, e.g. dimensions[0].weight",
  "severity": "major" | "minor",
  "description": "what is wrong",
  "suggestion": "how to fix"
}

Use "major" for anything that would invalidate scoring (count, weights, coverage). Style nits are "minor".

Respond with ONLY this JSON (no prose, no markdown):
{ "issues": [ ... ] }

If everything is correct, respond with: { "issues": [] }`;
}

export function buildGenerateRubricRevisePrompt(
  current: Rubric,
  issues: Issue[],
): string {
  return `You produced this rubric:
${JSON.stringify(current)}

A reviewer found these issues:
${renderIssues(issues)}

Produce a corrected rubric that:
1. Fixes EVERY listed issue.
2. Preserves all unflagged dimensions unchanged.
3. Returns the SAME schema: { "dimensions": [{ id, label, description, weight }, ...] }.
4. Keeps 4-6 dimensions; ids stay kebab-case; weights are floats in [0, 1] summing to 1.0 within ±0.01.

Respond with ONLY the corrected JSON object (no prose, no markdown).`;
}

export function buildRunEvalPrompt(
  parsed: ParsedSpec,
  rubric: Rubric,
  test: TestCase,
): string {
  return `You are an evaluation engineer. The feature spec below describes an AI feature. Produce the feature output for the given input, then score that output on each rubric dimension.

Feature: ${parsed.feature}
Domain: ${parsed.domain}
Inputs the feature expects:
${parsed.inputs.map((s) => `- ${s}`).join('\n')}
Outputs the feature produces:
${parsed.outputs.map((s) => `- ${s}`).join('\n')}
Constraints the output must satisfy:
${parsed.constraints.map((s) => `- ${s}`).join('\n')}

Rubric dimensions:
${rubric.dimensions.map((d) => `- ${d.id}: ${d.label} — ${d.description}`).join('\n')}

Test input:
"""
${test.input}
"""

Respond with ONLY this JSON (no prose, no markdown):
{
  "output": "the feature output for the test input",
  "scores": [
    { "dimensionId": "...", "score": 0.0, "reasoning": "1-line justification" }
  ]
}

Rules:
- Score each dimension on a 0.0-1.0 scale where 1.0 means fully satisfied.
- Be honest. Penalize the output for failing constraints, even if the answer is otherwise good.
- Reasoning is one short sentence. No hedging.
- Output JSON only.`;
}
