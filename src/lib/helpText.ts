export const factorHelp: Record<string, string> = {
  growth: 'Revenue and earnings growth potential. Higher = stronger growth trajectory.',
  quality: 'Profitability, balance sheet strength, FCF consistency. Higher = more durable business.',
  value: 'Valuation relative to peers and history. Higher = more attractive valuation.',
  momentum: 'Price and earnings momentum. Higher = stronger near-term trend.',
  defensive: 'Downside protection, low volatility. Higher = more defensive.',
  cyclical: 'Sensitivity to economic cycles. Lower = less cyclical.',
};

export const actionHelp: Record<string, string> = {
  'Buy now': 'Strong opportunity, good fit, deploy capital now.',
  'Buy partial': 'Attractive but size with caution; consider staged entry.',
  'Accumulate slowly': 'Add over time; avoid lump-sum deployment.',
  'Hold': 'Keep position; no action needed.',
  'Watch only': 'Not ready to buy; monitor for better entry.',
  'Avoid': 'Do not add; risk or fit concerns.',
  'Trim': 'Reduce position; concentration or risk too high.',
  'Sell': 'Exit the position; the thesis or risk/reward no longer supports holding it.',
  'Rotate': 'Move capital into a better-fitting replacement or hold cash instead.',
  'De-risk': 'Cut exposure because portfolio or security risk has become too high.',
  'Take profit': 'Harvest part of the gain because upside looks less attractive than before.',
  'Reassess after earnings': 'Wait for earnings before deciding.',
  'High-upside / high-risk only': 'Speculative; only for risk-tolerant capital.',
};

export const validationHelp: Record<string, string> = {
  hitRate: 'Share of snapshot pairs where the higher-scored stock outperformed.',
  avgForwardReturn: 'Average forward return of recommended stocks.',
  turnover: 'How often the system would have traded. Lower = more stable.',
  brierScore: 'Calibration of probability forecasts. Lower = better (0.2 is good).',
  deciles: 'Stocks ranked by score; top decile should outperform bottom.',
};

export const plainLanguageHelp = {
  regime:
    'This is the market mood the model sees right now. It helps decide whether to be more patient, more defensive, or more willing to buy.',
  portfolioFit:
    'Portfolio fit means how well a stock works with what you already own. A good stock can still be a bad fit if it adds too much overlap.',
  fragility:
    'Fragility means how easily the idea could break. Higher fragility usually means more debt, earnings risk, unstable margins, or crash risk.',
  confidence:
    'Confidence is how much the model trusts the recommendation. It falls when the data is stale, incomplete, or internally mixed.',
  expectedReturn:
    'Expected return is the model’s best estimate of a reasonable outcome range, not a promise. Treat it as direction and size of opportunity, not certainty.',
  diversification:
    'Diversification is how spread out your money is. Lower concentration usually means one bad stock or sector hurts you less.',
  freshness:
    'Prices can be live while company data is older. This helps you see whether the recommendation is using fresh prices, older financials, or both.',
  bestMove:
    'This is the plain-English summary of what the app thinks you should do with your money right now.',
  recommendationHistory:
    'This tracks how the system’s calls change over time so you can judge whether it is stable, accountable, and improving.',
} as const;
