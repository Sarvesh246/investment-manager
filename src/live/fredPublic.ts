import type { MacroSnapshot } from '../domain/types';

interface FredObservation {
  date: string;
  value: number;
}

const fredCsvBaseUrl = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=';

async function fetchFredCsv(seriesId: string) {
  const response = await fetch(`${fredCsvBaseUrl}${encodeURIComponent(seriesId)}`);

  if (!response.ok) {
    throw new Error(`FRED ${seriesId} failed: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function parseFredCsv(csv: string, seriesId: string) {
  const lines = csv.trim().split(/\r?\n/);

  if (lines.length <= 1) {
    return [] as FredObservation[];
  }

  return lines
    .slice(1)
    .map((line) => {
      const [date, rawValue] = line.split(',');
      const value = Number(rawValue);

      return {
        date,
        value,
      };
    })
    .filter((entry) => entry.date && Number.isFinite(entry.value) && !Number.isNaN(entry.value))
    .map((entry) => ({
      ...entry,
      value: Number(entry.value.toFixed(seriesId === 'UNRATE' ? 1 : 2)),
    }));
}

function latest(points: FredObservation[]) {
  return points.at(-1);
}

function yoy(points: FredObservation[]) {
  if (points.length < 13) {
    return undefined;
  }

  const latestPoint = points.at(-1);
  const priorYearPoint = points.at(-13);

  if (!latestPoint || !priorYearPoint || priorYearPoint.value === 0) {
    return undefined;
  }

  return ((latestPoint.value / priorYearPoint.value) - 1) * 100;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export async function fetchMacroSnapshot(): Promise<MacroSnapshot> {
  const [yield2ySeries, yield10ySeries, unemploymentSeries, cpiSeries, highYieldSeries] =
    await Promise.all([
      fetchFredCsv('DGS2').then((csv) => parseFredCsv(csv, 'DGS2')),
      fetchFredCsv('DGS10').then((csv) => parseFredCsv(csv, 'DGS10')),
      fetchFredCsv('UNRATE').then((csv) => parseFredCsv(csv, 'UNRATE')),
      fetchFredCsv('CPIAUCSL').then((csv) => parseFredCsv(csv, 'CPIAUCSL')),
      fetchFredCsv('BAMLH0A0HYM2').then((csv) => parseFredCsv(csv, 'BAMLH0A0HYM2')),
    ]);

  const yield2y = latest(yield2ySeries)?.value;
  const yield10y = latest(yield10ySeries)?.value;
  const unemploymentRate = latest(unemploymentSeries)?.value;
  const inflationYoY = yoy(cpiSeries);
  const highYieldSpread = latest(highYieldSeries)?.value;
  const curve2s10s =
    yield2y != null && yield10y != null ? round(yield10y - yield2y, 2) : undefined;
  const asOf = [
    latest(yield2ySeries)?.date,
    latest(yield10ySeries)?.date,
    latest(unemploymentSeries)?.date,
    latest(cpiSeries)?.date,
    latest(highYieldSeries)?.date,
  ]
    .filter(Boolean)
    .sort()
    .at(-1) ?? new Date().toISOString().slice(0, 10);

  let riskTone = 0.55;

  if (curve2s10s != null) {
    riskTone += curve2s10s >= 0.4 ? 0.06 : curve2s10s < 0 ? -0.1 : -0.03;
  }

  if (highYieldSpread != null) {
    riskTone += highYieldSpread <= 3.5 ? 0.06 : highYieldSpread >= 5 ? -0.12 : -0.04;
  }

  if (inflationYoY != null) {
    riskTone += inflationYoY <= 2.7 ? 0.03 : inflationYoY >= 3.5 ? -0.04 : 0;
  }

  if (unemploymentRate != null) {
    riskTone += unemploymentRate <= 4.2 ? 0.04 : unemploymentRate >= 4.8 ? -0.06 : 0;
  }

  const narrativeParts: string[] = [];

  if (curve2s10s != null) {
    narrativeParts.push(
      curve2s10s < 0
        ? 'The 2s10s curve is still inverted, which keeps recession sensitivity elevated.'
        : `The 2s10s curve is ${curve2s10s.toFixed(2)} points positive, which is less restrictive for risk assets.`,
    );
  }

  if (highYieldSpread != null) {
    narrativeParts.push(
      highYieldSpread >= 5
        ? 'High-yield spreads are wide, so credit conditions argue for more fragility discipline.'
        : 'Credit spreads are contained enough that broad stress is not the lead macro signal.',
    );
  }

  if (inflationYoY != null && unemploymentRate != null) {
    narrativeParts.push(
      `Inflation is running near ${round(inflationYoY, 1)}% year over year and unemployment is ${round(unemploymentRate, 1)}%.`,
    );
  }

  return {
    asOf,
    yield2y,
    yield10y,
    curve2s10s,
    unemploymentRate,
    inflationYoY: inflationYoY != null ? round(inflationYoY, 1) : undefined,
    highYieldSpread,
    narrative: narrativeParts.join(' '),
    riskTone: round(clamp(riskTone, 0, 1), 2),
  };
}
