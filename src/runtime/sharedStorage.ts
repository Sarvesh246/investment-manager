import type {
  PortfolioHistoryGranularity,
  PortfolioHistorySnapshot,
  PortfolioHistoryStore,
} from '../domain/types'

const historyApiPath = '/api/storage/portfolio-history'

function defaultPortfolioHistory(): PortfolioHistoryStore {
  return {
    intraday: [],
    daily: [],
  }
}

function roundMoney(value: number) {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.round(value * 100) / 100
}

function normalizeHistorySnapshot(
  input: unknown,
  granularity: PortfolioHistoryGranularity,
): PortfolioHistorySnapshot | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  const snapshot = input as Record<string, unknown>
  const timestamp = typeof snapshot.timestamp === 'string' ? snapshot.timestamp : null

  if (!timestamp || Number.isNaN(new Date(timestamp).getTime())) {
    return null
  }

  return {
    timestamp,
    granularity,
    portfolioValue: roundMoney(Number(snapshot.portfolioValue) || 0),
    holdingsValue: roundMoney(Number(snapshot.holdingsValue) || 0),
    cashValue: roundMoney(Number(snapshot.cashValue) || 0),
    costBasisValue: roundMoney(Number(snapshot.costBasisValue) || 0),
    holdingCount: Math.max(0, Math.round(Number(snapshot.holdingCount) || 0)),
  }
}

function sortSnapshots(snapshots: PortfolioHistorySnapshot[]) {
  return [...snapshots].sort(
    (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
  )
}

function normalizeHistorySeries(
  input: unknown,
  granularity: PortfolioHistoryGranularity,
): PortfolioHistorySnapshot[] {
  if (!Array.isArray(input)) {
    return []
  }

  return sortSnapshots(
    input
      .map((snapshot) => normalizeHistorySnapshot(snapshot, granularity))
      .filter((snapshot): snapshot is PortfolioHistorySnapshot => Boolean(snapshot)),
  )
}

export function normalizePortfolioHistory(input: unknown): PortfolioHistoryStore {
  if (!input || typeof input !== 'object') {
    return defaultPortfolioHistory()
  }

  const store = input as Record<string, unknown>

  return {
    intraday: normalizeHistorySeries(store.intraday, 'intraday'),
    daily: normalizeHistorySeries(store.daily, 'daily'),
  }
}

export function historySnapshotKey(snapshot: PortfolioHistorySnapshot) {
  return `${snapshot.granularity}:${snapshot.timestamp}`
}

export function mergePortfolioHistoryStores(
  left: PortfolioHistoryStore,
  right: PortfolioHistoryStore,
): PortfolioHistoryStore {
  const mergeSeries = (
    leftSeries: PortfolioHistorySnapshot[],
    rightSeries: PortfolioHistorySnapshot[],
  ) => {
    const merged = new Map<string, PortfolioHistorySnapshot>()

    for (const snapshot of [...leftSeries, ...rightSeries]) {
      merged.set(historySnapshotKey(snapshot), snapshot)
    }

    return sortSnapshots([...merged.values()])
  }

  return {
    intraday: mergeSeries(left.intraday, right.intraday),
    daily: mergeSeries(left.daily, right.daily),
  }
}

export async function fetchSharedPortfolioHistory() {
  const response = await fetch(historyApiPath)

  if (!response.ok) {
    throw new Error(`Shared history fetch failed: ${response.status} ${response.statusText}`)
  }

  return normalizePortfolioHistory(await response.json())
}

export async function persistSharedPortfolioHistory(history: PortfolioHistoryStore) {
  const response = await fetch(historyApiPath, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(history),
  })

  if (!response.ok) {
    throw new Error(`Shared history save failed: ${response.status} ${response.statusText}`)
  }
}
