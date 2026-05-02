import type { ParsedSpec } from '@/lib/types';

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
