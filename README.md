# Investment Command Center

Personal investing command center built as a single-user quantitative operating system. The current implementation is a desktop-first React app with:

- investor profile and portfolio constraints
- deterministic seeded market universe
- explainable opportunity, fragility, timing, risk, and portfolio-fit engines
- allocation and deployment planning
- actionable recommendations with scenario-based return outputs
- dashboard, discovery, deep dive, portfolio, planner, alerts, and journal views

## Start

```bash
npm install
npm run dev
```

Clean local Vite and TypeScript caches before starting dev:

```bash
npm run dev:clean
```

Production build:

```bash
npm run build
```

Refresh the live snapshot and persist a point-in-time dataset:

```bash
npm run data:sync
```

Refresh only the macro/regime snapshot from FRED:

```bash
npm run data:sync:macro
```

Refresh normalized SEC company-facts fundamentals for the tracked research universe:

```bash
npm run data:sync:sec
```

Rebuild the walk-forward validation report from saved point-in-time snapshots:

```bash
npm run validate:model
```

Refresh the Yahoo-verified S&P 500 and Nasdaq symbol directory used for search and portfolio entry:

```bash
npm run data:sync:directory
```

## Structure

- [docs/blueprint.md](/C:/Projects/Cursor/Investment%20Center/docs/blueprint.md): full product and quant architecture blueprint
- `src/data/mockData.ts`: seeded point-in-time user, portfolio, and security universe
- `src/data/liveSnapshot.ts`: generated latest live snapshot used by the app when available
- `src/domain/engine.ts`: scoring, risk, regime, explainability, and allocation engine
- `src/live/yahooPublic.ts`: live provider adapter
- `src/live/fredPublic.ts`: macro/regime data adapter sourced from FRED
- `src/live/secPublic.ts`: SEC company-facts normalization for annual fundamentals
- `scripts/sync-live-data.ts`: snapshot fetch, blend, and persistence pipeline
- `scripts/sync-macro-data.ts`: standalone macro snapshot sync
- `scripts/sync-sec-companyfacts.ts`: standalone SEC fundamentals sync
- `scripts/validate-model.ts`: walk-forward validation report generator
- `scripts/sync-symbol-directory.ts`: Yahoo-verified S&P 500, Nasdaq (stocks + ETFs), and curated major ETFs directory sync
- `src/pages.tsx`: application shell and page projections

## Notes

- The app always has a deterministic seeded fallback dataset, but it now prefers the generated live snapshot when `npm run data:sync` has been run successfully.
- The engine is intentionally non-AI-first. Recommendations come from explicit formulas, rule sets, and portfolio constraints.
- The app uses hash routing so it can run as a static frontend without server-side route configuration.
- Live sync currently uses Yahoo public chart, insights, and fundamentals-timeseries endpoints, then blends those fields into the point-in-time seed dataset when provider coverage is incomplete.
- Live sync now prefers SEC company facts for core annual fundamentals when available, then blends those results into the point-in-time snapshot.
- Macro context now comes from FRED series for rates, curve shape, unemployment, inflation, and high-yield spreads.
- Walk-forward validation is generated from the saved `data/snapshots/*.json` point-in-time history and written to `data/validation/latest.json`.
- Fast live quote refresh now uses Yahoo's `spark` endpoint and falls back symbol-by-symbol when a batch contains an invalid ticker.
- Historical snapshots are persisted to `data/snapshots/` and the latest app-consumed snapshot is written to `src/data/liveSnapshot.ts`.
- Standalone macro and SEC sync outputs are written under `data/macro/` and `data/sec/companyfacts/`.
- The portfolio add flow and Explore lookup both use `public/symbol-directory.json`, a generated directory of S&P 500 constituents, Nasdaq-listed stocks, Nasdaq-listed ETFs, and a curated list of major ETFs/index funds (e.g. VTI, QQQ, SPY) that Yahoo recognizes.
