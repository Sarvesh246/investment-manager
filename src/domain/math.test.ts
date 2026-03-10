import { describe, expect, it } from 'vitest';
import { clamp, round, average, sum } from './math';

describe('clamp', () => {
  it('clamps value within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps value below min', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('clamps value above max', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe('round', () => {
  it('rounds to 1 decimal by default', () => {
    expect(round(28.456)).toBe(28.5);
  });

  it('rounds to 0 decimals', () => {
    expect(round(28.7, 0)).toBe(29);
  });

  it('avoids floating point artifacts', () => {
    expect(round(28.000000000000004, 0)).toBe(28);
  });
});

describe('average', () => {
  it('computes average', () => {
    expect(average([1, 2, 3, 4, 5])).toBe(3);
  });

  it('returns 0 for empty array', () => {
    expect(average([])).toBe(0);
  });
});

describe('sum', () => {
  it('computes sum', () => {
    expect(sum([1, 2, 3, 4, 5])).toBe(15);
  });
});
