import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const yahooOrigin = 'https://query1.finance.yahoo.com'
const proxyPrefix = '/api/yahoo'

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
        'User-Agent': 'InvestmentCenter/1.0',
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

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'yahoo-proxy',
      configureServer(server) {
        server.middlewares.use((req, res, next) =>
          void proxyYahooRequest(req as IncomingMessage, res as ServerResponse, next),
        )
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) =>
          void proxyYahooRequest(req as IncomingMessage, res as ServerResponse, next),
        )
      },
    },
  ],
})
