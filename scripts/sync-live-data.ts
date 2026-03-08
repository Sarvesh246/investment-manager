import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCommandCenterModel } from '../src/domain/engine';
import type { MockDataset } from '../src/domain/types';
import { currentDataset } from '../src/data/currentDataset';
import { buildLiveDataset } from '../src/live/buildLiveDataset';
import { YahooPublicProvider } from '../src/live/yahooPublic';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function timestampId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function writeLatestModule(dataset: MockDataset) {
  const targetPath = path.join(repoRoot, 'src', 'data', 'liveSnapshot.ts');
  const contents = `/* eslint-disable no-loss-of-precision */\nimport type { MockDataset } from '../domain/types';\n\nexport const liveSnapshot: MockDataset | null = ${JSON.stringify(dataset, null, 2)};\n`;
  await writeFile(targetPath, contents, 'utf8');
}

async function writeSnapshotFiles(dataset: MockDataset) {
  const snapshotDir = path.join(repoRoot, 'data', 'snapshots');
  await mkdir(snapshotDir, { recursive: true });

  await writeFile(
    path.join(snapshotDir, `${dataset.snapshotId}.json`),
    `${JSON.stringify(dataset, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(snapshotDir, 'latest.json'),
    `${JSON.stringify(dataset, null, 2)}\n`,
    'utf8',
  );
}

async function main() {
  const provider = new YahooPublicProvider();
  const baseDataset = currentDataset;
  const providerNotes: string[] = [];
  const snapshotId = timestampId();

  console.log(`Syncing ${baseDataset.securities.length} securities from Yahoo public endpoints...`);

  const benchmarkSnapshot = await provider.fetchBenchmarkSnapshot(baseDataset.benchmark);
  const providerRecords = [];

  for (const security of baseDataset.securities) {
    const record = await provider.fetchSecurityRecord(security);
    providerNotes.push(...record.notes);
    providerRecords.push(record);
    console.log(`Fetched ${security.symbol}${record.notes.length ? ` with ${record.notes.length} note(s)` : ''}`);
  }

  const previousModel = buildCommandCenterModel(baseDataset);
  const liveResult = buildLiveDataset(baseDataset, benchmarkSnapshot, providerRecords, providerNotes);
  let dataset = {
    ...liveResult.dataset,
    snapshotId,
  } satisfies MockDataset;

  dataset = {
    ...dataset,
    securities: dataset.securities.map((security) => {
      const previousSecurity = baseDataset.securities.find((item) => item.symbol === security.symbol);
      const previousCard = previousModel.scorecards.find((card) => card.symbol === security.symbol);

      return {
        ...security,
        scoreHistory: [
          ...(previousSecurity?.scoreHistory.slice(-7) ?? security.scoreHistory.slice(-7)),
          previousCard?.composite ?? previousSecurity?.scoreHistory.at(-1) ?? 50,
        ],
        previousRisk: previousCard?.risk.overall ?? previousSecurity?.previousRisk ?? security.previousRisk,
        previousDownside:
          previousCard?.risk.expectedDownside ??
          previousSecurity?.previousDownside ??
          security.previousDownside,
      };
    }),
    syncNotes: [
      `Synced ${dataset.securities.length} securities and benchmark ${dataset.benchmark.symbol}.`,
      ...(dataset.syncNotes ?? []),
    ],
  };

  await writeSnapshotFiles(dataset);
  await writeLatestModule(dataset);

  console.log(`Snapshot persisted: ${dataset.snapshotId}`);
  console.log(`Latest module updated: src/data/liveSnapshot.ts`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
