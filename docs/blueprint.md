# Investment Command Center Blueprint

## 1. Product Thesis

This product is a single-user investing operating system, not a stock screener and not a pseudo-advisor that hides behind vague language. The core job is to improve decision quality by combining investor-specific constraints, explainable quantitative scoring, multi-dimensional risk modeling, market regime awareness, portfolio interaction analysis, allocation logic, and honest uncertainty.

The system answers four questions for every candidate:

1. Is this stock attractive in isolation?
2. How fragile is the thesis?
3. Does it improve this specific portfolio right now?
4. How much capital, if any, should be deployed?

No recommendation should appear without decomposition, penalties, uncertainty, and portfolio context.

## 2. Product Principles

- No false precision. Outputs are scenario-based and probability-weighted.
- No black-box logic. Every action traces back to documented features and rules.
- No forced deployment. Cash is an active allocation.
- Risk is not volatility alone. Event, business, valuation, and portfolio risks matter too.
- Personalization is mandatory. Good stocks can still be bad fits.
- Time-aware validation only. No random train/test shuffling for forecasting tasks.
- Originality comes from integration, not cosmetic UI.

## 3. System Architecture

The product should be built as five cooperating layers:

1. Presentation layer
   - desktop-first command center UI
   - dense dashboards, drill-down research, planner, alerts, journal
   - explainability surfaces attached to every score and action
2. Application layer
   - profile management
   - portfolio state orchestration
   - screening, ranking, recommendation workflows
   - scenario planning and journaling workflows
3. Domain engine layer
   - raw data abstraction
   - feature engineering
   - normalization
   - scoring engines
   - expected return engine
   - risk engine
   - regime engine
   - portfolio fit engine
   - allocation and action engines
   - explainability and validation engines
4. Data layer
   - structured time series
   - fundamentals and event snapshots
   - user profile, constraints, holdings, journal
   - cached score and alert snapshots
5. Integration layer
   - market/fundamental/event provider adapters
   - scheduled refresh jobs
   - optional later AI summarization

Recommended repository layout:

- `src/app`: pages and layout
- `src/components`: UI building blocks
- `src/domain`: types, formulas, engines, config
- `src/data`: mock datasets and adapter contracts
- `src/state`: app orchestration
- `src/lib`: math and utility helpers
- `src/styles`: theme and visual system
- `docs`: blueprint and roadmap

## 4. Page Map

### Main Dashboard

Primary blocks:

- portfolio value, cash, invested capital, reserve target
- deployment recommendation card
- market regime summary
- top opportunities
- top risk warnings
- concentration and overlap diagnostics
- sector/style/risk exposure panels
- watchlist movers
- score changes since yesterday
- “what should I do with my money right now?” panel

### Discovery / Screener

- multi-factor filters
- sort by opportunity, fragility, timing, fit, risk, expected return
- sector-relative and global comparisons
- save to watchlists
- quick compare and drill-down

### Stock Deep Dive

- company snapshot
- factor scorecard
- growth, profitability, balance sheet, valuation sections
- drawdown and volatility profile
- event risk and earnings block
- expected return scenarios
- portfolio fit
- action label and suggested size
- score contribution explanation
- score history and thesis notes

### Portfolio

- holdings, P/L, sizing
- exposure by sector, factor, and risk bucket
- overlap and correlation matrix
- risk contribution table
- trim/rebalance suggestions
- proposed-addition impact panel

### Recommendations

- buy now
- buy partial
- accumulate slowly
- hold
- watch only
- avoid
- trim
- reassess after earnings
- high-upside / high-fragility
- best risk-adjusted
- best diversification additions

### Scenario Planner

Inputs:

- available cash
- risk stance
- horizon
- deployment style
- diversification vs conviction preference

Outputs:

- deploy now amount
- reserve amount
- candidate allocations
- staged entry plan
- names to avoid
- rationale and risk notes

### Alerts / Changes

- score changes
- risk changes
- regime shifts
- valuation entry zone
- earnings proximity
- concentration breaches
- downside spikes
- fragility increases

### Journal / Thesis Log

- why bought
- invalidation conditions
- system snapshot at decision time
- later outcome and postmortem

## 5. Module Interaction Flow

Core modules:

