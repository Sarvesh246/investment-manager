import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentDataset } from '../src/data/currentDataset';
import { fetchSecFundamentalSnapshot } from '../src/live/secPublic';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

async function main() {
  const outputDir = path.join(repoRoot, 'data', 'sec', 'companyfacts');
  const summary: Array<{ symbol: string; status: 'synced' | 'missing' | 'error'; note?: string }> = [];
  const secUserAgent = process.env.SEC_USER_AGENT?.trim() || undefined;

  await mkdir(outputDir, { recursive: true });

  for (const security of currentDataset.securities) {
    try {
      const snapshot = await fetchSecFundamentalSnapshot(security.symbol, secUserAgent);

      if (!snapshot) {
        summary.push({
          symbol: security.symbol,
          status: 'missing',
          note: 'SEC company facts did not expose the required annual concepts for this symbol.',
        });
        continue;
      }

      await writeFile(
        path.join(outputDir, `${security.symbol}.json`),
        `${JSON.stringify(snapshot, null, 2)}\n`,
        'utf8',
      );
      summary.push({ symbol: security.symbol, status: 'synced' });
      console.log(`SEC fundamentals synced for ${security.symbol}`);
    } catch (error) {
      summary.push({
        symbol: security.symbol,
        status: 'error',
        note: (error as Error).message,
      });
      console.error(`SEC sync failed for ${security.symbol}: ${(error as Error).message}`);
    }
  }

  await writeFile(path.join(outputDir, 'latest-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log(
    `SEC sync complete: ${summary.filter((item) => item.status === 'synced').length}/${summary.length} symbol(s) normalized.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
