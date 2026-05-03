import { describe, expect, it } from 'vitest';
import { selectExemplars, EXEMPLARS } from '@/lib/exemplars';
import type { Domain } from '@/lib/types';

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