- `profile-engine`
- `portfolio-store`
- `feature-engine`
- `normalization-engine`
- `opportunity-engine`
- `fragility-engine`
- `timing-engine`
- `confidence-engine`
- `regime-engine`
- `risk-engine`
- `portfolio-fit-engine`
- `expected-return-engine`
- `allocation-engine`
- `action-engine`
- `explainability-engine`
- `alert-engine`
- `backtest-engine`

Daily decision flow:

1. Load user profile, constraints, holdings, and benchmark.
2. Load point-in-time market, fundamental, and event data.
3. Build feature vectors `x(i,t)` without leakage.
4. Normalize features with sector-relative, global, self-relative, or portfolio-relative transforms.
5. Compute opportunity, fragility, timing, and confidence sub-scores.
6. Infer current regime.
7. Compute portfolio interaction features and fit score.
8. Estimate return scenarios and downside probabilities.
9. Run allocation logic under constraints.
10. Assign action labels.
11. Generate explainability payloads and alerts.

## 6. Data Model

Core entities:

- `UserProfile`
  - investable cash
  - monthly contribution
  - current holdings
  - time horizon
  - risk tolerance
  - strategy preferences
  - market cap / sector / security filters
  - max single-position size
  - max sector allocation
  - max drawdown tolerance
  - avoid earnings risk flag
  - avoid dilution / cash burn flags
  - target cash reserve
  - preferred holding period
  - benchmark
  - watchlists and thesis tags
- `Holding`
  - symbol, shares, cost basis, market value, sector, tags, entry date
- `SecuritySnapshot`
  - symbol, date, sector, industry, market cap, price, volume, raw metric bundles
- `PriceBar`
  - OHLCV daily bar
- `FundamentalPoint`
  - period-end, reported date, revenue, EPS, margins, FCF, debt, cash, share count, ratios
- `EventPoint`
  - earnings date, surprise history, post-earnings move history, insider activity, revisions
- `FeatureVector`
  - raw values, normalized values, metadata
- `ScoreCard`
  - all sub-scores, risk, expected return scenarios, action, allocation, explainability
- `PortfolioSnapshot`
  - holdings, cash, exposures, risk metrics, regime
- `JournalEntry`
  - thesis, invalidation, system recommendation, later review

Persistence rule: treat snapshots as append-only point-in-time records so history, alerts, and backtests remain auditable.

## 7. Raw Data Layer

Provider interfaces should isolate vendor choice from engine logic:

- `MarketDataProvider`
- `FundamentalsProvider`
- `EventsProvider`
- `BenchmarkProvider`

The domain model should never depend on provider-specific field names.

Point-in-time rules:

- only use fundamentals known as of the decision date
- distinguish reported date from fiscal period end
- keep forward estimates separate from trailing realized metrics
- record stale-data and missing-data flags

Data quality flags should feed confidence penalties:

- missingness percentage
- data age
- liquidity classification
- reporting irregularity flag
- event coverage completeness

## 8. Feature Engineering Framework

For each stock `i` at time `t`, create feature vector `x(i,t)` with the following families.

### Price / Trend Features

- `ret_1m`, `ret_3m`, `ret_6m`, `ret_12m`
- `vol_20d`, `vol_60d`, `vol_252d`
- `downside_vol_60d`
- `max_dd_3m`, `max_dd_6m`, `max_dd_12m`
- `distance_sma_20`, `distance_sma_50`, `distance_sma_200`
- `trend_slope_63d`
- `momentum_acceleration`
- `abnormal_volume_20d`
- `pullback_quality`
- `relative_strength_vs_benchmark`

### Fundamental Features

- `revenue_cagr`
- `revenue_growth_yoy`
- `eps_growth_yoy`
- `gross_margin_trend`
- `operating_margin_trend`
- `fcf_margin`
- `fcf_consistency`
- `debt_trend`
- `net_cash_ratio`
- `interest_coverage_proxy`
- `dilution_rate_3y`
- `liquidity_strength`
- `return_on_capital_quality`

### Valuation Features

- `pe_sector_percentile`
- `ev_sales_sector_percentile`
- `ev_ebitda_sector_percentile`
- `ps_sector_percentile`
- `self_valuation_percentile_5y`
- `growth_adjusted_valuation`
- `fcf_yield`
- `valuation_stretch`

### Risk / Fragility Features

