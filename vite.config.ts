import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { normalizePortfolioHistory } from './src/runtime/sharedStorage'

const yahooOrigin = 'https://query1.finance.yahoo.com'
const proxyPrefix = '/api/yahoo'
const storagePrefix = '/api/storage/portfolio-history'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const sharedHistoryPath = path.join(__dirname, 'data', 'runtime', 'portfolio-history.json')

function shouldForwardHeader(name: string) {
  return !['connection', 'content-encoding', 'content-length', 'host', 'transfer-encoding'].includes(
    name.toLowerCase(),
  )
}

async function proxyYahooRequest(
  req: IncomingMessage,
  res: ServerResponse,
  next: (error?: unknown) => void,
) {
  if (!req.url?.startsWith(proxyPrefix)) {
    next()
    return
  }

  try {
    const targetUrl = `${yahooOrigin}${req.url.slice(proxyPrefix.length)}`
    const response = await fetch(targetUrl, {
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'User-Agent': 'AtlasCapitalCenter/1.0',
      },
    })

    res.statusCode = response.status
    response.headers.forEach((value, key) => {
      if (shouldForwardHeader(key)) {
        res.setHeader(key, value)
      }
    })

    res.end(Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    res.statusCode = 502
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        error: 'Yahoo proxy failed',
        detail: error instanceof Error ? error.message : 'Unknown proxy error',
      }),
    )
  }
}

async function readRequestBody(req: IncomingMessage) {
  const chunks: Buffer[] = []

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return Buffer.concat(chunks).toString('utf8')
}

async function readSharedPortfolioHistory() {
  try {
    const raw = await readFile(sharedHistoryPath, 'utf8')
    return normalizePortfolioHistory(JSON.parse(raw))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return normalizePortfolioHistory({})
    }

    throw error
  }
}

async function writeSharedPortfolioHistory(payload: unknown) {
  const history = normalizePortfolioHistory(payload)
  await mkdir(path.dirname(sharedHistoryPath), { recursive: true })
  await writeFile(sharedHistoryPath, JSON.stringify(history, null, 2))
  return history
}

async function handleSharedStorageRequest(
  req: IncomingMessage,
  res: ServerResponse,
  next: (error?: unknown) => void,
) {
  if (!req.url?.startsWith(storagePrefix)) {
    next()
    return
  }

  try {
    if (req.method === 'GET') {
      const history = await readSharedPortfolioHistory()
      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(history))
      return
    }

    if (req.method === 'PUT') {
      const rawBody = await readRequestBody(req)
      const payload = rawBody ? JSON.parse(rawBody) : {}
      const history = await writeSharedPortfolioHistory(payload)
      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(history))
      return
    }

    res.statusCode = 405
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: 'Method not allowed' }))
  } catch (error) {
    res.statusCode = 500
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        error: 'Shared storage request failed',
        detail: error instanceof Error ? error.message : 'Unknown storage error',
      }),
    )
  }
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'app-runtime-proxy',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          void handleSharedStorageRequest(req as IncomingMessage, res as ServerResponse, (error) => {
            if (error) {
              next(error)
              return
            }

            void proxyYahooRequest(req as IncomingMessage, res as ServerResponse, next)
          })
        })
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          void handleSharedStorageRequest(req as IncomingMessage, res as ServerResponse, (error) => {
            if (error) {
              next(error)
              return
            }

            void proxyYahooRequest(req as IncomingMessage, res as ServerResponse, next)
          })
        })
      },
    },
  ],
})
