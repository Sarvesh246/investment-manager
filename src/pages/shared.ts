import { getSecurity } from './../domain/engine';
import type { CommandCenterModel } from './../domain/types';
import {
  formatClockTime,
  formatCompactCurrency,
  formatCurrency,
  formatPercent,
  formatPrice,
  formatReturn,
} from './../lib/format';
import { normalizeSymbol, symbolMatchesQuery } from './../lib/symbols';
import type {
  ActionLabel,
  AlertItem,
  AppTheme,
  ConfidenceBand,
  FreshnessStatus,
  PortfolioHistorySnapshot,
  PortfolioHistoryStore,
  PortfolioTransaction,
  ScoreCard,
  SymbolDirectoryEntry,
  ThesisHealth,
} from './../domain/types';
import type { LiveQuoteSnapshot } from './../live/types';

export { formatClockTime, formatCompactCurrency, formatCurrency, formatPercent, formatPrice, formatReturn };

export const navigation = [
  { to: '/', label: 'Home' },
  { to: '/discovery', label: 'Explore' },
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/recommendations', label: 'Ideas' },
  { to: '/planner', label: 'Plan' },
  { to: '/alerts', label: 'Watch' },
  { to: '/settings', label: 'Settings' },
  { to: '/journal', label: 'Journal' },
];

export const dashboardRanges = ['1D', '1W', '1M', '3M', '6M', '12M'] as const;

export type DashboardRange = (typeof dashboardRanges)[number];

export const themeOptions: Array<{
  id: AppTheme;
  label: string;
  note: string;
  accent: string;
}> = [
  { id: 'emerald', label: 'Emerald', note: 'Brokerage green with calm contrast.', accent: '#00c96b' },
  { id: 'cobalt', label: 'Cobalt', note: 'Cooler blue-led command center.', accent: '#4d9cff' },
  { id: 'amber', label: 'Amber', note: 'Warmer gold-led trading desk.', accent: '#f2b544' },
  { id: 'rose', label: 'Rose', note: 'Crisp coral accents with softer glow.', accent: '#ff7d6b' },
  { id: 'graphite', label: 'Graphite', note: 'Minimal monochrome with ice highlights.', accent: '#d8dde4' },
  { id: 'violet', label: 'Violet', note: 'Soft purple accents and glow.', accent: '#a78bfa' },
  { id: 'teal', label: 'Teal', note: 'Cool teal-cyan for a calm screen.', accent: '#2dd4bf' },
  { id: 'mint', label: 'Mint', note: 'Light mint green, easy on the eyes.', accent: '#6ee7b7' },
  { id: 'orange', label: 'Orange', note: 'Warm orange for high visibility.', accent: '#fb923c' },
  { id: 'indigo', label: 'Indigo', note: 'Deep indigo for a focused look.', accent: '#818cf8' },
  { id: 'cyan', label: 'Cyan', note: 'Bright cyan for a crisp terminal feel.', accent: '#22d3ee' },
  { id: 'lime', label: 'Lime', note: 'Zesty lime green for high contrast.', accent: '#a3e635' },
  { id: 'fuchsia', label: 'Fuchsia', note: 'Vivid fuchsia with a modern punch.', accent: '#d946ef' },
  { id: 'sky', label: 'Sky', note: 'Light sky blue for a soft, airy feel.', accent: '#38bdf8' },
];

export const strategyWeightFields = [
  { key: 'growth', label: 'Growth' },
  { key: 'quality', label: 'Quality' },
  { key: 'balanced', label: 'Balanced' },
  { key: 'value', label: 'Value' },
  { key: 'momentum', label: 'Momentum' },
  { key: 'defensive', label: 'Defensive' },
  { key: 'dividend', label: 'Dividend' },
  { key: 'speculative', label: 'Speculative' },
] as const;

export function toneForAction(action: ActionLabel) {
  if (action === 'Buy now' || action === 'Hold') {
    return 'positive' as const;
  }
  if (
    action === 'Buy partial' ||
    action === 'Accumulate slowly' ||
    action === 'Watch only' ||
    action === 'Take profit'
  ) {
    return 'warning' as const;
  }
  return 'negative' as const;
}