- `leverage_stress`
- `cash_burn_risk`
- `margin_fragility`
- `crash_frequency`
- `earnings_gap_risk`
- `tail_loss_percentile`
- `dilution_fragility`
- `cyclicality_proxy`
- `liquidity_risk`

### Portfolio Interaction Features

- `corr_to_portfolio`
- `corr_to_largest_position`
- `incremental_vol_contribution`
- `incremental_cvar_contribution`
- `sector_overlap_penalty`
- `factor_overlap_penalty`
- `diversification_benefit`
- `capital_fit_score`

### Regime Features

- `regime_beta`
- `risk_on_performance_bias`
- `high_vol_resilience`
- `trend_regime_alignment`
- `quality_regime_alignment`

## 9. Normalization and Signal Processing

Every feature needs a transform policy. Supported transforms:

- robust z-score using median and MAD
- standard z-score
- sector-relative percentile
- historical self-percentile
- rank normalization to `[-1, 1]`
- winsorization
- log transforms for skewed variables

Each feature definition should specify:

- transform mode
- directionality
- sector sensitivity
- outlier cap
- lookback requirement

Examples:

- raw `P/E` becomes sector-relative percentile, inverted so cheaper is better
- raw drawdown becomes a robust z-score, inverted so lower drawdown severity scores better
- market cap may be log-transformed before percentile ranking

## 10. Multi-Engine Scoring Framework

Let `z_k(i,t)` denote normalized feature values.

### Opportunity Score

Measures standalone attractiveness:

`Opportunity_i = sum(w_k * z_k)` over:

- growth
- profitability
- quality
- valuation attractiveness
- estimate revision support
- momentum quality
- catalyst support

Initial group weights:

- growth: 0.22
- profitability/quality: 0.23
- valuation: 0.18
- momentum/trend: 0.17
- revisions/catalyst: 0.10
- balance sheet quality: 0.10

### Fragility Score

Measures thesis breakability:

`Fragility_i = sum(v_j * z_j)` over:

- leverage stress
- dilution risk
- cash burn dependence
- earnings gap sensitivity
- margin instability
- crashiness
- valuation compression risk
- cyclicality

Initial group weights:

- financial stress: 0.25
- cash burn/dilution: 0.20
- earnings/event sensitivity: 0.15
- margin fragility: 0.10
- tail/crash risk: 0.20
- valuation vulnerability: 0.10

Higher is worse.

### Timing Score

Measures whether entry conditions are favorable now:

`Timing_i = sum(u_m * z_m)` over:

- trend persistence
- pullback quality
- momentum acceleration
- support/stretch balance
- volatility behavior
- event timing

Initial group weights:

- trend/persistence: 0.30
- pullback quality: 0.20
- stretch balance: 0.20
- volatility behavior: 0.15
- event timing: 0.15

### Portfolio Fit Score

Measures whether the stock fits this portfolio right now:

`PortfolioFit_i = sum(p_n * z_n)` over:

- diversification benefit
- sector concentration effect
- factor overlap effect
- incremental volatility contribution
- drawdown contribution
- capital efficiency relative to cash
- compatibility with user preferences and constraints

Initial group weights:

- diversification benefit: 0.25
- concentration penalty: 0.20
- correlation overlap: 0.20
- risk-budget compatibility: 0.20
- capital fit and constraints: 0.15

### Confidence Score

Confidence is recommendation trustworthiness, not enthusiasm:

`Confidence_i = base - penalties + consistency_bonus`

Base begins at 70 on a 0-100 scale.

Penalties:

- missing data
- low liquidity
- short or unstable history
- event dependency
- engine disagreement
- microcap or illiquidity risk
- stale fundamentals

Consistency bonus applies when opportunity, timing, fit, and expected return align with low model disagreement.

### Composite Recommendation Score

`Composite_i = a1 * Opportunity_i - a2 * Fragility_i + a3 * Timing_i + a4 * PortfolioFit_i + a5 * ConfidenceAdj_i`

Where `ConfidenceAdj_i = (Confidence_i - 50) / 50`.

Initial coefficients:

- `a1 = 0.36`
- `a2 = 0.24`
- `a3 = 0.14`
- `a4 = 0.18`
- `a5 = 0.08`

Regime and hard risk caps can modify the final usable score.

## 11. Expected Return Model

The return engine must be interpretable and scenario-based.

Targets for 3, 6, and 12 months:

- expected return
- probability of positive return
- probability of outperforming benchmark
- probability of significant drawdown
- bear/base/bull ranges

Version one model stack:

1. Factor decile mapping
   - map current factor exposures to historical forward-return buckets
2. Regularized linear regression
   - estimate forward excess return with interpretable coefficients
3. Logistic regression
   - estimate `P(up)` and `P(outperform)`
4. Scenario approximation
   - derive bear/base/bull from conditional residual or decile distributions

Formulas:

- `ER_h(i) = beta_0,h + beta_h * x(i,t)`
- `P_up_h(i) = sigmoid(gamma_0,h + gamma_h * x(i,t))`
- `P_out_h(i) = sigmoid(delta_0,h + delta_h * x(i,t))`

Honesty controls:

- clip implausible outputs
- widen intervals when confidence is low
- penalize scenarios in hostile regimes
- never show only one precise future number

## 12. Risk Model

Risk is multi-dimensional.

### Market / Price Risk

- annualized volatility
- downside deviation
- beta to benchmark
- idiosyncratic volatility
- max drawdown
- left-tail percentile
- CVaR-style approximation

### Event Risk

- historical post-earnings gap size
- volatility around earnings
- days to earnings penalty
- event concentration score

### Business / Financial Risk

- leverage
- weak liquidity ratios
- negative FCF persistence
- dilution history
- margin instability
- cyclicality

### Valuation Risk

- extreme valuation percentile
- multiple-compression vulnerability
- expectation premium unsupported by quality

### Portfolio Contribution Risk

- incremental variance contribution
- incremental CVaR contribution
- concentration increase
- overlap with largest holdings

Composite structure:

`Risk_i = r1*MarketRisk + r2*EventRisk + r3*BusinessRisk + r4*ValuationRisk + r5*PortfolioContributionRisk`

Initial weights:

- market: 0.25
- event: 0.15
- business: 0.25
- valuation: 0.10
- portfolio contribution: 0.25

Outputs:

- overall risk score
- sub-risk breakdown
- expected downside severity
- risk bucket
- sizing cap multiplier

## 13. Market Regime Model

Inputs:

- benchmark trend vs 50/200-day moving averages
- realized benchmark volatility percentile
- relative breadth proxy
- risk-on / risk-off proxy from benchmark leadership

Regime states:

- bullish trend / low vol
- bullish trend / high vol
- sideways / low conviction
- bearish trend / high vol
- risk-on rotation
- risk-off defensiveness

Version one inference should be rule-based and interpretable. Later versions can consider clustering or HMMs.

Regime effects:

- adjust score coefficient bands
- increase fragility penalties in risk-off
- increase timing/momentum emphasis in strong bullish trends
- reduce deployment fraction when regime confidence is low
- increase cash reserve guidance in choppy or bearish environments

## 14. Portfolio Fit Model

The fit model tests whether adding a stock is additive or redundant.

Inputs:

- sector overlap
- factor overlap
- correlation to portfolio and largest holdings
- incremental volatility and drawdown contribution
- position-size feasibility
- user strategy compatibility

Core formula:

`Fit_i = b1*DiversificationBenefit - b2*OverlapPenalty - b3*ConcentrationPenalty - b4*RiskBudgetPenalty + b5*ConstraintCompatibility`

Interpretation:

- a good stock can still be `Not suitable for current portfolio`
- fit can drop because of sector cap, correlation overlap, capital limitations, or explicit user exclusions

## 15. Allocation and Optimization Model

This engine converts ranked ideas into an actual capital plan.

Objective:

`maximize sum(w_i * ER_i) - lambda1 * PortfolioVariance - lambda2 * ConcentrationPenalty - lambda3 * SectorPenalty - lambda4 * FragilityPenalty + lambda5 * DiversificationBenefit`

Subject to:

- total deployed capital cannot exceed deployable fraction
- cash reserve must stay above target
- each position must remain below max single-position size
- sector weights must remain below sector cap
- forbidden securities get zero weight
- optional risk budget constraint

Transparent v1 heuristic:

1. Estimate deployable cash fraction from regime, opportunity breadth, and reserve target.
2. Remove names blocked by hard rules.
3. Create base target weights from composite score and expected-return quality.
4. Scale by confidence and risk cap multiplier.
5. Penalize overlap-heavy names.
6. Apply sector and concentration caps.
7. Normalize to final allocation percentages and dollar amounts.
8. If timing is mixed, split into staged tranches.

