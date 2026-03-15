import type {
  BrokerImportPosition,
  BrokerImportSnapshot,
  HoldingAnalysis,
  PortfolioReconciliation,
  ReconciliationItem,
} from './types';

function roundMoney(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.round(value * 100) / 100;
}

function inferredBrokerValue(position: BrokerImportPosition) {
  if (position.marketValue != null && Number.isFinite(position.marketValue)) {
    return position.marketValue;
  }

  if (position.marketPrice != null && Number.isFinite(position.marketPrice)) {
    return position.marketPrice * position.shares;
  }

  return undefined;
}

function almostEqual(left: number | undefined, right: number | undefined, tolerance = 0.00001) {
  if (left == null || right == null) {
    return false;
  }

  return Math.abs(left - right) <= tolerance;
}

function buildItem(
  symbol: string,
  appHolding: HoldingAnalysis | undefined,
  brokerHolding: BrokerImportPosition | undefined,
): ReconciliationItem {
  if (!appHolding && brokerHolding) {
    return {
      symbol,
      status: 'Missing in app',
      brokerShares: brokerHolding.shares,
      brokerMarketValue: roundMoney(inferredBrokerValue(brokerHolding)),
      brokerCostBasis: roundMoney(brokerHolding.costBasis),
      differenceValue: roundMoney(inferredBrokerValue(brokerHolding)),
      note: 'This position appears in the broker import but not in your current app portfolio.',
    };
  }

  if (appHolding && !brokerHolding) {
    return {
      symbol,
      status: 'Missing in broker',
      appShares: appHolding.shares,
      appMarketValue: roundMoney(appHolding.marketValue),
      appCostBasis: roundMoney(appHolding.costBasis),
      differenceValue: roundMoney(appHolding.marketValue),
      note: 'This position appears in the app but not in the imported broker snapshot.',
    };
  }

  const brokerValue = inferredBrokerValue(brokerHolding!);
  const shareDifference = roundMoney((appHolding?.shares ?? 0) - (brokerHolding?.shares ?? 0));
  const marketDifference = roundMoney((appHolding?.marketValue ?? 0) - (brokerValue ?? 0));
  const costDifference = roundMoney((appHolding?.costBasis ?? 0) - (brokerHolding?.costBasis ?? 0));

  if (!almostEqual(shareDifference, 0)) {
    return {
      symbol,
      status: 'Share count differs',
      appShares: appHolding?.shares,
      brokerShares: brokerHolding?.shares,
      appMarketValue: roundMoney(appHolding?.marketValue),
      brokerMarketValue: roundMoney(brokerValue),
      appCostBasis: roundMoney(appHolding?.costBasis),
      brokerCostBasis: roundMoney(brokerHolding?.costBasis),
      differenceValue: marketDifference,
      note: `The app and broker disagree on the number of shares for ${symbol}.`,
    };
  }

  if (
    brokerHolding?.costBasis != null &&
    appHolding?.costBasis != null &&
    !almostEqual(costDifference, 0, 0.01)
  ) {
    return {
      symbol,
      status: 'Cost basis differs',
      appShares: appHolding?.shares,
      brokerShares: brokerHolding?.shares,
      appMarketValue: roundMoney(appHolding?.marketValue),
      brokerMarketValue: roundMoney(brokerValue),
      appCostBasis: roundMoney(appHolding?.costBasis),
      brokerCostBasis: roundMoney(brokerHolding?.costBasis),
      differenceValue: costDifference,
      note: 'The share count matches, but your average buy price does not.',
    };
  }

  if (brokerValue != null && !almostEqual(marketDifference, 0, 0.5)) {
    return {
      symbol,
      status: 'Price differs',
      appShares: appHolding?.shares,
      brokerShares: brokerHolding?.shares,
      appMarketValue: roundMoney(appHolding?.marketValue),
      brokerMarketValue: roundMoney(brokerValue),
      appCostBasis: roundMoney(appHolding?.costBasis),
      brokerCostBasis: roundMoney(brokerHolding?.costBasis),
      differenceValue: marketDifference,
      note: 'The share count matches, but the live market value is different.',
    };
  }

  return {
    symbol,
    status: 'Aligned',
    appShares: appHolding?.shares,
    brokerShares: brokerHolding?.shares,
    appMarketValue: roundMoney(appHolding?.marketValue),
    brokerMarketValue: roundMoney(brokerValue),
    appCostBasis: roundMoney(appHolding?.costBasis),
    brokerCostBasis: roundMoney(brokerHolding?.costBasis),
    differenceValue: marketDifference,
    note: 'This position lines up with the imported broker snapshot.',
  };
}