export function toneForConfidenceBand(band: ConfidenceBand) {
  if (band === 'High confidence') {
    return 'positive' as const;
  }
  if (band === 'Medium confidence') {
    return 'warning' as const;
  }
  return 'negative' as const;
}

export function toneForThesisHealth(health: ThesisHealth) {
  if (health === 'Improving') {
    return 'positive' as const;
  }
  if (health === 'Stable') {
    return 'neutral' as const;
  }
  return 'negative' as const;
}

export function toneForFreshness(status: FreshnessStatus) {
  if (status === 'fresh') {
    return 'positive' as const;
  }
  if (status === 'aging') {
    return 'warning' as const;
  }
  return 'negative' as const;
}

export function freshnessText(days: number | undefined, status: FreshnessStatus) {
  if (days == null) {
    return status === 'stale' ? 'Unavailable' : 'Waiting';
  }
  if (days === 0) {
    return 'Today';
  }
  if (days === 1) {
    return '1 day old';
  }
  return `${Math.round(days)} days old`;
}

export function toneForAlert(severity: AlertItem['severity']) {
  if (severity === 'high') {
    return 'negative' as const;
  }
  if (severity === 'medium') {
    return 'warning' as const;
  }
  return 'positive' as const;
}

export function alertPriorityLabel(severity: AlertItem['severity']) {
  if (severity === 'high') {
    return 'Must fix';
  }
  if (severity === 'medium') {
    return 'Worth checking';
  }
  return 'FYI';
}

export function simpleActionText(action: ActionLabel) {
  switch (action) {
    case 'Buy now':
      return 'Strong fit right now';
    case 'Buy partial':
      return 'Good idea, but ease in';
    case 'Accumulate slowly':
      return 'Worth building over time';
    case 'Watch only':
      return 'Interesting, but not ready';
    case 'Avoid':
      return 'Risk is not worth it';
    case 'Hold':
      return 'Keep your current position';
    case 'Trim':
      return 'Position is too large or risky';
    case 'Sell':
      return 'The thesis is no longer worth carrying';
    case 'Rotate':
      return 'A better replacement is available';
    case 'De-risk':
      return 'Risk needs to come down';
    case 'Take profit':
      return 'Some gains should be harvested';
    case 'Reassess after earnings':
      return 'Wait until the event passes';
    case 'High-upside / high-risk only':
      return 'Only for a small speculative slice';
    case 'Not suitable for current portfolio':
      return 'Could work elsewhere, not in this portfolio';
    default:
      return action;
  }
}

export function decisionActionSummary(card: Pick<ScoreCard, 'action' | 'decision' | 'confidenceBand'>) {
  return `${card.action}. ${card.decision.why} ${card.decision.sizingDiscipline}`;
}

export function defaultTransactionDraft(): {
  kind: PortfolioTransaction['kind'];
  date: string;
  symbol: string;
  shares: number;
  price: number;
  amount: number;
  splitRatio: number;
  note: string;
} {
  return {
    kind: 'buy',
    date: new Date().toISOString().slice(0, 10),
    symbol: '',
    shares: 0,
    price: 0,
    amount: 0,
    splitRatio: 2,
    note: '',
  };
}

export function transactionNeedsSymbol(kind: PortfolioTransaction['kind']) {
  return kind === 'buy' || kind === 'sell' || kind === 'split';
}

export function transactionNeedsSharesAndPrice(kind: PortfolioTransaction['kind']) {
  return kind === 'buy' || kind === 'sell';
}

export function transactionNeedsAmount(kind: PortfolioTransaction['kind']) {
  return kind === 'deposit' || kind === 'withdrawal' || kind === 'dividend' || kind === 'fee';
}

export function transactionNeedsSplitRatio(kind: PortfolioTransaction['kind']) {
  return kind === 'split';
}

export function transactionIsValid(draft: ReturnType<typeof defaultTransactionDraft>) {
  if (!draft.date) {
    return false;
  }

  if (transactionNeedsSymbol(draft.kind) && !normalizeSymbol(draft.symbol)) {
    return false;
  }

  if (transactionNeedsSharesAndPrice(draft.kind)) {
    return draft.shares > 0 && draft.price > 0;
  }

  if (transactionNeedsAmount(draft.kind)) {
    return draft.amount > 0;
  }

  if (transactionNeedsSplitRatio(draft.kind)) {
    return draft.splitRatio > 0;
  }

  return true;
}

