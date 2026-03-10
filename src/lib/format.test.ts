import { describe, expect, it } from 'vitest';
import { formatCurrency, formatPercent, formatReturn, formatClockTime } from './format';

describe('formatCurrency', () => {
  it('formats small values with cents', () => {
    expect(formatCurrency(99.99)).toBe('$99.99');
  });

  it('formats large values without cents', () => {
    expect(formatCurrency(5000)).toBe('$5,000');
  });
});

describe('formatPercent', () => {
  it('formats with default 1 digit', () => {
    expect(formatPercent(28.5)).toBe('28.5%');
  });

  it('avoids floating point artifacts', () => {
    expect(formatPercent(28.000000000000004)).not.toContain('000000000000004');
    expect(formatPercent(28.000000000000004)).toMatch(/^28\.?0?%$/);
  });
});

describe('formatReturn', () => {
  it('formats positive returns', () => {
    expect(formatReturn(0.28)).toBe('+28.0%');
  });

  it('formats negative returns', () => {
    expect(formatReturn(-0.15)).toBe('-15.0%');
  });

  it('avoids floating point artifacts', () => {
    expect(formatReturn(0.2800000000000001)).toBe('+28.0%');
  });
});

describe('formatClockTime', () => {
  it('returns message for null', () => {
    expect(formatClockTime(null)).toBe('Waiting for first refresh');
  });

  it('formats valid date string', () => {
    const result = formatClockTime('2026-03-09T12:30:45.000Z');
    expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}\s*(AM|PM)/);
  });

  it('formats Date object', () => {
    const result = formatClockTime(new Date('2026-03-09T12:30:45.000Z'));
    expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}\s*(AM|PM)/);
  });

  it('returns message for invalid date', () => {
    expect(formatClockTime('invalid')).toBe('Invalid date');
  });
});
