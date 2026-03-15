# Validation and Calibration Guide

This doc covers: (A) double-counting of factors, (B) action-gate calibration, (C) regime impact, (D) portfolio-fit impact, and (E) how to use Recommendation History to measure everything.

---

## A. Are any factors double-counted?

### Overlap between signals

**Timing / momentum cluster**

- **Momentum** (opportunity): ret3m, ret6m, ret12m, trend slope, relative strength.
- **Trend** (timing): ret1m, ret3m, distance to SMA50.
- **Persistence** (timing): trend slope, momentum acceleration, relative strength.
- **Pullback** (timing): pullback quality, distance to SMA20.
- **Support** (opportunity): surprise, revision, insider, catalyst scores.

So ret3m, trend slope, and relative strength appear in both opportunity (momentum) and timing (trend, persistence). Pullback and volatility are more distinct.

**Fragility cluster**

- **Financial stress**, **cash-burn/dilution**, **margin fragility**: all from financials (debt, FCF, margins).
- **Tail risk**: vol, downside vol, drawdown, crash frequency, tail loss, beta – overlaps with **market risk** in the risk breakdown.
- **Valuation vulnerability**: sector/self valuation percentiles, growth-adjusted valuation – same inputs as **valuation** in opportunity and **valuation risk** in risk breakdown.
- **Event sensitivity**: post-earnings gap, event concentration, earnings days – overlaps with **event risk** and timing’s **event window**.

So fragility inputs overlap with each other and with risk/opportunity.

### Existing safeguards in the engine

- **Crowding / redundancy penalty** (`engine.ts`):
  - **Price-signal crowding**: `crowdingScore([momentum, trend, pullback, persistence, volatilityWindow])`. When these five are similar (high average, low dispersion), the score is high. Formula: `level - dispersion * 2.2 - 44` clamped to 0–100.
  - **Fragility crowding**: `crowdingScore([financialStress, cashBurnDilution, eventSensitivity, marginFragility, tailRisk, valuationVulnerability])`.
  - **Redundancy penalty**: `max(priceCrowding - 24, 0) * 0.12 + max(fragilityCrowding - 30, 0) * 0.08`, clamped 0–7. This is subtracted from **confidence** (×1.4) and from **composite** (×0.35).
  - When price crowding ≥ 30 or fragility crowding ≥ 36, narrative notes are added so the UI can show “signals telling the same story” / “risk treated as a cluster”.

So there is an explicit guard against overstating conviction when many related signals point the same way. The thresholds (24, 30) and penalty scale (0–7) are tunable if you find confidence/composite still too high in clustered cases.

### What to measure

- For **Buy now** (and other strong actions): look at distribution of `priceSignalCrowding` and `fragilityCrowding` in Recommendation History. If high-crowding runs have worse forward outcomes than low-crowding runs, consider raising the penalty or the thresholds.
- Correlate **redundancyPenalty** with forward hit rate by action: if high-penalty names do no worse than low-penalty names, the penalty may be too strong.

---

## B. Are action gates too aggressive or too conservative?

### What to measure

1. **Buy now**
   - For each run, take records with `action === 'Buy now'`. Later, compare to forward return (e.g. 3M/6M/12M). Metrics: hit rate (positive return), average return, median return, % that became “obvious avoids” (e.g. large drawdown). If hit rate is low or outcomes are weak, gates may be too loose; if you rarely get Buy now and when you do they do well, gates may be too tight.
2. **Watch only vs Buy partial**
   - Take records that were **Watch only** but had high composite/opportunity (e.g. composite 60–68, opportunity ≥ 60). Compare their forward returns to **Buy partial** in the same period. If Watch-only would-have-been-buys do as well as Buy partial, the gate may be too conservative (too many Watch only).
3. **Avoid**
   - Take records with **Avoid** or **Not suitable for current portfolio**. For a sample, check forward returns. If many “avoided” names strongly outperform, the filter may be too aggressive (good names filtered for bad reasons). If avoided names generally do poorly, the filter is doing its job.

### Implementation using Recommendation History

- Each `RecommendationRunSnapshot` has `runAt` and `records[]` with `action`, scores, and `expected12m`.
- Export or persist snapshots (e.g. JSON). Periodically join with forward price data (e.g. from your history or an API) by symbol and runAt → compute actual return over 3M/6M/12M.
- Aggregate by action: count, hit rate, mean/median return, worst drawdown. Repeat by regime, by fit-score band, etc.