export function transactionAmountLabel(kind: PortfolioTransaction['kind']) {
  switch (kind) {
    case 'deposit':
      return 'Cash deposited';
    case 'withdrawal':
      return 'Cash withdrawn';
    case 'dividend':
      return 'Dividend received';
    case 'fee':
      return 'Fee paid';
    default:
      return 'Amount';
  }
}

export function dataQualityTone(score: number) {
  if (score >= 75) {
    return 'positive' as const;
  }
  if (score >= 55) {
    return 'warning' as const;
  }
  return 'negative' as const;
}

export function sourceModeLabel(sourceMode: 'seeded' | 'live' | 'blended' | 'derived' | undefined) {
  switch (sourceMode) {
    case 'live':
      return 'Live';
    case 'blended':
      return 'Blended';
    case 'derived':
      return 'Derived';
    case 'seeded':
    default:
      return 'Seeded';
  }
}

export function liveStatusText(
  symbol: string,
  loadingSymbols: string[],
  quoteErrors: Record<string, string>,
  liveQuotes: Record<string, LiveQuoteSnapshot>,
) {
  if (loadingSymbols.includes(symbol)) {
    return 'Refreshing';
  }

  if (quoteErrors[symbol]) {
    return 'Unavailable';
  }

  if (liveQuotes[symbol]) {
    return liveQuotes[symbol].sessionLabel;
  }

  return 'Snapshot';
}

export function liveStatusTone(
  symbol: string,
  loadingSymbols: string[],
  quoteErrors: Record<string, string>,
  liveQuotes: Record<string, LiveQuoteSnapshot>,
) {
  if (loadingSymbols.includes(symbol)) {
    return 'neutral' as const;
  }

  if (quoteErrors[symbol]) {
    return 'negative' as const;
  }

  const session = liveQuotes[symbol]?.session;

  if (session === 'regular') {
    return 'positive' as const;
  }

  if (session === 'after-hours' || session === 'pre-market') {
    return 'warning' as const;
  }

  return 'neutral' as const;
}

export function actionPriority(action: ActionLabel) {
  switch (action) {
    case 'Buy now':
      return 0;
    case 'Buy partial':
      return 1;
    case 'Accumulate slowly':
      return 2;
    case 'Watch only':
      return 3;
    case 'Reassess after earnings':
      return 4;
    case 'High-upside / high-risk only':
      return 5;
    case 'Hold':
      return 6;
    case 'Trim':
      return 7;
    case 'Take profit':
      return 8;
    case 'De-risk':
      return 9;
    case 'Rotate':
      return 10;
    case 'Sell':
      return 11;
    case 'Not suitable for current portfolio':
      return 12;
    case 'Avoid':
    default:
      return 13;
  }
}

export function isPotentialBuyAction(action: ActionLabel) {
  return ![
    'Avoid',
    'Trim',
    'Sell',
    'Rotate',
    'De-risk',
    'Take profit',
    'Hold',
    'Not suitable for current portfolio',
  ].includes(action);
}

export function buyPotentialScore(
  card: { opportunity: { score: number }; portfolioFit: { score: number }; timing: { score: number }; risk: { overall: number }; confidence: number },
) {
  return Math.round(
    Math.max(
      0,
      Math.min(
        100,
        card.opportunity.score * 0.34 +
          card.portfolioFit.score * 0.24 +
          card.timing.score * 0.14 +
          (100 - card.risk.overall) * 0.18 +
          card.confidence * 0.1,
      ),
    ),
  );
}

export function buyBlocker(
  card: {
    action: ActionLabel;
    portfolioFit: { score: number };
    timing: { score: number };
    risk: { overall: number };
    confidence: number;
  },
) {
  if (card.action === 'Reassess after earnings') {
    return 'The setup is waiting on the earnings window to clear.';
  }

  if (card.action === 'High-upside / high-risk only') {
    return 'Upside is real, but the risk bucket is too hot for a normal-sized position.';
  }

  if (card.portfolioFit.score < 55) {
    return 'Portfolio fit still needs to improve before it deserves fresh capital.';
  }

  if (card.timing.score < 55) {
    return 'The business may work, but the entry timing is still mediocre.';
  }

  if (card.risk.overall > 62) {
    return 'Risk still needs to come down before this moves into the buy bucket.';
  }

  if (card.confidence < 62) {
    return 'The signal is promising, but confidence is not strong enough yet.';
  }

  return 'This is close, but one more improvement in timing, fit, or risk would help.';
}

