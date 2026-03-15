import type { LiveFundamentalSnapshot, TimeseriesPoint } from './types';

interface SecTickerRecord {
  ticker: string;
  cik_str: number;
  title: string;
}

interface SecFactEntry {
  end: string;
  val: number;
  filed?: string;
  fy?: number;
  fp?: string;
  form?: string;
  frame?: string;
}

interface SecConcept {
  units?: Record<string, SecFactEntry[]>;
}

interface SecCompanyFactsResponse {
  facts?: Record<string, Record<string, SecConcept>>;
}

const annualForms = new Set(['10-K', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A']);
const secBaseUrl = 'https://data.sec.gov';
const secTickerUrl = 'https://www.sec.gov/files/company_tickers.json';
const defaultUserAgent = 'AtlasCapitalCommand/0.1 (configure SEC_USER_AGENT in sync scripts)';

let tickerLookupPromise: Promise<Map<string, { cik: string; title: string }>> | null = null;

function padCik(cik: number | string) {
  return String(cik).padStart(10, '0');
}

async function getSecJson<T>(url: string, userAgent = defaultUserAgent) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': userAgent,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`SEC request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

function uniqueAnnualSeries(entries: SecFactEntry[] | undefined) {
  if (!entries) {
    return [] as TimeseriesPoint[];
  }

  const deduped = new Map<string, TimeseriesPoint>();

  entries
    .filter((entry) => annualForms.has(entry.form ?? '') && Number.isFinite(entry.val))
    .sort((left, right) => left.end.localeCompare(right.end))
    .forEach((entry) => {
      const key = `${entry.end}-${entry.fy ?? ''}-${entry.fp ?? ''}`;
      deduped.set(key, {
        asOfDate: entry.end,
        value: Number(entry.val),
      });
    });

  return [...deduped.values()].sort((left, right) => left.asOfDate.localeCompare(right.asOfDate));
}

function extractSeries(
  facts: Record<string, SecConcept>,
  concepts: string[],
  unitPreference: string[],
) {
  for (const concept of concepts) {
    const units = facts[concept]?.units;

    if (!units) {
      continue;
    }

    for (const unit of unitPreference) {
      const series = uniqueAnnualSeries(units[unit]);

      if (series.length > 0) {
        return series;
      }
    }
  }

  return [] as TimeseriesPoint[];
}

function seriesToMap(series: TimeseriesPoint[]) {
  return series.reduce((map, point) => {
    map.set(point.asOfDate, point.value);
    return map;
  }, new Map<string, number>());
}

function combineSeries(
  seriesList: TimeseriesPoint[][],
  combiner: (values: number[]) => number,
) {
  const dateSet = new Set<string>();
  seriesList.forEach((series) => {
    series.forEach((point) => dateSet.add(point.asOfDate));
  });

  const seriesMaps = seriesList.map(seriesToMap);

  return [...dateSet]
    .sort()
    .map((date) => {
      const values = seriesMaps
        .map((map) => map.get(date))
        .filter((value): value is number => value != null);

      if (values.length === 0) {
        return null;
      }

      return {
        asOfDate: date,
        value: combiner(values),
      };
    })
    .filter((point): point is TimeseriesPoint => point !== null);
}

function subtractSeries(left: TimeseriesPoint[], right: TimeseriesPoint[]) {
  const rightMap = seriesToMap(right.map((point) => ({ ...point, value: Math.abs(point.value) })));

  return left
    .map((point) => ({
      asOfDate: point.asOfDate,
      value: point.value - (rightMap.get(point.asOfDate) ?? 0),
    }))
    .filter((point) => Number.isFinite(point.value));
}

export async function fetchSecTickerLookup(userAgent = defaultUserAgent) {
  if (!tickerLookupPromise) {
    tickerLookupPromise = getSecJson<Record<string, SecTickerRecord>>(secTickerUrl, userAgent).then(
      (payload) => {
        return new Map(
          Object.values(payload).map((entry) => [
            entry.ticker.toUpperCase(),
            {
              cik: padCik(entry.cik_str),
              title: entry.title,
            },
          ]),
        );
      },
    );
  }

  return tickerLookupPromise;
}

export async function fetchSecFundamentalSnapshot(symbol: string, userAgent = defaultUserAgent) {
  const lookup = await fetchSecTickerLookup(userAgent);
  const record = lookup.get(symbol.toUpperCase());

  if (!record) {
    return undefined;
  }

  const response = await getSecJson<SecCompanyFactsResponse>(
    `${secBaseUrl}/api/xbrl/companyfacts/CIK${record.cik}.json`,
    userAgent,
  );
  const gaap = response.facts?.['us-gaap'] ?? {};
  const dei = response.facts?.dei ?? {};

  const annualTotalRevenue = extractSeries(
    gaap,
    ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet'],
    ['USD'],
  );
  const annualBasicEps = extractSeries(
    gaap,
    ['EarningsPerShareBasic', 'IncomeLossFromContinuingOperationsPerBasicShare'],
    ['USD/shares', 'USD'],
  );
  const annualGrossProfit = extractSeries(gaap, ['GrossProfit'], ['USD']);
  const annualOperatingIncome = extractSeries(gaap, ['OperatingIncomeLoss'], ['USD']);
  const annualCurrentAssets = extractSeries(gaap, ['AssetsCurrent'], ['USD']);
  const annualCurrentLiabilities = extractSeries(gaap, ['LiabilitiesCurrent'], ['USD']);
  const annualCashAndCashEquivalents = extractSeries(
    gaap,
    ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
    ['USD'],
  );
  const annualDilutedAverageShares = extractSeries(
    gaap,
    ['WeightedAverageNumberOfDilutedSharesOutstanding'],
    ['shares'],
  );

  const operatingCashFlow = extractSeries(
    gaap,
    ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
    ['USD'],
  );
  const capex = extractSeries(
    gaap,
    ['PaymentsToAcquirePropertyPlantAndEquipment', 'PropertyPlantAndEquipmentAdditions'],
    ['USD'],
  );
  const annualFreeCashFlow =
    operatingCashFlow.length > 0 ? subtractSeries(operatingCashFlow, capex) : [];

  const debtNonCurrent = extractSeries(
    gaap,
    ['LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligationsNoncurrent', 'LongTermDebt'],
    ['USD'],
  );
  const debtCurrent = extractSeries(
    gaap,
    ['LongTermDebtCurrent', 'LongTermDebtAndCapitalLeaseObligationsCurrent', 'ShortTermBorrowings'],
    ['USD'],
  );
  const annualTotalDebt = combineSeries(
    [debtNonCurrent, debtCurrent],
    (values) => values.reduce((sum, value) => sum + value, 0),
  );

  const fallbackDilutedShares =
    annualDilutedAverageShares.length > 0
      ? annualDilutedAverageShares
      : extractSeries(dei, ['EntityCommonStockSharesOutstanding'], ['shares']);

  if (
    annualTotalRevenue.length === 0 &&
    annualBasicEps.length === 0 &&
    annualCurrentAssets.length === 0
  ) {
    return undefined;
  }

  return {
    symbol: symbol.toUpperCase(),
    annualTotalRevenue,
    annualBasicEps,
    annualGrossProfit,
    annualOperatingIncome,
    annualFreeCashFlow,
    annualCurrentAssets,
    annualCurrentLiabilities,
    annualTotalDebt,
    annualCashAndCashEquivalents,
    annualDilutedAverageShares: fallbackDilutedShares,
  } satisfies LiveFundamentalSnapshot;
}
