import { describe, it, expect } from 'vitest';
import {
  buildParseSpecPrompt,
  buildGenerateTestsPrompt,
  buildGenerateRubricPrompt,
} from '@/lib/prompts';
import type { ParsedSpec } from '@/lib/types';

const SAMPLE_PARSED: ParsedSpec = {
  feature: 'Cold email drafter',
  inputs: ['LinkedIn profile', 'company website'],
  outputs: ['email body under 150 words'],
  constraints: ['references one profile detail', 'one case study'],
  domain: 'sales',
};

describe('buildParseSpecPrompt', () => {
  it('embeds the raw spec text', () => {
    const p = buildParseSpecPrompt('AI summarizes invoices.');
    expect(p).toContain('AI summarizes invoices.');
  });

  it('asks for a JSON response with the expected keys', () => {
    const p = buildParseSpecPrompt('any');
    expect(p).toContain('feature');
    expect(p).toContain('inputs');
    expect(p).toContain('outputs');
    expect(p).toContain('constraints');
    expect(p).toContain('domain');
    expect(p).toMatch(/legal|sales|healthcare|general/);
  });
});

describe('buildGenerateTestsPrompt', () => {
  it('embeds the feature, inputs, outputs, constraints, and domain', () => {
    const p = buildGenerateTestsPrompt(SAMPLE_PARSED);
    expect(p).toContain('Cold email drafter');
    expect(p).toContain('LinkedIn profile');
    expect(p).toContain('email body under 150 words');
    expect(p).toContain('references one profile detail');
    expect(p).toContain('sales');
  });

  it('asks for exactly 20 test cases', () => {
    const p = buildGenerateTestsPrompt(SAMPLE_PARSED);
    expect(p).toMatch(/20/);
  });

  it('asks inputs to sound like real users (humanizer guidance)', () => {
    const p = buildGenerateTestsPrompt(SAMPLE_PARSED);
    expect(p).toMatch(/humanizer|real user|tone|voice/i);
    expect(p).toMatch(/vary/i);
  });

  it('asks for the three categories', () => {
    const p = buildGenerateTestsPrompt(SAMPLE_PARSED);
    expect(p).toContain('happy_path');
    expect(p).toContain('edge_case');
    expect(p).toContain('adversarial');
  });
});

describe('buildGenerateRubricPrompt', () => {
  it('embeds the parsed spec context', () => {
    const p = buildGenerateRubricPrompt(SAMPLE_PARSED);
    expect(p).toContain('Cold email drafter');
    expect(p).toContain('sales');
  });

  it('asks for dimensions with id, label, description, weight', () => {
    const p = buildGenerateRubricPrompt(SAMPLE_PARSED);
    expect(p).toContain('id');
    expect(p).toContain('label');
    expect(p).toContain('description');
    expect(p).toContain('weight');
  });

  it('asks weights to sum to 1', () => {
    const p = buildGenerateRubricPrompt(SAMPLE_PARSED);
    expect(p).toMatch(/sum.*1/i);
  });
});
