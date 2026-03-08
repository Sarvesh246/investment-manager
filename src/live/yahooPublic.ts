import type { BenchmarkSeed, SecuritySeed } from '../domain/types';
import { normalizeSymbol } from '../lib/symbols';
import type {
  HistoricalBar,
  LiveFundamentalSnapshot,
  LivePriceSnapshot,
  LiveProviderRecord,
  LiveQuoteSnapshot,
  TimeseriesPoint,
} from './types';

const fundamentalsTypes = [
  'annualTotalRevenue',
  'annualBasicEPS',
  'annualGrossProfit',
  'annualOperatingIncome',
  'annualFreeCashFlow',
  'annualCurrentAssets',
  'annualCurrentLiabilities',
  'annualTotalDebt',
  'annualCashAndCashEquivalents',
  'annualDilutedAverageShares',
] as const;

const yahooBaseUrl =
  typeof window === 'undefined' ? 'https://query1.finance.yahoo.com' : '/api/yahoo';

async function getJson<T>(url: string) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

function toBars(
  timestamps: number[] | undefined,
  closes: Array<number | null> | undefined,
  volumes: Array<number | null> | undefined,
) {
  if (!timestamps || !closes || !volumes) {
    return [];
  }

  const bars: HistoricalBar[] = [];

  for (let index = 0; index < timestamps.length; index += 1) {
    const close = closes[index];
    const volume = volumes[index];

    if (close == null || volume == null) {
      continue;
    }

    bars.push({
      date: new Date(timestamps[index] * 1000).toISOString().slice(0, 10),
      close,
      volume,
    });
  }

  return bars;
}