export function recommendationChangeTone(card: Pick<ScoreCard, 'recommendationChange'>) {
  if (card.recommendationChange.actionChanged) {
    return 'warning' as const;
  }
  if (card.recommendationChange.compositeDelta > 0 || card.recommendationChange.riskDelta < 0) {
    return 'positive' as const;
  }
  if (card.recommendationChange.compositeDelta < 0 || card.recommendationChange.riskDelta > 0) {
    return 'negative' as const;
  }
  return 'neutral' as const;
}

export function actionTimelineText(
  card: Pick<ScoreCard, 'action' | 'recommendationChange'>,
) {
  if (card.recommendationChange.actionChanged) {
    return `${card.recommendationChange.previousAction} -> ${card.action}`;
  }

  if (card.recommendationChange.compositeDelta !== 0) {
    return `Score moved ${card.recommendationChange.compositeDelta > 0 ? 'up' : 'down'} by ${Math.abs(
      card.recommendationChange.compositeDelta,
    ).toFixed(1)} points`;
  }

  return 'No major change';
}

export function starterSizeLabel(weightRange?: [number, number]) {
  if (!weightRange) {
    return 'Starter';
  }

  const midpoint = (weightRange[0] + weightRange[1]) / 2;

  if (midpoint <= 0.03) {
    return 'Small starter';
  }
  if (midpoint <= 0.06) {
    return 'Medium starter';
  }
  return 'Larger starter';
}

export function potentialBuyRows(model: {
  dataset: { holdings: Array<{ symbol: string }> };
  scorecards: ScoreCard[];
}) {
  const heldSymbols = new Set(model.dataset.holdings.map((holding) => holding.symbol));

  return model.scorecards
    .filter((card) => !heldSymbols.has(card.symbol) && isPotentialBuyAction(card.action))
    .sort((left, right) => {
      const actionOrder = actionPriority(left.action) - actionPriority(right.action);

      if (actionOrder !== 0) {
        return actionOrder;
      }

      const potentialGap = buyPotentialScore(right) - buyPotentialScore(left);

      if (potentialGap !== 0) {
        return potentialGap;
      }

      return right.composite - left.composite;
    });
}

export function rangeWindow(range: DashboardRange) {
  switch (range) {
    case '1D':
      return 2;
    case '1W':
      return 3;
    case '1M':
      return 2;
    case '3M':
      return 3;
    case '6M':
      return 5;
    case '12M':
    default:
      return 8;
  }
}

