import { describe, expect, it } from 'vitest';
import { selectExemplars, EXEMPLARS } from '@/lib/exemplars';
import type { Domain, Rubric, TestCase } from '@/lib/types';

describe('selectExemplars', () => {
  it('returns the legal exemplars for the legal domain', () => {
    expect(selectExemplars('legal', 'tests')).toBe(EXEMPLARS.legal.tests);
    expect(selectExemplars('legal', 'rubric')).toBe(EXEMPLARS.legal.rubric);
  });

  it('returns the sales exemplars for the sales domain', () => {
    expect(selectExemplars('sales', 'tests')).toBe(EXEMPLARS.sales.tests);
    expect(selectExemplars('sales', 'rubric')).toBe(EXEMPLARS.sales.rubric);
  });

  it('returns the healthcare exemplars for the healthcare domain', () => {
    expect(selectExemplars('healthcare', 'tests')).toBe(EXEMPLARS.healthcare.tests);
    expect(selectExemplars('healthcare', 'rubric')).toBe(EXEMPLARS.healthcare.rubric);
  });

  it('returns the general exemplars for the general domain', () => {
    expect(selectExemplars('general', 'tests')).toBe(EXEMPLARS.general.tests);
    expect(selectExemplars('general', 'rubric')).toBe(EXEMPLARS.general.rubric);
  });

  it('returns the general exemplars for an unknown domain string', () => {
    expect(selectExemplars('mystery' as Domain, 'tests')).toBe(EXEMPLARS.general.tests);
  });

  it('returns the general exemplars for empty string', () => {
    expect(selectExemplars('' as Domain, 'tests')).toBe(EXEMPLARS.general.tests);
  });
});

const ALL_DOMAINS = ['legal', 'sales', 'healthcare', 'general'] as const;

describe('EXEMPLARS content', () => {
  it('has exactly 3 exemplars per (domain, stage) cell', () => {
    for (const d of ALL_DOMAINS) {
      expect(EXEMPLARS[d].tests).toHaveLength(3);
      expect(EXEMPLARS[d].rubric).toHaveLength(3);
    }
  });

  it('every exemplar has non-empty spec, output, and rationale', () => {
    for (const d of ALL_DOMAINS) {
      for (const stage of ['tests', 'rubric'] as const) {
        for (const ex of EXEMPLARS[d][stage]) {
          expect(ex.spec.length).toBeGreaterThan(20);
          expect(ex.output.length).toBeGreaterThan(20);
          expect(ex.rationale.length).toBeGreaterThan(10);
        }
      }
    }
  });

  it('every tests-stage exemplar.output parses as a non-empty TestCase array', () => {
    for (const d of ALL_DOMAINS) {
      for (const ex of EXEMPLARS[d].tests) {
        const parsed = JSON.parse(ex.output) as TestCase[];
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBeGreaterThan(0);
        for (const t of parsed) {
          expect(typeof t.id).toBe('string');
          expect(typeof t.input).toBe('string');
          expect(['happy_path', 'edge_case', 'adversarial']).toContain(t.category);
        }
      }
    }
  });

  it('every rubric-stage exemplar.output parses as a Rubric with weights summing to 1.0', () => {
    for (const d of ALL_DOMAINS) {
      for (const ex of EXEMPLARS[d].rubric) {
        const parsed = JSON.parse(ex.output) as Rubric;
        expect(Array.isArray(parsed.dimensions)).toBe(true);
        expect(parsed.dimensions.length).toBeGreaterThanOrEqual(4);
        expect(parsed.dimensions.length).toBeLessThanOrEqual(6);
        const sum = parsed.dimensions.reduce((acc, dim) => acc + dim.weight, 0);
        expect(sum).toBeGreaterThanOrEqual(0.99);
        expect(sum).toBeLessThanOrEqual(1.01);
      }
    }
  });

  it('every exemplar serialized form is under the per-exemplar budget (~700 chars excluding output)', () => {
    for (const d of ALL_DOMAINS) {
      for (const stage of ['tests', 'rubric'] as const) {
        for (const ex of EXEMPLARS[d][stage]) {
          expect(ex.spec.length + ex.rationale.length).toBeLessThan(700);
        }
      }
    }
  });
});
