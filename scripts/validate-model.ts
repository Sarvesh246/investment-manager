import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildValidationReport } from '../src/domain/validation';
import type { MockDataset } from '../src/domain/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

async function loadSnapshots() {
  const snapshotDir = path.join(repoRoot, 'data', 'snapshots');
  const files = await readdir(snapshotDir);
  const jsonFiles = files.filter((file) => file.endsWith('.json') && file !== 'latest.json');
  const datasets: MockDataset[] = [];

  for (const file of jsonFiles) {
    const raw = await readFile(path.join(snapshotDir, file), 'utf8');
    datasets.push(JSON.parse(raw) as MockDataset);
  }

  return datasets.sort((left, right) => left.asOf.localeCompare(right.asOf));
}

async function main() {
  const snapshots = await loadSnapshots();
  const report = buildValidationReport(snapshots);
  const outputDir = path.join(repoRoot, 'data', 'validation');

  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`Validation report written with ${report.pairCount} snapshot pair(s).`);
  console.log(`Hit rate: ${(report.hitRate * 100).toFixed(1)}% | Brier: ${report.brierScore.toFixed(4)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
