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
