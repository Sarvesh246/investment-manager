import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

const cleanupTargets = [
  'dist',
  'node_modules/.vite',
  'node_modules/.vite-temp',
  'node_modules/.tmp/tsconfig.app.tsbuildinfo',
  'node_modules/.tmp/tsconfig.node.tsbuildinfo',
]

async function removeTarget(target: string) {
  await rm(path.join(repoRoot, target), {
    recursive: true,
    force: true,
  })
}

async function main() {
  console.log('Clearing Vite and TypeScript build caches...')

  await Promise.all(cleanupTargets.map(removeTarget))

  console.log('Starting dev server with a clean cache...')

  const args = process.argv.slice(2)
  const viteEntry = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  const child = spawn(process.execPath, [viteEntry, ...args], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }

    process.exit(code ?? 0)
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
