import { afterEach, describe, expect, it, vi } from 'vitest';
import { YahooPublicProvider, YahooRateLimitError } from './yahooPublic';

describe('YahooPublicProvider.fetchQuoteBatch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns successful quotes while preserving symbol-specific failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  meta: {
                    symbol: 'AAPL',
                    regularMarketPrice: 210,
                    chartPreviousClose: 205,
                    regularMarketVolume: 1000,
                    regularMarketTime: 1_710_000_000,
                  },
                },
              ],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 500, statusText: 'Server Error' }));

    vi.stubGlobal('fetch', fetchMock);

    const provider = new YahooPublicProvider();
    const result = await provider.fetchQuoteBatch(['AAPL', 'MSFT']);

    expect(result.quotes.AAPL.price).toBe(210);
    expect(result.errors.MSFT).toContain('500');
    expect(result.rateLimited).toBe(false);
  });

  it('records a per-symbol error when yahoo returns no usable quote data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  meta: {
                    symbol: 'TSLA',
                  },
                },
              ],
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const provider = new YahooPublicProvider();
    const result = await provider.fetchQuoteBatch(['TSLA']);

    expect(result.quotes).toEqual({});
    expect(result.errors.TSLA).toBe('No live quote data returned for symbol.');
  });

  it('marks the batch rate-limited when yahoo responds with 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429 })));

    const provider = new YahooPublicProvider();
    const result = await provider.fetchQuoteBatch(['NVDA']);

    expect(result.rateLimited).toBe(true);
    expect(result.errors.NVDA).toBe(new YahooRateLimitError().message);
  });
});