export function rangeDays(range: DashboardRange) {
  switch (range) {
    case '1D':
      return 1;
    case '1W':
      return 7;
    case '1M':
      return 31;
    case '3M':
      return 92;
    case '6M':
      return 183;
    case '12M':
    default:
      return 366;
  }
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function valueRatio(left: number, right: number) {
  const absoluteLeft = Math.abs(left);
  const absoluteRight = Math.abs(right);
  const smaller = Math.min(absoluteLeft, absoluteRight);
  const larger = Math.max(absoluteLeft, absoluteRight);

  if (larger === 0) {
    return 1;
  }

  if (smaller === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return larger / smaller;
}

function isCompatibleHistoryStep(
  earlier: PortfolioHistorySnapshot,
  later: PortfolioHistorySnapshot,
) {
  const timeGapMs =
    new Date(later.timestamp).getTime() - new Date(earlier.timestamp).getTime();
  const shortGap = timeGapMs <= 7 * 24 * 60 * 60 * 1000;
  const portfolioRatio = valueRatio(earlier.portfolioValue, later.portfolioValue);
  const costBasisRatio = valueRatio(earlier.costBasisValue, later.costBasisValue);
  const holdingCountDiff = Math.abs(earlier.holdingCount - later.holdingCount);
  const cashGap = Math.abs(earlier.cashValue - later.cashValue);

  if (shortGap && costBasisRatio > 2.5 && holdingCountDiff >= 2) {
    return false;
  }

  if (shortGap && portfolioRatio > 3.5 && holdingCountDiff >= 2) {
    return false;
  }

  if (shortGap && portfolioRatio > 5 && cashGap > 5_000) {
    return false;
  }

  return true;
}

function selectCoherentHistorySnapshots(snapshots: PortfolioHistorySnapshot[]) {
  if (snapshots.length <= 1) {
    return snapshots;
  }

  const coherent = [snapshots.at(-1)!];

  for (let index = snapshots.length - 2; index >= 0; index -= 1) {
    const snapshot = snapshots[index];
    const anchor = coherent[0];

    if (isCompatibleHistoryStep(snapshot, anchor)) {
      coherent.unshift(snapshot);
    }
  }

  return coherent;
}

export function buildDashboardHistorySeries(history: PortfolioHistoryStore, range: DashboardRange) {
  const now = Date.now();
  const intradayBlendWindowMs = 14 * 24 * 60 * 60 * 1000;
  const rangeCutoff = now - rangeDays(range) * 24 * 60 * 60 * 1000;
  const intradayCutoff = now - intradayBlendWindowMs;
  const intradaySnapshots = history.intraday.filter(
    (snapshot) => new Date(snapshot.timestamp).getTime() >= Math.max(rangeCutoff, intradayCutoff),
  );
  const intradayDays = new Set(
    intradaySnapshots.map((snapshot) => dayKey(new Date(snapshot.timestamp))),
  );
  const dailySnapshots = history.daily.filter((snapshot) => {
    const timestamp = new Date(snapshot.timestamp).getTime();

    if (timestamp < rangeCutoff) {
      return false;
    }

    if (timestamp < intradayCutoff) {
      return true;
    }

    return !intradayDays.has(dayKey(new Date(snapshot.timestamp)));
  });
  const mergedSnapshots = [...dailySnapshots, ...intradaySnapshots].sort(
    (left, right) =>
      new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
  );
  const coherentSnapshots = selectCoherentHistorySnapshots(mergedSnapshots);
  const values = coherentSnapshots.map((snapshot) => snapshot.portfolioValue);
  const timestamps = coherentSnapshots.map((snapshot) => snapshot.timestamp);

  return {
    values,
    timestamps,
    usesPersistedHistory: values.length >= 2,
    pointCount: values.length,
    trimmedForContinuity: coherentSnapshots.length < mergedSnapshots.length,
  };
}

export function signedCurrency(value: number) {
  return `${value >= 0 ? '+' : '-'}${formatCurrency(Math.abs(value))}`;
}

export function formatStrategyLabel(label: string) {
  return label.replace(/-/g, ' ');
}

export function strategyWeightPercentages(
  weights: { growth: number; quality: number; balanced: number; value: number; momentum: number; defensive: number; dividend: number; speculative: number },
) {
  return {
    growth: Math.round(weights.growth * 100),
    quality: Math.round(weights.quality * 100),
    balanced: Math.round(weights.balanced * 100),
    value: Math.round(weights.value * 100),
    momentum: Math.round(weights.momentum * 100),
    defensive: Math.round(weights.defensive * 100),
    dividend: Math.round(weights.dividend * 100),
    speculative: Math.round(weights.speculative * 100),
  };
}

export function symbolMatches(directory: SymbolDirectoryEntry[], query: string) {
  if (!query.trim()) {
    return [];
  }

  return directory.filter((entry) => symbolMatchesQuery(entry, query)).slice(0, 8);
}

export function quickActionNarrative(model: {
  deploymentPlan: { availableCash: number; deployNow: number; holdBack: number; allocations: Array<{ symbol: string; dollars: number }> };
}) {
  const plan = model.deploymentPlan;
  const allocations = plan.allocations
    .map((allocation) => `${allocation.symbol} (${formatCurrency(allocation.dollars)})`)
    .join(', ');

  return `You have ${formatCurrency(plan.availableCash)} available. Deploy ${formatCurrency(
    plan.deployNow,
  )} now and keep ${formatCurrency(plan.holdBack)} in reserve. Focus on ${allocations || 'no new buys'} while staying inside current sector and drawdown constraints.`;
}

export function heldQuoteSessionSummary(
  holdings: Array<{ symbol: string }>,
  liveQuotes: Record<string, LiveQuoteSnapshot>,
) {
  const counts = holdings.reduce(
    (summary, holding) => {
      const session = liveQuotes[holding.symbol]?.session;

      if (!session) {
        return summary;
      }

      summary[session] += 1;
      return summary;
    },
    {
      regular: 0,
      'after-hours': 0,
      'pre-market': 0,
    } as Record<LiveQuoteSnapshot['session'], number>,
  );

  if (counts['after-hours'] > 0 && counts.regular === 0 && counts['pre-market'] === 0) {
    return `Active session is after hours for ${counts['after-hours']} held ${counts['after-hours'] === 1 ? 'position' : 'positions'}.`;
  }

  if (counts['pre-market'] > 0 && counts.regular === 0 && counts['after-hours'] === 0) {
    return `Active session is pre-market for ${counts['pre-market']} held ${counts['pre-market'] === 1 ? 'position' : 'positions'}.`;
  }

  if (counts.regular > 0 && counts['after-hours'] === 0 && counts['pre-market'] === 0) {
    return `Active session is regular trading for ${counts.regular} held ${counts.regular === 1 ? 'position' : 'positions'}.`;
  }

  const parts = [
    counts.regular > 0 ? `${counts.regular} regular` : '',
    counts['after-hours'] > 0 ? `${counts['after-hours']} after hours` : '',
    counts['pre-market'] > 0 ? `${counts['pre-market']} pre-market` : '',
  ].filter(Boolean);

  return parts.length > 0 ? `Held quote sessions: ${parts.join(', ')}.` : '';
}

export function homeSeries(model: CommandCenterModel) {
  const points = Math.max(
    8,
    ...model.dataset.securities.map((security) => security.priceHistory.length),
  );

  if (model.dataset.holdings.length === 0) {
    return Array.from({ length: points }, () => model.dataset.user.investableCash);
  }

  return Array.from({ length: points }, (_, index) => {
    const holdingsValue = model.dataset.holdings.reduce((total, holding) => {
      const security = getSecurity(model, holding.symbol);

      if (!security || security.price <= 0) {
        return total;
      }

      const historyIndex = Math.max(
        0,
        security.priceHistory.length - points + index,
      );
      const historicalPrice = security.priceHistory[historyIndex] ?? security.price;
      return total + holding.shares * historicalPrice;
    }, 0);

    return holdingsValue + model.dataset.user.investableCash;
  });
}

export function compareOverlap(
  model: CommandCenterModel,
  symbolLeft: string,
  symbolRight: string,
) {
  const left = getSecurity(model, symbolLeft);
  const right = getSecurity(model, symbolRight);

  if (!left || !right) {
    return 0;
  }

  const valuesLeft = Object.values(left.factors);
  const valuesRight = Object.values(right.factors);
  const shared = valuesLeft.reduce((total, value, index) => total + Math.min(value, valuesRight[index]), 0);
  const overlap = shared / 6 + (left.sector === right.sector ? 18 : 0);

  return Math.min(95, Math.round(overlap));
}

export function currentSetupSummary(
  dataset: { user: { targetStrategy: string[]; maxSectorWeight: number; targetCashReserve: number; benchmarkSymbol: string } },
  model: { deploymentPlan: { holdBack: number } },
) {
  const strategy = dataset.user.targetStrategy
    .slice(0, 3)
    .map(formatStrategyLabel)
    .join(', ');
  const sectorCap = Math.round(dataset.user.maxSectorWeight * 100);
  const reserveNow = model.deploymentPlan.holdBack;
  const reserveTarget = dataset.user.targetCashReserve;
  const reserveDetail =
    reserveTarget > reserveNow + 1
      ? `${formatCurrency(reserveNow)} is being held back now versus a longer-run reserve target of ${formatCurrency(
          reserveTarget,
        )}`
      : `${formatCurrency(reserveNow)} is currently being held in reserve`;

  return `Current profile leans ${strategy}. ${reserveDetail}, with a ${sectorCap}% sector cap and ${dataset.user.benchmarkSymbol} as the benchmark.`;
}