Allocation modes:

- equal-risk inspired
- conviction-weighted
- conservative Kelly-inspired with heavy shrinkage
- staged entry
- hold-cash

## 16. Action Recommendation Logic

Actions are deterministic and auditable.

Action examples:

- `Buy now`
  - high composite
  - positive timing
  - strong portfolio fit
  - acceptable downside and confidence
- `Buy partial`
  - strong opportunity with timing or event caveats
- `Accumulate slowly`
  - good long-term setup, weaker near-term entry
- `Watch only`
  - interesting idea, insufficient current setup
- `Avoid`
  - low expected return or high fragility
- `Trim`
  - holding worsens concentration or score deteriorates
- `Reassess after earnings`
  - event dominates near-term thesis
- `High-upside / high-risk only`
  - upside exists but fragility and uncertainty are too high for core sizing
- `Not suitable for current portfolio`
  - global attractiveness is overridden by local fit

Hard-rule overrides:

- excluded sector
- forbidden security type
- risk bucket exceeds user tolerance
- max drawdown tolerance conflict
- earnings proximity blocked by user setting
- dilution/cash-burn block triggered

## 17. Explainability Layer

Every recommendation must include:

- top positive contributors
- top negative contributors
- risk penalties applied
- portfolio-fit adjustments
- regime adjustments
- confidence penalties
- suggested allocation rationale
- thesis failure conditions
- recommendation change triggers

Suggested explanation schema:

- `summary`
- `topDrivers[]`
- `topPenalties[]`
- `riskBreakdown`
- `portfolioFitBreakdown`
- `regimeContext`
- `scenarioSummary`
- `allocationReasoning`
- `watchPoints[]`
- `dataQualityNotes[]`

UI principles:

- couple numeric decomposition with plain-language explanation
- show uncertainty explicitly
- show what would improve or worsen the recommendation

## 18. Alerts and Daily Workflow

Daily processing:

1. refresh data
2. recompute features and scores
3. compare to prior snapshot
4. generate alerts
5. update dashboard and action lists

Alert triggers:

- score changes beyond threshold
- risk bucket change
- downside widening
- concentration breach
- valuation entering attractive zone
- earnings within restricted window
- fragility spike
- regime shift

Daily operating workflow:

1. read deployment recommendation
2. inspect top opportunities and top warnings
3. review concentration and overlap issues
4. open deep dives on actionable candidates
5. run scenario planner if capital is available
6. log actual decisions and thesis notes

## 19. Backtesting and Validation Framework

Validation requirements:

- historical backtests
- walk-forward testing
- time-based splits only
- regime-specific analysis
- benchmark-relative analysis
- transaction cost and slippage assumptions

Evaluation levels:

- signal-level
  - forward return by feature decile
  - monotonicity checks
  - feature stability
- score-level
  - forward return by composite decile
  - risk-adjusted return by bucket
  - confidence calibration
- action-level
  - hit rate by action
  - average excess return by action
  - drawdown after recommendation
  - turnover and holding period
- portfolio-level
  - growth
  - drawdown
  - Sharpe-like and Sortino-like measures
  - exposure drift

Probability validation:

- Brier score
- calibration curves
- outperformance probability accuracy

Anti-overfitting rules:

- do not optimize solely for maximum return
- prefer economically coherent, stable weights
- require out-of-sample gains to justify complexity
- track sensitivity to weight changes and feature removal

## 20. Priority Build Order

Phase 1:

- typed domain contracts
- deterministic mock point-in-time dataset
- feature engineering and normalization
- regime, score, risk, fit, allocation, action, explainability engines

Phase 2:

- dashboard
- recommendations page
- portfolio page
- deep-dive page
- scenario planner

Phase 3:

- alerts page
- journal / thesis log
- score history
- compare workflow

Phase 4:

- validation and backtesting module
- calibration and score diagnostics

Phase 5:

- live provider adapters
- scheduled refresh pipeline
- persistence and historical store

## 21. Guardrails for Interpretability and Originality

- every feature must have economic meaning
- every weight must live in config, not magic code
- every action must be reproducible from thresholds and rules
- scenario ranges should widen as confidence falls
- store intermediate components for auditability
- keep the engine deterministic before layering AI on top
- make the UI a projection of the engine, not a set of decorative widgets
