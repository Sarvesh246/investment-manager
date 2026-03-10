import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchMacroSnapshot } from '../src/live/fredPublic';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

async function main() {
  const snapshot = await fetchMacroSnapshot();
  const outputDir = path.join(repoRoot, 'data', 'macro');

  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'latest.json'), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

  console.log(`Macro snapshot written for ${snapshot.asOf}.`);
  console.log(snapshot.narrative);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