function seriesPoints(rawSeries?: Array<{ asOfDate: string; reportedValue?: { raw?: number } }>) {
  if (!rawSeries) {
    return [];
  }

  return rawSeries
    .map((entry) => ({
      asOfDate: entry.asOfDate,
      value: entry.reportedValue?.raw ?? NaN,
    }))
    .filter((entry): entry is TimeseriesPoint => Number.isFinite(entry.value));
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function mapSparkResultsToQuotes(
  results:
    | Array<{
        symbol: string;
        response?: Array<{
          meta?: {
            symbol: string;
            regularMarketPrice?: number;
            chartPreviousClose?: number;
            previousClose?: number;
            regularMarketVolume?: number;
            longName?: string;
            shortName?: string;
            fullExchangeName?: string;
            exchangeName?: string;
          };
        }>;
      }>
    | undefined,
) {
  const quotes: Record<string, LiveQuoteSnapshot> = {};

  for (const result of results ?? []) {
    const meta = result.response?.[0]?.meta;

    if (!meta || meta.regularMarketPrice == null) {
      continue;
    }

    quotes[meta.symbol.toUpperCase()] = {
      symbol: meta.symbol.toUpperCase(),
      price: meta.regularMarketPrice,
      previousClose: meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPrice,
      volume: meta.regularMarketVolume ?? 0,
      longName: meta.longName ?? meta.shortName,
      exchangeName: meta.fullExchangeName ?? meta.exchangeName,
    };
  }

  return quotes;
}

export class YahooPublicProvider {
  async fetchQuoteSnapshots(
    symbols: string[],
    progress?: (verified: number, total: number) => void,
  ) {
    if (symbols.length === 0) {
      return {} satisfies Record<string, LiveQuoteSnapshot>;
    }

    const unique = [...new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean))];
    const total = unique.length;
    const batches = chunk(unique, 25);
    const quotes: Record<string, LiveQuoteSnapshot> = {};
    let verified = 0;

    for (const batch of batches) {
      try {
        const response = await getJson<{
          spark?: {
            result?: Array<{
              symbol: string;
              response?: Array<{
                meta?: {
                  symbol: string;
                  regularMarketPrice?: number;
                  chartPreviousClose?: number;
                  previousClose?: number;
                  regularMarketVolume?: number;
                  longName?: string;
                  shortName?: string;
                  fullExchangeName?: string;
                  exchangeName?: string;
                };
              }>;
            }>;
          };
        }>(
          `${yahooBaseUrl}/v7/finance/spark?symbols=${encodeURIComponent(batch.join(','))}&range=1d&interval=1m`,
        );

        Object.assign(quotes, mapSparkResultsToQuotes(response.spark?.result));
        verified += batch.length;
        progress?.(verified, total);
      } catch {
        if (batch.length === 1) {
          continue;
        }

        for (const symbol of batch) {
          try {
            const response = await getJson<{
              spark?: {
                result?: Array<{
                  symbol: string;
                  response?: Array<{
                    meta?: {
                      symbol: string;
                      regularMarketPrice?: number;
                      chartPreviousClose?: number;
                      previousClose?: number;
                      regularMarketVolume?: number;
                      longName?: string;
                      shortName?: string;
                      fullExchangeName?: string;
                      exchangeName?: string;
                    };
                  }>;
                }>;
              };
            }>(
              `${yahooBaseUrl}/v7/finance/spark?symbols=${encodeURIComponent(symbol)}&range=1d&interval=1m`,
            );

            Object.assign(quotes, mapSparkResultsToQuotes(response.spark?.result));
            verified += 1;
            progress?.(verified, total);
          } catch {
            continue;
          }
        }
      }
    }

    return quotes;
  }

  async fetchSecurityRecord(seed: SecuritySeed): Promise<LiveProviderRecord> {
    const notes: string[] = [];
    let priceSnapshot: LivePriceSnapshot | undefined;
    let fundamentalsSnapshot: LiveFundamentalSnapshot | undefined;
    let sector: string | undefined;

    try {
      const chart = await getJson<{
        chart: {
          result?: Array<{
            meta: {
              symbol: string;
              regularMarketPrice: number;
              chartPreviousClose: number;
              regularMarketVolume: number;
              longName?: string;
              exchangeName?: string;
            };
            timestamp?: number[];
            indicators: {
              quote?: Array<{
                close?: Array<number | null>;
                volume?: Array<number | null>;
              }>;
            };
          }>;
        };
      }>(
        `${yahooBaseUrl}/v8/finance/chart/${encodeURIComponent(seed.symbol)}?range=1y&interval=1d`,
      );
      const result = chart.chart.result?.[0];

      if (result) {
        priceSnapshot = {
          symbol: result.meta.symbol,
          price: result.meta.regularMarketPrice,
          previousClose: result.meta.chartPreviousClose,
          volume: result.meta.regularMarketVolume,
          longName: result.meta.longName,
          exchangeName: result.meta.exchangeName,
          bars: toBars(
            result.timestamp,
            result.indicators.quote?.[0]?.close,
            result.indicators.quote?.[0]?.volume,
          ),
        };
      }
    } catch (error) {
      notes.push(`Chart fetch failed for ${seed.symbol}: ${(error as Error).message}`);
    }

    try {
      const insights = await getJson<{
        finance?: {
          result?: {
            companySnapshot?: {
              sectorInfo?: string;
            };
          };
        };
      }>(
        `${yahooBaseUrl}/ws/insights/v1/finance/insights?symbol=${encodeURIComponent(seed.symbol)}`,
      );
      sector = insights.finance?.result?.companySnapshot?.sectorInfo;
    } catch (error) {
      notes.push(`Insights fetch failed for ${seed.symbol}: ${(error as Error).message}`);
    }

    try {
      const url = `${yahooBaseUrl}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(seed.symbol)}?type=${fundamentalsTypes.join(',')}&period1=1546300800&period2=1893456000`;
      const fundamentals = await getJson<{
        timeseries?: {
          result?: Array<{
            meta: { type: [string] };
            [key: string]:
              | { type: [string] }
              | Array<{ asOfDate: string; reportedValue?: { raw?: number } }>
              | undefined;
          }>;
        };
      }>(url);

      const resultByType = Object.fromEntries(
        (fundamentals.timeseries?.result ?? []).map((entry) => [entry.meta.type[0], entry]),
      );

      fundamentalsSnapshot = {
        symbol: seed.symbol,
        annualTotalRevenue: seriesPoints(
          resultByType.annualTotalRevenue?.annualTotalRevenue as Array<{
            asOfDate: string;
            reportedValue?: { raw?: number };
          }>,
        ),
        annualBasicEps: seriesPoints(
          resultByType.annualBasicEPS?.annualBasicEPS as Array<{
            asOfDate: string;
            reportedValue?: { raw?: number };
          }>,
        ),
        annualGrossProfit: seriesPoints(
          resultByType.annualGrossProfit?.annualGrossProfit as Array<{
            asOfDate: string;
            reportedValue?: { raw?: number };
          }>,
        ),
        annualOperatingIncome: seriesPoints(
          resultByType.annualOperatingIncome?.annualOperatingIncome as Array<{
            asOfDate: string;
            reportedValue?: { raw?: number };
          }>,
        ),
        annualFreeCashFlow: seriesPoints(
          resultByType.annualFreeCashFlow?.annualFreeCashFlow as Array<{
            asOfDate: string;
            reportedValue?: { raw?: number };
          }>,
        ),
        annualCurrentAssets: seriesPoints(
          resultByType.annualCurrentAssets?.annualCurrentAssets as Array<{
            asOfDate: string;
            reportedValue?: { raw?: number };
          }>,
        ),
        annualCurrentLiabilities: seriesPoints(
          resultByType.annualCurrentLiabilities?.annualCurrentLiabilities as Array<{
            asOfDate: string;
            reportedValue?: { raw?: number };
          }>,
        ),
        annualTotalDebt: seriesPoints(
          resultByType.annualTotalDebt?.annualTotalDebt as Array<{
            asOfDate: string;
            reportedValue?: { raw?: number };
          }>,
        ),
        annualCashAndCashEquivalents: seriesPoints(
          resultByType.annualCashAndCashEquivalents?.annualCashAndCashEquivalents as Array<{
            asOfDate: string;
            reportedValue?: { raw?: number };
          }>,
        ),
        annualDilutedAverageShares: seriesPoints(
          resultByType.annualDilutedAverageShares?.annualDilutedAverageShares as Array<{
            asOfDate: string;
            reportedValue?: { raw?: number };
          }>,
        ),
      };
    } catch (error) {
      notes.push(`Fundamentals fetch failed for ${seed.symbol}: ${(error as Error).message}`);
    }

    return {
      seed,
      priceSnapshot,
      fundamentalsSnapshot,
      sector,
      notes,
    };
  }

  async fetchBenchmarkSnapshot(benchmark: BenchmarkSeed) {
    const chart = await getJson<{
      chart: {
        result?: Array<{
          meta: {
            symbol: string;
            regularMarketPrice: number;
            chartPreviousClose: number;
            regularMarketVolume: number;
          };
          timestamp?: number[];
          indicators: {
            quote?: Array<{
              close?: Array<number | null>;
              volume?: Array<number | null>;
            }>;
          };
        }>;
      };
    }>(
      `${yahooBaseUrl}/v8/finance/chart/${encodeURIComponent(benchmark.symbol)}?range=1y&interval=1d`,
    );
    const result = chart.chart.result?.[0];

    if (!result) {
      throw new Error(`No benchmark chart result for ${benchmark.symbol}`);
    }

    return {
      symbol: result.meta.symbol,
      price: result.meta.regularMarketPrice,
      previousClose: result.meta.chartPreviousClose,
      volume: result.meta.regularMarketVolume,
      bars: toBars(
        result.timestamp,
        result.indicators.quote?.[0]?.close,
        result.indicators.quote?.[0]?.volume,
      ),
    };
  }
}