---

## C. Does regime adjustment materially improve outcomes?

### What to check

- **Regime-aware vs static thresholds**: The engine uses `regime.deploymentTilt` and `regimeTilt` to tighten or loosen risk/confidence bars in `classifyAction` (e.g. “Buy now” requires lower risk when tilt &lt; 0). Compare:
  - **Actual**: outcomes by action and regime (e.g. “Buy now in Risk-off” vs “Buy now in Bullish trend”).
  - **Counterfactual**: recompute actions with a fixed tilt (e.g. 0) and compare hit rates and returns. If regime-aware thresholds improve hit rate or risk-adjusted return (especially in bad regimes), regime logic is helping. If not, consider simplifying or removing regime-based tightening.

### Implementation

- Recommendation History stores `regimeKey` and `deploymentTilt` per run. Slice by regime and action, then compare forward outcomes. Run a second “synthetic” model with regime forced to “Sideways” (tilt 0) and compare action mix and subsequent returns.

---

## D. Does portfolio fit improve actual portfolio quality?

### What to measure

- **Overlap**: For “fit-aware” picks (e.g. high portfolioFitScore), do they actually produce lower pairwise overlap / lower factor similarity to portfolio in the next run? Track `portfolioFitScore` and `fitImpact` at run time; later measure realized overlap after the position is added.
- **Concentration**: Do high-fit picks lead to fewer concentration breaches (sector or single-name) over the next 3–6 months?
- **Diversification**: Track diversification score (or concentration index) before and after adding fit-aware vs fit-agnostic picks (e.g. top by composite only). If fit-aware adds improve diversification more, portfolio fit is adding value.
- **Risk-adjusted performance**: Compare Sharpe or sortino of “portfolios” that add top-by-composite vs top-by-composite-and-fit over the same period. If fit-aware wins, fit is improving outcomes.

### Implementation

- Recommendation History does not store full portfolio state, but each run has `portfolioValue` and you have `dataset` at run time. You could extend the snapshot with diversification score and sector exposure, or compute them from holdings + records. Then join with future runs to see how overlap/concentration/diversification evolved after following high-fit vs low-fit recommendations.

---

## E. Recommendation History / Model Memory layer

### What was added

- **Types** (`domain/types.ts`):
  - **RecommendationRecord**: symbol, action, composite, opportunityScore, timingScore, portfolioFitScore, confidence, dataQualityScore, riskOverall, riskBucket, expected12m, confidenceBand, reasonTags (top drivers + top penalties).
  - **RecommendationRunSnapshot**: runAt (ISO), datasetAsOf, regimeKey, deploymentTilt, portfolioValue, records[].
- **Engine** (`domain/engine.ts`): **buildRecommendationRunSnapshot(model)** builds one snapshot from the current model (all scorecards → records with the fields above).
- **Runtime** (`portfolioWorkspace.tsx`): After each model build, **buildRecommendationRunSnapshot(model)** is pushed to **recommendationHistory** (capped at 50 runs). Exposed on **PortfolioWorkspaceContext** as **recommendationHistory**.

### How to use it

1. **Export**: From Settings or a dev panel, call something like `JSON.stringify(recommendationHistory, null, 2)` and download. Or add a “Export recommendation history” button that does that.
2. **Join with outcomes**: For each `runAt` and each `record.symbol`, get forward price (e.g. 3M/6M/12M later). Compute actual return. Attach to the record.
3. **Aggregate**: By action, by regime, by confidence band, by fit band: hit rate, mean/median return, drawdown. Compare Buy now vs Watch only vs Avoid.
4. **Calibration**: Compare `expected12m` to realized 12M return (bucketed). If expected is systematically high or low, adjust the engine’s expected-return or probability logic.
5. **Debugging**: When a recommendation looks wrong, find the run in history and inspect reasonTags, scores, and regime. No more guessing.

### Optional next steps

- **Persist** recommendation history to localStorage or a file so it survives refresh and can grow beyond 50 runs.
- **UI**: A “Recommendation history” or “Model memory” page that lists recent runs and, for each run, a table of records with action/scores; later, columns for realized return when you have the data.
- **Backtesting**: Use persisted snapshots + historical price data to simulate “what would the model have recommended at date T?” and compare to what actually happened.

This one layer gives you measurable evidence for double-counting (A), action gates (B), regime (C), and portfolio fit (D), and a path to continuous improvement.
