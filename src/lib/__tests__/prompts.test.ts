import { describe, it, expect } from 'vitest';
import {
  buildParseSpecPrompt,
  buildGenerateTestsPrompt,
  buildGenerateRubricPrompt,
  buildParseSpecCritiquePrompt,
  buildParseSpecRevisePrompt,
  buildGenerateTestsCritiquePrompt,
  buildGenerateTestsRevisePrompt,
} from '@/lib/prompts';
import type { ParsedSpec, Issue, TestCase } from '@/lib/types';

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

const sampleParsed: ParsedSpec = {
  feature: 'Extracts obligations from contract PDFs.',
  inputs: ['contract pdf'],
  outputs: ['table of obligations'],
  constraints: ['must include due date'],
  domain: 'legal',
};

const sampleSpec = 'AI extracts obligations from a contract pdf.';

const sampleIssue: Issue = {
  field: 'feature',
  severity: 'major',
  description: 'Summary omits clause-level extraction.',
  suggestion: 'Mention clause-level extraction explicitly.',
};

describe('buildParseSpecCritiquePrompt', () => {
  it('embeds the original spec, the parsed JSON, and the JSON-only output instruction', () => {
    const prompt = buildParseSpecCritiquePrompt(sampleSpec, sampleParsed);
    expect(prompt).toContain(sampleSpec);
    expect(prompt).toContain(JSON.stringify(sampleParsed));
    expect(prompt).toMatch(/issues/i);
    expect(prompt).toMatch(/severity/i);
    expect(prompt).toMatch(/JSON/);
  });

  it('includes every checklist item from the spec', () => {
    const prompt = buildParseSpecCritiquePrompt(sampleSpec, sampleParsed);
    for (const cue of [
      'domain correctness',
      'feature summary',
      'inputs',
      'outputs',
      'constraints',
      'no hallucination',
      'granularity',
    ]) {
      expect(prompt.toLowerCase()).toContain(cue);
    }
  });
});

describe('buildParseSpecRevisePrompt', () => {
  it('embeds the current parsed JSON and renders each issue as a bullet', () => {
    const prompt = buildParseSpecRevisePrompt(sampleParsed, [sampleIssue]);
    expect(prompt).toContain(JSON.stringify(sampleParsed));
    expect(prompt).toContain(sampleIssue.field);
    expect(prompt).toContain(sampleIssue.description);
    expect(prompt).toContain(sampleIssue.suggestion);
    expect(prompt).toMatch(/preserve/i);
    expect(prompt).toMatch(/JSON/);
  });

  it('does NOT embed the original spec (revise must work from output + issues only)', () => {
    const prompt = buildParseSpecRevisePrompt(sampleParsed, [sampleIssue]);
    expect(prompt).not.toContain(sampleSpec);
  });
});

const sampleTests: TestCase[] = Array.from({ length: 20 }, (_, i) => ({
  id: `test-${String(i + 1).padStart(2, '0')}`,
  category: i < 8 ? 'happy_path' : i < 15 ? 'edge_case' : 'adversarial',
  input: `sample input ${i + 1}`,
}));

describe('buildGenerateTestsCritiquePrompt', () => {
  it('embeds the parsed spec and the tests array', () => {
    const prompt = buildGenerateTestsCritiquePrompt(sampleParsed, sampleTests);
    expect(prompt).toContain(sampleParsed.feature);
    expect(prompt).toContain(JSON.stringify(sampleTests));
    expect(prompt).toMatch(/issues/i);
  });

  it('includes every checklist item from the spec', () => {
    const prompt = buildGenerateTestsCritiquePrompt(sampleParsed, sampleTests);
    for (const cue of [
      'count',
      'distribution',
      'concrete',
      'coverage',
      'constraints',
      'adversarial',
      'realism',
      'specificity',
    ]) {
      expect(prompt.toLowerCase()).toContain(cue);
    }
  });
});

describe('buildGenerateTestsRevisePrompt', () => {
  it('embeds the current tests and renders each issue as a bullet', () => {
    const issue: Issue = {
      field: 'tests[3].category',
      severity: 'major',
      description: 'mislabeled',
      suggestion: 'reclassify',
    };
    const prompt = buildGenerateTestsRevisePrompt(sampleTests, [issue]);
    expect(prompt).toContain(JSON.stringify(sampleTests));
    expect(prompt).toContain(issue.field);
    expect(prompt).toContain(issue.description);
    expect(prompt).toContain(issue.suggestion);
    expect(prompt).toMatch(/preserve/i);
  });

  it('does NOT embed the parsed spec', () => {
    const issue: Issue = {
      field: 'tests[0].input',
      severity: 'major',
      description: 'too vague',
      suggestion: 'be specific',
    };
    const prompt = buildGenerateTestsRevisePrompt(sampleTests, [issue]);
    expect(prompt).not.toContain(sampleParsed.feature);
  });
});