export function buildPortfolioReconciliation(input: {
  brokerSnapshot: BrokerImportSnapshot | null;
  holdings: HoldingAnalysis[];
  investableCash: number;
  portfolioValue: number;
}) {
  const { brokerSnapshot, holdings, investableCash, portfolioValue } = input;

  if (!brokerSnapshot) {
    return null;
  }

  const modeledHoldingsValue = holdings.reduce((sum, holding) => sum + holding.marketValue, 0);
  const brokerHoldingsValue =
    brokerSnapshot.holdingsValue ??
    brokerSnapshot.positions.reduce((sum, position) => sum + (inferredBrokerValue(position) ?? 0), 0);
  const brokerPortfolioValue =
    brokerSnapshot.portfolioValue ??
    (brokerHoldingsValue > 0 || brokerSnapshot.cash != null
      ? brokerHoldingsValue + (brokerSnapshot.cash ?? 0)
      : undefined);
  const items = [...new Set([
    ...holdings.map((holding) => holding.symbol),
    ...brokerSnapshot.positions.map((position) => position.symbol),
  ])]
    .sort((left, right) => left.localeCompare(right))
    .map((symbol) =>
      buildItem(
        symbol,
        holdings.find((holding) => holding.symbol === symbol),
        brokerSnapshot.positions.find((position) => position.symbol === symbol),
      ),
    );

  const likelyCauses: string[] = [];
  if (items.some((item) => item.status === 'Missing in app' || item.status === 'Missing in broker')) {
    likelyCauses.push('One or more positions are missing between the app and the imported broker snapshot.');
  }
  if (items.some((item) => item.status === 'Share count differs')) {
    likelyCauses.push('Some share counts do not match. This is usually the biggest reason totals drift.');
  }
  if (items.some((item) => item.status === 'Price differs')) {
    likelyCauses.push('The share counts match, but market prices differ. Public quotes can drift from broker quotes, especially after hours.');
  }
  if (items.some((item) => item.status === 'Cost basis differs')) {
    likelyCauses.push('Average buy prices do not fully match, so gain and loss numbers may differ.');
  }
  if (brokerSnapshot.cash == null) {
    likelyCauses.push('The import did not include a cash balance, so the cash comparison is incomplete.');
  }

  const portfolioDifference =
    brokerPortfolioValue != null ? roundMoney(portfolioValue - brokerPortfolioValue) : undefined;
  const holdingsDifference =
    brokerHoldingsValue > 0 || modeledHoldingsValue > 0
      ? roundMoney(modeledHoldingsValue - brokerHoldingsValue)
      : undefined;
  const cashDifference =
    brokerSnapshot.cash != null ? roundMoney(investableCash - brokerSnapshot.cash) : undefined;

  const mismatchCount = items.filter((item) => item.status !== 'Aligned').length;
  const summary =
    mismatchCount === 0
      ? 'Your app and broker snapshot line up closely.'
      : `${mismatchCount} position${mismatchCount === 1 ? '' : 's'} still need attention.`;

  return {
    importedAt: brokerSnapshot.importedAt,
    source: brokerSnapshot.source,
    modeledCash: roundMoney(investableCash) ?? 0,
    modeledHoldingsValue: roundMoney(modeledHoldingsValue) ?? 0,
    modeledPortfolioValue: roundMoney(portfolioValue) ?? 0,
    brokerCash: roundMoney(brokerSnapshot.cash),
    brokerHoldingsValue: roundMoney(brokerHoldingsValue),
    brokerPortfolioValue: roundMoney(brokerPortfolioValue),
    cashDifference,
    holdingsDifference,
    portfolioDifference,
    items,
    likelyCauses,
    summary,
  } satisfies PortfolioReconciliation;
}
