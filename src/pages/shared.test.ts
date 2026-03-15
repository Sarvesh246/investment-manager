import { describe, expect, it, vi } from 'vitest';
import { liveStatusText, liveStatusTooltip, liveStatusTone } from './shared';

describe('live quote status helpers', () => {
  it('shows fresh live quote timing in plain language', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15T03:05:00.000Z'));

    const liveQuotes = {
      AAPL: {
        symbol: 'AAPL',
        price: 210,
        previousClose: 205,
        volume: 100,
        regularPrice: 208,
        session: 'after-hours' as const,
        sessionLabel: 'After hours' as const,
        timestamp: '2026-03-15T03:03:30.000Z',
      },
    };

    expect(liveStatusText('AAPL', [], {}, liveQuotes)).toBe('After hours / 2m');
    expect(liveStatusTone('AAPL', [], {}, liveQuotes)).toBe('warning');
    expect(liveStatusTooltip('AAPL', [], {}, liveQuotes)).toContain('after hours');

    vi.useRealTimers();
  });
});
