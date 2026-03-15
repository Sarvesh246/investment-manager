# Atlas Capital Command – Technical Overview

This document describes how the app works end-to-end: data pipeline, algorithm engine, and how every component uses your inputs to make decisions.

---

## 1. High-Level Pipeline

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────────┐     ┌─────────────┐
│ Base data       │     │ Portfolio        │     │ buildCommandCenterModel │     │ UI pages    │
│ (seeded/live    │ ──► │ Workspace       │ ──► │ (engine)                │ ──► │ consume     │
│ snapshot +      │     │ merges user +   │     │ produces model          │     │ model +     │
│ symbol dir)     │     │ live securities │     │ (scorecards, alerts,    │     │ dataset     │
└─────────────────┘     └──────────────────┘     │ plan, holdings, etc.)   │     └─────────────┘
                                                  └─────────────────────────┘
```

- **Base data**: `currentDataset` = `liveSnapshot` (if present) or `mockData` – static or pre-built snapshot of securities, benchmark, optional macro.
- **Portfolio Workspace** (runtime): Loads persisted user state (holdings, cash, transactions, settings, journal, watchlists), fetches symbol directory and live Yahoo data for held symbols, and builds a single **dataset** that merges base + user + live.
- **Engine**: `buildCommandCenterModel(dataset)` runs once per dataset change. It infers regime, builds portfolio context, scores every security, builds holdings analysis, alerts, deployment plan, watchlist movers, and freshness hierarchy. Output is the **model** object.
- **UI**: All pages read `dataset` and `model` from `usePortfolioWorkspace()` and render; no separate “API” – the model is the source of truth.

---

## 2. Data Sources and How the Dataset Is Built

### 2.1 Base dataset

- **Location**: `src/data/currentDataset.ts` → `liveSnapshot ?? mockDataset`.
- **Contents**: `MockDataset` with:
  - `asOf`, `snapshotGeneratedAt`, `dataMode` (seeded/live/blended)
  - `user`: base user profile (overridden by runtime user settings and cash)
  - `securities`: array of `SecuritySeed` (symbol, name, sector, price, `fundamentalsLastUpdated`, `factors`, `metrics`, `priceHistory`, etc.)
  - `benchmark`: `BenchmarkSeed` (price, returns, aboveSma50/200, realizedVolPercentile, breadth, riskAppetite, drawdown)
  - `macroSnapshot` (optional): yields, curve, unemployment, inflation, highYieldSpread, narrative, riskTone
  - `validationReport` (optional): backtest/calibration metrics
  - `holdings`, `transactions`, `watchlists`, `journal`: base sets (runtime replaces these from persisted state)

### 2.2 Runtime dataset (Portfolio Workspace)

- **Location**: `src/runtime/portfolioWorkspace.tsx`.
- **Persisted state** (localStorage): holdings, investable cash, transactions, ledger baseline, user settings, theme, journal, watchlists. On load, this overrides base.
- **Transaction accounting**: `replayTransactions(baseline, transactions)` replays deposits, withdrawals, buys, sells, dividends, fees, splits to derive **current holdings** and **investable cash** from the ledger. So “holdings” and “cash” are the result of your transaction history plus the last baseline.
- **User settings** (from Settings): `userSettings` is merged into `dataset.user` (and `investableCash` comes from accounting). So: risk tolerance, sector caps, max position weight, avoid-earnings / avoid-dilution / avoid-cash-burners, target cash reserve, benchmark, strategy weights, excluded sectors, etc. all live in `dataset.user`.
- **Securities list**:
  - Base securities are always included.
  - Each base security is **replaced** by `liveSecurities[symbol]` if that symbol has been “live-loaded” (see below).
  - **Provisional** securities: any symbol you hold that is not in base and not yet in live get a minimal `SecuritySeed` from `createProvisionalSecurity(symbol, costBasis)` so the engine can still score them.
  - **Live-only** securities: symbols that appear only in `liveSecurities` (e.g. user-added from Ideas/Discovery) are appended so the universe includes your holdings and any fully loaded live symbols.
- **Symbol directory**: Fetched from `symbol-directory.json`; used for lookup/autocomplete and “loading symbols…” in the sidebar. Not part of the engine input.
- **Live Yahoo data**:
  - **Quotes**: Polling for held symbols every 5s; results stored in `liveQuotes`. `applyQuoteToSecurity(seed, quote)` updates price and latest history point.
  - **Full security load** (`ensureLiveSecurity(symbol)` / `fetchFullSymbol`): Fetches Yahoo price history + fundamentals for a symbol, then builds or merges a `SecuritySeed` via `buildSecurityFromLiveData` / `mergeSecurityWithLiveData` and stores it in `liveSecurities`. That symbol then appears in `dataset.securities` (replacing base or as extra). Used when you add a holding or open a stock page so the engine has up-to-date metrics and fundamentals.

So the **dataset** the engine sees = base snapshot + your holdings/cash/transactions (from accounting) + your settings + base securities with live-override where available + provisional/live-only securities for your positions.

---

## 3. Algorithm Engine – What Runs Inside `buildCommandCenterModel(dataset)`

The engine is pure functions in `src/domain/engine.ts`. It does not call APIs; it only uses `dataset` and types.

### 3.1 Regime inference (`inferRegime(dataset)`)

- **Inputs**: `dataset.benchmark` (trend, volatility, breadth, risk appetite), optional `dataset.macroSnapshot` (risk tone, spreads, curve).
- **Logic**:
  - Trend score = aboveSma50 + aboveSma200 (0, 1, or 2).
  - Macro “tightening” = riskTone &lt; 0.42 or highYieldSpread ≥ 5 or curve 2s10s &lt; -0.2.
  - Branches: “Bullish trend / low vol”, “Bullish trend / high vol”, “Bearish trend / high vol”, “Risk-off defensiveness”, “Risk-on rotation”, or default “Sideways / low conviction”.
- **Output**: `RegimeSnapshot`: `key`, `narrative`, `confidence`, `deploymentTilt` (-0.65 to 0.7), `factorEmphasis` (array of strings). Used to tighten/loosen action thresholds and deployment and to generate the regime alert.

### 3.2 Portfolio context (`buildPortfolioContext(dataset)`)

- **Inputs**: `dataset.holdings`, `dataset.securities`, `dataset.user.investableCash`.
- **Logic**:
  - For each holding, resolve security and compute market value (price × shares).
  - Portfolio value = sum(market values) + investable cash.
  - Largest holding by market value; sector exposure (weight per sector); factor totals (growth, quality, value, momentum, defensive, cyclical) as value-weighted sums across holdings.
- **Output**: `holdings` (with marketValue), `investedValue`, `portfolioValue`, `largestHolding`, `sectorExposure`, `factorTotals`. Used in fit, risk, and overlap calculations.

### 3.3 Per-security scoring (`scoreSecurity(dataset, regime, portfolioContext, seed)`)

Every security in `dataset.securities` is scored once. Below is what goes into each score and how your inputs affect it.

#### 3.3.1 Opportunity score (business + valuation + momentum)

- **Growth**: Ranked revenue growth, revenue CAGR, EPS growth across universe (and optionally sector-relative).
- **Quality**: Ranked margins, FCF margin/consistency, ROIC, margin stability.
- **Valuation**: Sector/self valuation percentiles (lower percentile = cheaper = better), FCF yield, growth-adjusted valuation.
- **Momentum**: Ranked ret3m, ret6m, ret12m, trend slope, relative strength.
- **Support**: Surprise, revision, insider, catalyst scores.
- **Balance sheet**: Ranked debt-to-equity, cash-to-debt, current/quick ratios.
- **Weights**: growth 22%, quality 23%, valuation 18%, momentum 17%, support 10%, balanceSheet 10%.
- **User impact**: None directly; user’s `excludedSectors` can force action to Avoid later. `allowedMarketCaps` / `allowedSecurityTypes` feed into capital/constraint fit, not opportunity.

#### 3.3.2 Fragility score (risk factors)

- Financial stress, cash-burn/dilution, event sensitivity (earnings gap, event concentration, earnings days), margin fragility, tail/drawdown risk, valuation vulnerability. All are weighted and combined into a single fragility score (higher = more fragile).
- **User impact**: `avoidEarningsRisk` + `earningsDays &lt; 14` → action can become “Reassess after earnings”. `avoidDilutionProne` / `avoidCashBurners` cap composite and affect capital fit.

#### 3.3.3 Timing score (entry quality from price behavior)

- Trend alignment, pullback quality, momentum persistence, volatility window, event window (earnings proximity). Weighted combination.
- **User impact**: `avoidEarningsRisk` and earnings proximity reduce event-window score and can downgrade action.

#### 3.3.4 Portfolio fit score

- **Diversification**: (1 − correlation to portfolio) and (1 − factor similarity); penalized if same sector as largest holding.
- **Sector balance**: Penalty if adding this position would push sector weight over `dataset.user.maxSectorWeight`.
- **Factor balance**: (1 − factor similarity to portfolio).
- **Risk budget**: Combination of preliminary risk and correlation to portfolio.
- **Capital and rule fit**: Uses `investableCash`, `maxSinglePositionWeight`, `excludedSectors`, `allowedSecurityTypes`, `avoidDilutionProne`, `avoidCashBurners`.
- **User impact**: `maxSectorWeight`, `maxSinglePositionWeight`, `excludedSectors`, `allowedSecurityTypes`, `avoidDilutionProne`, `avoidCashBurners` directly shape fit. Your actual holdings and cash determine diversification and sector/factor balance.

#### 3.3.5 Data quality score (`assessDataQuality(dataset, seed)`)

- **Inputs**: `seed.priceAsOf`, `seed.fundamentalsLastUpdated`, `dataset.asOf`, `seed.dataQuality` (sourceMode, coverage, inferredSignals, missingCoreFields).
- **Logic**: Coverage + source bonus (live/blended) − penalties: stale fundamentals (days &gt; 180), price age, inferred signals, missing core fields. When price is fresh (≤3 days) but fundamentals are stale, the fundamental penalty is capped so data quality isn’t crushed.
- **User impact**: None; this is per-security data state. Data quality then affects confidence and action thresholds.

#### 3.3.6 Confidence

- Starts at 70. Reductions: low liquidity, near-term earnings, large post-earnings gap, big opportunity–timing or opportunity–fit gaps, low data quality, signal redundancy (crowding). Additions: mega cap, high FCF consistency. If “lean on market data” (price fresh, fundamentals stale), data-quality penalty is halved and a small timing bonus is added.
- **Optional**: `dataset.sectorContext` (headwind/tailwind per sector) nudges confidence by (tailwind − headwind) × 0.03.

#### 3.3.7 Risk breakdown and overall risk

- **Market risk**: Ranked vol, downside vol, max drawdown, beta, tail loss.
- **Event risk**: Post-earnings gap, event concentration, earnings days.
- **Business risk**: Financial stress, cash-burn/dilution, margin fragility, cyclicality.
- **Valuation risk**: Sector/self valuation percentiles, growth-adjusted valuation.
- **Portfolio contribution**: Correlation to portfolio and largest holding, sector/factor balance.
- **Overall** = weighted sum (e.g. market 25%, event 15%, business 25%, valuation 10%, portfolio 25%). Optional `sectorContext` headwind/tailwind nudges overall risk.
- **Bucket**: Defensive / Moderate / Elevated / Aggressive / Fragile from overall risk level.
- **User impact**: Portfolio composition and sector/position limits affect portfolio contribution and sector balance, which feed into risk.

#### 3.3.8 Composite score

- Formula in 0–100: combination of opportunity, fragility, timing, fit, confidence (normalized) plus regime bonus. Penalties for excluded sector, avoid-cash-burners, and signal redundancy. Used for ranking and for action gates.

#### 3.3.9 Expected returns and probabilities

- Base 12M return from decile lookups (opportunity, composite, business quality) and a small model term. Probabilities: positive return, outperform benchmark, drawdown. Scenarios for 3M / 6M / 12M with bear/base/bull and probabilities.

#### 3.3.10 Action classification (`classifyAction(inputs)`)

- **Inputs**: isHeld, excludedSector, avoidEarningsRisk, earningsDays, businessQuality, entryQuality, opportunityScore, portfolioFitScore, timingScore, overallRisk, confidence, composite, expected12m, excessiveSingle, excessiveSector, regimeTilt, dataQualityScore.
- **Order of checks** (simplified):
  - Excluded sector → **Avoid**.
  - Held + (excessive single or sector) + high risk → **Trim**.
  - Held → **Hold** if composite and business quality above thresholds, else **Trim**.
  - avoidEarningsRisk and earnings &lt; 14 days → **Reassess after earnings**.
  - Poor fit but high opportunity → **Not suitable for current portfolio**.
  - Very high risk + high expected return → **High-upside / high-risk only**.
  - High business quality, weak entry → **Watch only**.
  - Then tiered buy gates: **Buy now** (highest bars), **Buy partial**, **Accumulate slowly**, **Watch only**, else **Avoid**.
- **Regime**: Negative `regimeTilt` tightens risk thresholds (harder to get Buy now) and adds a confidence tightener.
- **Hysteresis**: `applyActionHysteresis` keeps previous action if composite and risk moved only slightly (abs &lt; 4 and &lt; 5) and not hard-locked, to avoid flip-flopping.

#### 3.3.11 Thesis health, allocation, explainability, fit impact

- **Thesis health**: Broken / Weakening / Stable / Improving from action, business quality, composite/risk/downside deltas.
- **Allocation**: Max weight from regime, risk bucket, and constraints; entry style (e.g. scale-in vs one-shot) from confidence and timing.
- **Explainability**: Top drivers and penalties for narrative text.
- **Fit impact**: Overlap and sector/factor impact if the position were added.

#### 3.3.12 Freshness

- `buildFreshnessBreakdown`: quote vs fundamentals vs macro vs validation vs model snapshot ages and status (fresh/aging/stale). Used for display and for data-quality/freshness alerts.

### 3.4 Scorecards and ranking

- **Scorecards**: One per security = all of the above (action, opportunity, timing, fragility, fit, risk, confidence, data quality, expected returns, explanation, thesis health, allocation, etc.).
- **Sort**: By composite descending. So “recommendations” and “next up” are just filtered and sorted views of the same scorecards.

### 3.5 Holdings analysis (`buildHoldingAnalysis`)

- For each holding in portfolio context: get its scorecard, compute weight, unrealized P/L, risk contribution (weight × risk.overall), overlap, concentration flag (vs `maxSinglePositionWeight`), thesis health, sell discipline, replacement idea (if Trim and a better candidate exists).

### 3.6 Alerts (`buildAlerts`)

- **Regime**: Always one alert with regime key and narrative; severity from deployment tilt.
- **Per scorecard**: Action change (with summary); composite move ≥5; risk change ≥6 (if action unchanged); data freshness warning (held or buy-ish action + stale fundamentals); earnings proximity (if avoidEarningsRisk and earnings &lt; 14 days and not held).
- **Concentration**: Sector over `maxSectorWeight` → high-severity alert.
- Sorted by severity, then kind; top 12 returned.

### 3.7 Deployment plan (`buildDeploymentPlan`)

- **Inputs**: dataset, regime, scorecards, portfolio value, planner inputs (available cash, risk tolerance, horizon, priority, deployment style).
- **Candidate pool**: Non-held scorecards with action in [Buy now, Buy partial, Accumulate slowly, High-upside / high-risk only], data quality ≥ 52, confidence not Low, fit ≥ fitFloor, risk ≤ riskCap. Sorted by composite.
- **Priority** (e.g. diversification vs growth vs conviction) sets fitFloor, riskCap, deployAdjustment.
- **Deploy fraction**: From regime tilt, top-candidate quality/data quality/confidence, risk tolerance, priority, deployment style, horizon, then clamped. Reserve = max(targetCashReserve, availableCash × (1 − deployFraction)); deployNow = availableCash − reserve.
- **Allocations**: Top 4 candidates get dollar amounts from deployNow by normalized score-edge (composite + expected return − risk). Capped by each candidate’s max weight × portfolio value.
- **Avoids**: Non-held with action Avoid / Not suitable / Reassess after earnings, top 4 with reasons.

### 3.8 Watchlist movers (`buildWatchlistMovers`)

- For each watchlist and each symbol in it: find security, report 1M return and a short note. Used on dashboard for “watchlist activity”.

### 3.9 Freshness hierarchy (`buildFreshnessHierarchy`)

- Aggregates quote, fundamentals, macro, validation, model freshness across dataset/scorecards for the “Freshness Hierarchy” panel (Dashboard, Stock, Settings).

### 3.10 Final model output

- **dataset**, **regime**, **scorecards** (sorted by composite), **holdings** (analysis), **ledgerSummary**, **alerts**, **watchlistMovers**, **deploymentPlan**, **sectorExposure**, **factorExposure**, **riskExposure** (by bucket), **concentrationIssues**, **portfolioValue**, **diversificationScore**, **averageRisk**, **freshnessHierarchy**, **notableChanges** (top 5 alert messages).

---

## 4. How Your Inputs Affect Each Component

| Input | Where it lives | What it affects |
|-------|----------------|-----------------|
| Holdings / cash / transactions | Persisted state → accounting → dataset | Portfolio value, sector/factor exposure, fit (diversification, sector balance), risk (portfolio contribution), deployment plan (available cash), which symbols get live quote polling |
| investableCash | Persisted + accounting | dataset.user.investableCash; capital fit, deployment plan (deployNow, holdBack) |
| User settings (risk tolerance, sector caps, max position, avoid earnings/dilution/cash-burn, target reserve, benchmark, strategy, excluded sectors, etc.) | userSettings → dataset.user | Fit (sector balance, capital fit, constraints), action (excluded sector → Avoid; earnings window; composite caps), deployment (risk cap, fit floor, deploy fraction), alerts (sector cap) |
| Live Yahoo data (for held + loaded symbols) | liveSecurities, liveQuotes | Security price, priceAsOf, fundamentalsLastUpdated, metrics (returns, vol, etc.), data quality; regime uses benchmark (which can be from same snapshot). So “current market data” drives timing, market risk, and when fundamentals are stale, confidence/data quality lean on price more |
| Macro snapshot (optional) | dataset.macroSnapshot | Regime narrative and tightening; macro freshness in hierarchy |
| sectorContext (optional) | dataset.sectorContext | Small confidence and overall-risk nudge per sector (for future events/headlines) |

---

## 5. Per-Page / Per-Component Behavior

- **Dashboard (Home)**  
  Uses `model` (regime, portfolio value, deployment plan, watchlist movers, scorecards for “For You” and “Next moves”, alerts, exposure, freshness hierarchy) and `dataset` (investable cash, user). “Next up” and “For You” are filtered/sorted scorecards; chart uses portfolio history or derived series.

- **Explore (Discovery)**  
  Same scorecards; filters by sector, market cap, revenue growth, risk, sort order, action. Table shows ranked universe from filtered scorecards; “Best matches” = top N by readiness/composite.

- **Portfolio**  
  Uses `dataset.holdings`, `dataset.transactions`, `model.holdings` (analysis with action, risk contribution, overlap, concentration), sector/factor exposure, overlap matrix. Add/remove holdings and transactions; accounting recomputes; dataset and model recompute.

- **Ideas (Recommendations)**  
  Scorecards grouped by action or filters; each card shows opportunity, timing, risk, fit, confidence, data quality, freshness, expected returns, action. “Next up potential buys” = non-held, buy-ish actions, sorted by composite/readiness.

- **Plan (Planner)**  
  Uses `model.deploymentPlan` (deployNow, holdBack, posture, allocations, avoids, rationale) and planner inputs (cash, risk tolerance, horizon, priority, deployment style). Can override available cash; plan is recomputed from same `buildDeploymentPlan` with those inputs.

- **Watch (Alerts)**  
  `model.alerts`; each alert has severity, kind, message, route. Sorted by severity.

- **Stock page**  
  Single security: scorecard for that symbol (if in universe), freshness breakdown, metrics, explanation, allocation. If symbol not in base universe, it may be provisional or loaded via ensureLiveSecurity so the engine can score it.

- **Settings**  
  Reads/writes `userSettings` (persisted and merged into dataset.user). Data/freshness panel shows `model.freshnessHierarchy`. So changing risk tolerance, sector caps, avoid flags, etc., changes the next model run and thus scores, actions, and plan.

- **Journal**  
  Persisted journal entries; no engine dependency. Used for your own decision log.

---

## 6. Summary

- **Pipeline**: Base data + persisted user state + transaction accounting + live Yahoo (for held and loaded symbols) → single **dataset**. Engine runs **buildCommandCenterModel(dataset)** → **model** (scorecards, regime, holdings analysis, alerts, deployment plan, exposure, freshness). UI reads **dataset** and **model**.
- **Recommendations**: Every security is scored (opportunity, timing, fragility, fit, data quality, confidence, risk); composite ranks them; **classifyAction** turns scores + your rules into an action (Buy now, Buy partial, Avoid, etc.). Your inputs (holdings, cash, settings, excluded sectors, avoid-earnings/dilution/cash-burn, caps) directly shape fit, action, and plan.
- **No external “AI” or black box**: All logic is deterministic rules and weighted combinations in the engine; live data only updates the security inputs (price and fundamentals) and benchmark so that “current market data” and optional “current events” (sectorContext) can influence scores and actions as described above.
