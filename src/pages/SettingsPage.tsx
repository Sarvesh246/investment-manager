import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { BarChart3, ChevronDown, ChevronUp, ClipboardCheck, List, Plus, Trash2 } from 'lucide-react';
import {
  Panel,
  MetricCard,
  PageHeader,
  PageJumpNav,
  ScorePill,
  Table,
  Tag,
} from './../components/ui';
import { downloadBlob } from './../lib/exportPortfolio';
import {
  formatClockTime,
  formatCurrency,
  formatPercent,
  formatReturn,
} from './../lib/format';
import { normalizeSymbol } from './../lib/symbols';
import { validationHelp } from './../lib/helpText';
import {
  freshnessText,
  formatStrategyLabel,
  sourceModeLabel,
  strategyWeightFields,
  strategyWeightPercentages,
  themeOptions,
  toneForFreshness,
} from './shared';
import { usePortfolioWorkspace } from './../runtime/portfolioContext';
import { useToast } from './../runtime/toastContext';
import { summarizeRecommendationHistory } from './../domain/recommendationHistory';

function AddSymbolToWatchlistForm({
  watchlistId,
  onAdd,
}: {
  watchlistId: string;
  onAdd: (id: string, symbol: string) => void;
}) {
  const [symbol, setSymbol] = useState('');
  return (
    <form
      className="watchlist-add-symbol"
      onSubmit={(e) => {
        e.preventDefault();
        const s = normalizeSymbol(symbol);
        if (s) {
          onAdd(watchlistId, s);
          setSymbol('');
        }
      }}
    >
      <input
        type="text"
        value={symbol}
        onChange={(e) => setSymbol(e.target.value.toUpperCase())}
        placeholder="Add symbol"
      />
      <button type="submit" className="pill-button" disabled={!symbol.trim()}>
        Add
      </button>
    </form>
  );
}

export function SettingsPage() {
  const {
    dataset,
    model,
    userSettings,
    updateUserSettings,
    resetUserSettings,
    theme,
    setTheme,
    watchlists,
    addWatchlist,
    updateWatchlist,
    removeWatchlist,
    addSymbolToWatchlist,
    removeSymbolFromWatchlist,
    recommendationHistory,
  } = usePortfolioWorkspace();
  const { addToast } = useToast();
  const [newWatchlistName, setNewWatchlistName] = useState('');
  const [expandedWatchlistId, setExpandedWatchlistId] = useState<string | null>(null);

  const THEME_SECTION_KEY = 'ic-settings-theme-expanded';
  const [themeSectionExpanded, setThemeSectionExpanded] = useState(() => {
    try {
      const stored = localStorage.getItem(THEME_SECTION_KEY);
      return stored !== 'false';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(THEME_SECTION_KEY, String(themeSectionExpanded));
    } catch {
      /* ignore */
    }
  }, [themeSectionExpanded]);
  const validationReport = dataset.validationReport;
  const macroSnapshot = dataset.macroSnapshot;
  const recommendationHistorySummary = summarizeRecommendationHistory(recommendationHistory);
  const averageDataQuality =
    model.scorecards.length > 0
      ? model.scorecards.reduce((sum, card) => sum + card.dataQualityScore, 0) / model.scorecards.length
      : 0;
  const weakestCoverage =
    [...model.scorecards].sort((left, right) => left.dataQualityScore - right.dataQualityScore)[0];

  return (
    <div className="page">
      <PageHeader
        title="Settings"
        summary="Change the portfolio rules, allocation guardrails, and app theme. These settings update the engine immediately."
        meta={
          <>
            <ScorePill
              label="Active theme"
              score={themeOptions.find((option) => option.id === theme)?.label ?? theme}
            />
            <ScorePill label="Reserve now" score={formatCurrency(model.deploymentPlan.holdBack)} />
          </>
        }
      />

      <PageJumpNav
        wrap
        items={[
          { href: '#settings-profile', label: 'Profile', detail: 'Risk and horizon' },
          { href: '#settings-guardrails', label: 'Limits', detail: 'Reserve and caps' },
          { href: '#settings-filters', label: 'Filters', detail: 'Behavior rules' },
          { href: '#settings-strategy', label: 'Strategy', detail: 'Style mix' },
          { href: '#settings-data', label: 'Data', detail: 'Freshness and sources' },
          { href: '#settings-macro', label: 'Macro', detail: 'Rates and spreads' },
          { href: '#settings-validation', label: 'Model health', detail: 'Walk-forward report' },
          { href: '#settings-theme', label: 'Theme', detail: 'Color system' },
          { href: '#settings-watchlists', label: 'Watchlists', detail: 'Manage lists' },
        ]}
      />

      <Panel
        id="settings-theme"
        title="Theme"
        eyebrow="Appearance"
        subtitle={
          themeSectionExpanded
            ? 'Choose an accent color for the app. This only affects the shell; the engine is unchanged.'
            : `Current: ${themeOptions.find((o) => o.id === theme)?.label ?? theme}. Click to show options.`
        }
        action={
          <button
            type="button"
            className="panel-collapse-toggle"
            onClick={() => setThemeSectionExpanded((e) => !e)}
            aria-expanded={themeSectionExpanded}
            aria-label={themeSectionExpanded ? 'Hide theme options' : 'Show theme options'}
          >
            {themeSectionExpanded ? (
              <>
                <ChevronUp size={18} aria-hidden />
                Hide
              </>
            ) : (
              <>
                <ChevronDown size={18} aria-hidden />
                Show options
              </>
            )}
          </button>
        }
      >
        {themeSectionExpanded ? (
          <div className="theme-grid">
            {themeOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={
                  option.id === theme
                    ? 'theme-option theme-option--active'
                    : 'theme-option'
                }
                onClick={() => setTheme(option.id)}
                aria-pressed={option.id === theme}
                aria-label={`Switch to ${option.label} theme`}
              >
                <span
                  className="theme-option__swatch"
                  style={{ '--theme-accent': option.accent } as CSSProperties}
                />
                <strong>{option.label}</strong>
                <span className="theme-option__note">{option.note}</span>
              </button>
            ))}
          </div>
        ) : null}
      </Panel>

      <div className="two-column-layout">
        <Panel
          id="settings-profile"
          title="Profile Controls"
          eyebrow="Risk And Horizon"
          subtitle="These settings change how aggressive the planner and ranking engine are."
        >
          <div className="filters">
            <label>
              Risk style
              <select
                className="filter-select"
                value={userSettings.riskTolerance}
                onChange={(event) =>
                  updateUserSettings({
                    riskTolerance: event.target.value as typeof userSettings.riskTolerance,
                  })
                }
              >
                <option value="low">Low</option>
                <option value="moderate">Moderate</option>
                <option value="moderate-aggressive">Moderate-aggressive</option>
                <option value="aggressive">Aggressive</option>
              </select>
            </label>
            <label>
              Time horizon (months)
              <input
                type="number"
                min={1}
                max={360}
                value={userSettings.timeHorizonMonths}
                onChange={(event) =>
                  updateUserSettings({
                    timeHorizonMonths: Number(event.target.value) || userSettings.timeHorizonMonths,
                  })
                }
              />
            </label>
            <label>
              Monthly contribution
              <input
                type="number"
                min={0}
                step={50}
                value={userSettings.monthlyContribution}
                onChange={(event) =>
                  updateUserSettings({
                    monthlyContribution: Number(event.target.value) || 0,
                  })
                }
              />
            </label>
            <label>
              Holding period (days)
              <input
                type="number"
                min={1}
                max={3650}
                value={userSettings.preferredHoldingPeriodDays}
                onChange={(event) =>
                  updateUserSettings({
                    preferredHoldingPeriodDays:
                      Number(event.target.value) || userSettings.preferredHoldingPeriodDays,
                  })
                }
              />
            </label>
            <label>
              Benchmark symbol
              <input
                type="text"
                value={userSettings.benchmarkSymbol}
                onChange={(event) =>
                  updateUserSettings({
                    benchmarkSymbol: normalizeSymbol(event.target.value) || event.target.value.toUpperCase(),
                  })
                }
              />
              <span className="field-help">
                Used as the comparison label throughout the app.
              </span>
            </label>
          </div>
        </Panel>

        <Panel
          id="settings-guardrails"
          title="Allocation Guardrails"
          eyebrow="Caps And Reserve"
          subtitle="These limits directly affect sizing, deployment, trim flags, and diversification checks."
        >
          <div className="filters">
            <label>
              Target cash reserve
              <input
                type="number"
                min={0}
                step={100}
                value={userSettings.targetCashReserve}
                onChange={(event) =>
                  updateUserSettings({
                    targetCashReserve: Number(event.target.value) || 0,
                  })
                }
              />
            </label>
            <label>
              Max single position %
              <input
                type="number"
                min={1}
                max={100}
                step={1}
                value={Math.round(userSettings.maxSinglePositionWeight * 100)}
                onChange={(event) =>
                  updateUserSettings({
                    maxSinglePositionWeight: (Number(event.target.value) || 0) / 100,
                  })
                }
              />
            </label>
            <label>
              Max sector %
              <input
                type="number"
                min={1}
                max={100}
                step={1}
                value={Math.round(userSettings.maxSectorWeight * 100)}
                onChange={(event) =>
                  updateUserSettings({
                    maxSectorWeight: (Number(event.target.value) || 0) / 100,
                  })
                }
              />
            </label>
            <label>
              Max drawdown tolerance %
              <input
                type="number"
                min={1}
                max={100}
                step={1}
                value={Math.round(userSettings.maxPortfolioDrawdownTolerance * 100)}
                onChange={(event) =>
                  updateUserSettings({
                    maxPortfolioDrawdownTolerance: (Number(event.target.value) || 0) / 100,
                  })
                }
              />
            </label>
          </div>

          <div className="settings-note">
            <strong>Live preview</strong>
            <p>
              The engine currently wants to deploy {formatCurrency(model.deploymentPlan.deployNow)} and
              hold back {formatCurrency(model.deploymentPlan.holdBack)} under these settings.
            </p>
          </div>
        </Panel>
      </div>

      <div className="dashboard-grid">
        <Panel
          id="settings-filters"
          title="Behavior Filters"
          eyebrow="Risk Filters"
          subtitle="These switches change which setups get penalized or deferred."
        >
          <div className="toggle-list">
            <label className="toggle-row">
              <div>
                <strong>Avoid earnings-event risk</strong>
                <span>Penalize setups that sit too close to earnings.</span>
              </div>
              <input
                type="checkbox"
                checked={userSettings.avoidEarningsRisk}
                onChange={(event) =>
                  updateUserSettings({
                    avoidEarningsRisk: event.target.checked,
                  })
                }
              />
            </label>
            <label className="toggle-row">
              <div>
                <strong>Avoid dilution-prone companies</strong>
                <span>Push capital away from repeat equity issuers.</span>
              </div>
              <input
                type="checkbox"
                checked={userSettings.avoidDilutionProne}
                onChange={(event) =>
                  updateUserSettings({
                    avoidDilutionProne: event.target.checked,
                  })
                }
              />
            </label>
            <label className="toggle-row">
              <div>
                <strong>Avoid cash burners</strong>
                <span>Penalize weak free-cash-flow stories more heavily.</span>
              </div>
              <input
                type="checkbox"
                checked={userSettings.avoidCashBurners}
                onChange={(event) =>
                  updateUserSettings({
                    avoidCashBurners: event.target.checked,
                  })
                }
              />
            </label>
          </div>
        </Panel>

        <Panel
          id="settings-data"
          title="Data Stack"
          eyebrow="Freshness And Integrity"
          subtitle="This shows how current and trustworthy the underlying dataset is before you rely on any recommendation."
        >
          <div className="kpi-grid kpi-grid--tight">
            <MetricCard
              label="Mode"
              value={sourceModeLabel(dataset.dataMode === 'live' ? 'live' : dataset.dataMode === 'blended' ? 'blended' : 'seeded')}
              detail={dataset.providerSummary ?? 'Seeded research snapshot'}
              tone="neutral"
            />
            <MetricCard
              label="Average data quality"
              value={`${Math.round(averageDataQuality)}/100`}
              detail={weakestCoverage ? `Weakest coverage: ${weakestCoverage.symbol}` : 'No securities loaded'}
              tone={averageDataQuality >= 75 ? 'positive' : averageDataQuality >= 55 ? 'neutral' : 'negative'}
            />
            <MetricCard
              label="Snapshot as of"
              value={dataset.asOf}
              detail={dataset.snapshotGeneratedAt ? `Generated ${formatClockTime(dataset.snapshotGeneratedAt)}` : 'No generated timestamp'}
              tone="neutral"
            />
            <MetricCard
              label="Ledger"
              value={model.ledgerSummary.transactionCount > 0 ? 'Active' : 'Baseline'}
              detail={
                model.ledgerSummary.transactionCount > 0
                  ? `${model.ledgerSummary.transactionCount} event${model.ledgerSummary.transactionCount === 1 ? '' : 's'} recorded`
                  : 'Manual holdings and cash are the current baseline'
              }
              tone={model.ledgerSummary.transactionCount > 0 ? 'positive' : 'neutral'}
            />
          </div>
          <ul className="bullet-list">
            {(dataset.syncNotes ?? []).slice(0, 6).map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <div className="summary-list summary-list--compact">
            {Object.values(model.freshnessHierarchy).map((item) => (
              <div key={item.label} className="summary-list__item">
                <div>
                  <strong>{item.label}</strong>
                  <p className="summary-list__note">{item.note}</p>
                </div>
                <Tag tone={toneForFreshness(item.status)}>
                  {freshnessText(item.ageDays, item.status)}
                </Tag>
              </div>
            ))}
          </div>
          <div className="settings-data-export">
            <p className="summary-list__note">
              Recommendation history: {recommendationHistory.length} run{recommendationHistory.length === 1 ? '' : 's'} persisted for audit and calibration.
              {recommendationHistory.length > 0
                ? ` Last run: ${new Date(recommendationHistory[recommendationHistory.length - 1].runAt).toLocaleString()}.`
                : ''}
              Export to compare with forward outcomes for calibration.
            </p>
            {recommendationHistory.length > 0 ? (
              <div className="kpi-grid kpi-grid--tight">
                <MetricCard
                  label="Resolved 1W"
                  value={String(recommendationHistorySummary.horizonCoverage.find((item) => item.horizon === '1W')?.resolved ?? 0)}
                  detail="Forward outcomes available"
                  tone="neutral"
                />
                <MetricCard
                  label="Resolved 1M"
                  value={String(recommendationHistorySummary.horizonCoverage.find((item) => item.horizon === '1M')?.resolved ?? 0)}
                  detail="Forward outcomes available"
                  tone="neutral"
                />
                <MetricCard
                  label="Resolved 3M"
                  value={String(recommendationHistorySummary.horizonCoverage.find((item) => item.horizon === '3M')?.resolved ?? 0)}
                  detail="Forward outcomes available"
                  tone="neutral"
                />
                <MetricCard
                  label="Tracked actions"
                  value={String(recommendationHistorySummary.actionAccuracy.length)}
                  detail="Actions with at least one resolved outcome"
                  tone="neutral"
                />
              </div>
            ) : null}
            {recommendationHistory.length > 0 ? (
              <div className="settings-history-recent">
                <strong>Recent runs</strong>
                <ul className="settings-history-recent__list">
                  {[...recommendationHistory]
                    .reverse()
                    .slice(0, 5)
                    .map((run, i) => (
                      <li key={`${run.runAt}-${i}`} className="settings-history-recent__item">
                        <span>{new Date(run.runAt).toLocaleDateString()}</span>
                        <span>{run.regimeKey}</span>
                        <span>{run.records.length} ideas</span>
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
            {recommendationHistorySummary.actionAccuracy.length > 0 ? (
              <Table
                columns={['Action', 'Count', 'Hit Rate', 'Avg Return']}
                rows={recommendationHistorySummary.actionAccuracy.map((item) => [
                  <span key={`${item.action}-action`}>{item.action}</span>,
                  <span key={`${item.action}-count`}>{item.count}</span>,
                  <span key={`${item.action}-hit`}>{formatPercent(item.hitRate * 100)}</span>,
                  <span key={`${item.action}-return`}>{formatReturn(item.averageForwardReturn)}</span>,
                ])}
              />
            ) : null}
            <button
              type="button"
              className="action-button"
              onClick={() => {
                const blob = new Blob(
                  [JSON.stringify(recommendationHistory, null, 2)],
                  { type: 'application/json' },
                );
                downloadBlob(blob, `recommendation-history-${new Date().toISOString().slice(0, 10)}.json`);
                addToast('Recommendation history exported', 'success');
              }}
              disabled={recommendationHistory.length === 0}
            >
              Export recommendation history
            </button>
          </div>
        </Panel>

        <Panel
          id="settings-macro"
          title="Macro Context"
          eyebrow="Rates And Credit"
          subtitle="Macro inputs do not pick stocks for you, but they should influence how much fragility and concentration you tolerate."
        >
          {macroSnapshot ? (
            <>
              <div className="kpi-grid kpi-grid--tight">
                <MetricCard
                  label="2Y Treasury"
                  value={macroSnapshot.yield2y != null ? `${macroSnapshot.yield2y.toFixed(2)}%` : 'N/A'}
                  detail={`As of ${macroSnapshot.asOf}`}
                  tone="neutral"
                />
                <MetricCard
                  label="10Y Treasury"
                  value={macroSnapshot.yield10y != null ? `${macroSnapshot.yield10y.toFixed(2)}%` : 'N/A'}
                  detail={macroSnapshot.curve2s10s != null ? `2s10s ${macroSnapshot.curve2s10s.toFixed(2)} pts` : 'Curve unavailable'}
                  tone={macroSnapshot.curve2s10s != null && macroSnapshot.curve2s10s < 0 ? 'negative' : 'positive'}
                />
                <MetricCard
                  label="High-yield spread"
                  value={macroSnapshot.highYieldSpread != null ? `${macroSnapshot.highYieldSpread.toFixed(2)}%` : 'N/A'}
                  detail={macroSnapshot.unemploymentRate != null ? `Unemployment ${macroSnapshot.unemploymentRate.toFixed(1)}%` : 'Unemployment unavailable'}
                  tone={macroSnapshot.highYieldSpread != null && macroSnapshot.highYieldSpread >= 5 ? 'negative' : 'neutral'}
                />
                <MetricCard
                  label="Macro risk tone"
                  value={`${Math.round(macroSnapshot.riskTone * 100)}/100`}
                  detail={macroSnapshot.inflationYoY != null ? `Inflation ${macroSnapshot.inflationYoY.toFixed(1)}% YoY` : 'Inflation unavailable'}
                  tone={macroSnapshot.riskTone >= 0.6 ? 'positive' : macroSnapshot.riskTone >= 0.45 ? 'neutral' : 'negative'}
                />
              </div>
              <div className="settings-note">
                <strong>Current read</strong>
                <p>{macroSnapshot.narrative}</p>
              </div>
            </>
          ) : (
            <div className="empty-state empty-state--compact">
              <div className="empty-state__icon" aria-hidden="true">
                <BarChart3 size={36} strokeWidth={1.25} />
              </div>
              <h2>No macro snapshot loaded.</h2>
              <p>Run the macro sync or a full live sync to add rates, inflation, unemployment, and credit context.</p>
            </div>
          )}
        </Panel>
      </div>

      <Panel
        id="settings-strategy"
        title="Strategy Mix"
        eyebrow="Style Weights"
        subtitle="These weights drive the profile description and define what kind of opportunity mix you want the app to prioritize over time."
      >
        <div className="tag-row">
          {dataset.user.targetStrategy.map((style) => (
            <Tag key={style} tone="positive">
              {formatStrategyLabel(style)}
            </Tag>
          ))}
        </div>
        <div className="range-stack">
          {strategyWeightFields.map((field) => {
            const weightMap = strategyWeightPercentages(userSettings.strategyWeights);
            const value = weightMap[field.key];

            return (
              <label key={field.key} className="range-row">
                <div className="range-row__label">
                  <strong>{field.label}</strong>
                  <span>{value}%</span>
                </div>
                <div className="range-row__control">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={value}
                    onChange={(event) =>
                      updateUserSettings((current) => ({
                        ...current,
                        strategyWeights: {
                          ...strategyWeightPercentages(current.strategyWeights),
                          [field.key]: Number(event.target.value),
                        } as typeof current.strategyWeights,
                      }))
                    }
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={value}
                    onChange={(event) =>
                      updateUserSettings((current) => ({
                        ...current,
                        strategyWeights: {
                          ...strategyWeightPercentages(current.strategyWeights),
                          [field.key]: Number(event.target.value) || 0,
                        } as typeof current.strategyWeights,
                      }))
                    }
                  />
                </div>
              </label>
            );
          })}
        </div>
      </Panel>

      <Panel
        id="settings-validation"
        title="Walk-forward Validation"
        eyebrow="Model Health"
        subtitle="This keeps the engine honest by measuring what high scores actually did in the next available point-in-time snapshot."
      >
        {validationReport ? (
          <>
            <div className="kpi-grid kpi-grid--tight">
              <MetricCard
                label="Hit rate"
                value={formatPercent(validationReport.hitRate * 100)}
                detail={`${validationReport.pairCount} snapshot pair${validationReport.pairCount === 1 ? '' : 's'}`}
                tone={validationReport.hitRate >= 0.55 ? 'positive' : validationReport.hitRate >= 0.48 ? 'neutral' : 'negative'}
                tooltip={validationHelp.hitRate}
              />
              <MetricCard
                label="Avg forward return"
                value={formatReturn(validationReport.averageForwardReturn)}
                detail={`Excess ${formatReturn(validationReport.averageBenchmarkRelativeReturn)}`}
                tone={validationReport.averageForwardReturn >= 0 ? 'positive' : 'negative'}
                tooltip={validationHelp.avgForwardReturn}
              />
              <MetricCard
                label="Turnover"
                value={formatPercent(validationReport.averageTurnover * 100)}
                detail="Lower is steadier"
                tone={validationReport.averageTurnover <= 0.35 ? 'positive' : 'neutral'}
                tooltip={validationHelp.turnover}
              />
              <MetricCard
                label="Brier score"
                value={validationReport.brierScore.toFixed(3)}
                detail="Lower means better probability calibration"
                tone={validationReport.brierScore <= 0.2 ? 'positive' : validationReport.brierScore <= 0.28 ? 'neutral' : 'negative'}
                tooltip={validationHelp.brierScore}
              />
            </div>

            <div className="dashboard-grid dashboard-grid--dense">
              <Panel
                title="Forward Return By Score Decile"
                eyebrow="Deciles"
                subtitle="High-decile ideas should earn better future returns than low-decile ideas. If they do not, the ranking is not useful."
              >
                <Table
                  columns={['Decile', 'Count', 'Avg Return', 'Excess', 'Hit Rate']}
                  rows={validationReport.scoreDeciles.map((bucket) => [
                    <span key={`${bucket.decile}-d`}>{bucket.decile}</span>,
                    <span key={`${bucket.decile}-c`}>{bucket.count}</span>,
                    <span key={`${bucket.decile}-r`}>{formatReturn(bucket.avgForwardReturn)}</span>,
                    <span key={`${bucket.decile}-e`}>{formatReturn(bucket.avgBenchmarkRelativeReturn)}</span>,
                    <span key={`${bucket.decile}-h`}>{formatPercent(bucket.hitRate * 100)}</span>,
                  ])}
                />
              </Panel>

              <Panel
                title="Probability Calibration"
                eyebrow="Calibration"
                subtitle="Predicted probability of going up should match realized outcomes over time."
              >
                <Table
                  columns={['Bucket', 'Count', 'Predicted', 'Realized', 'Brier']}
                  rows={validationReport.calibration.map((bucket) => [
                    <span key={`${bucket.bucket}-b`}>{bucket.bucket}</span>,
                    <span key={`${bucket.bucket}-c`}>{bucket.count}</span>,
                    <span key={`${bucket.bucket}-p`}>{formatPercent(bucket.predicted * 100)}</span>,
                    <span key={`${bucket.bucket}-r`}>{formatPercent(bucket.realized * 100)}</span>,
                    <span key={`${bucket.bucket}-br`}>{bucket.brier.toFixed(3)}</span>,
                  ])}
                />
              </Panel>
            </div>

            {validationReport.regimes.length > 0 ? (
              <Panel
                title="Regime Breakdown"
                eyebrow="By Environment"
                subtitle="Factor logic should not work equally well in all market conditions. This table helps you see where it holds up or weakens."
              >
                <Table
                  columns={['Regime', 'Count', 'Avg Return', 'Hit Rate']}
                  rows={validationReport.regimes.map((item) => [
                    <span key={`${item.regime}-name`}>{item.regime}</span>,
                    <span key={`${item.regime}-count`}>{item.count}</span>,
                    <span key={`${item.regime}-return`}>{formatReturn(item.avgForwardReturn)}</span>,
                    <span key={`${item.regime}-hit`}>{formatPercent(item.hitRate * 100)}</span>,
                  ])}
                />
              </Panel>
            ) : null}

            {validationReport.actions && validationReport.actions.length > 0 ? (
              <Panel
                title="Action Label Performance"
                eyebrow="By Action"
                subtitle="This checks whether buy, avoid, and exit labels actually separate outcomes in realized history."
              >
                <Table
                  columns={['Action', 'Count', 'Avg Return', 'Excess', 'Hit Rate']}
                  rows={validationReport.actions.map((item) => [
                    <span key={`${item.action}-name`}>{item.action}</span>,
                    <span key={`${item.action}-count`}>{item.count}</span>,
                    <span key={`${item.action}-return`}>{formatReturn(item.avgForwardReturn)}</span>,
                    <span key={`${item.action}-excess`}>{formatReturn(item.avgBenchmarkRelativeReturn)}</span>,
                    <span key={`${item.action}-hit`}>{formatPercent(item.hitRate * 100)}</span>,
                  ])}
                />
              </Panel>
            ) : null}

            {validationReport.confidenceBands && validationReport.confidenceBands.length > 0 ? (
              <Panel
                title="Confidence Calibration"
                eyebrow="By Confidence Band"
                subtitle="High-confidence labels should earn higher realized win rates than medium- or low-confidence labels."
              >
                <Table
                  columns={['Band', 'Count', 'Predicted', 'Realized', 'Avg Return', 'Brier']}
                  rows={validationReport.confidenceBands.map((item) => [
                    <span key={`${item.band}-name`}>{item.band}</span>,
                    <span key={`${item.band}-count`}>{item.count}</span>,
                    <span key={`${item.band}-predicted`}>{formatPercent(item.predicted * 100)}</span>,
                    <span key={`${item.band}-realized`}>{formatPercent(item.realized * 100)}</span>,
                    <span key={`${item.band}-return`}>{formatReturn(item.avgForwardReturn)}</span>,
                    <span key={`${item.band}-brier`}>{item.brier.toFixed(3)}</span>,
                  ])}
                />
              </Panel>
            ) : null}

            {validationReport.sectors && validationReport.sectors.length > 0 ? (
              <Panel
                title="Sector Breakdown"
                eyebrow="By Sector"
                subtitle="Use this to see where the model holds up better or worse across the opportunity set."
              >
                <Table
                  columns={['Sector', 'Count', 'Avg Return', 'Excess', 'Hit Rate']}
                  rows={validationReport.sectors.map((item) => [
                    <span key={`${item.sector}-name`}>{item.sector}</span>,
                    <span key={`${item.sector}-count`}>{item.count}</span>,
                    <span key={`${item.sector}-return`}>{formatReturn(item.avgForwardReturn)}</span>,
                    <span key={`${item.sector}-excess`}>{formatReturn(item.avgBenchmarkRelativeReturn)}</span>,
                    <span key={`${item.sector}-hit`}>{formatPercent(item.hitRate * 100)}</span>,
                  ])}
                />
              </Panel>
            ) : null}

            <ul className="bullet-list">
              {validationReport.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </>
        ) : (
          <div className="empty-state empty-state--compact">
            <div className="empty-state__icon" aria-hidden="true">
              <ClipboardCheck size={36} strokeWidth={1.25} />
            </div>
            <h2>No validation report available yet.</h2>
            <p>Run a full live sync or the validation script once you have point-in-time snapshots on disk.</p>
          </div>
        )}
      </Panel>

      <Panel
        id="settings-watchlists"
        title="Watchlists"
        eyebrow="Manage Lists"
        subtitle="Create watchlists, add symbols, and track ideas. Use Save to watchlist from Discovery or Stock pages."
      >
        <div className="filters filters--stacked">
          <div className="watchlist-create">
            <input
              type="text"
              value={newWatchlistName}
              onChange={(e) => setNewWatchlistName(e.target.value)}
              placeholder="New watchlist name"
            />
            <button
              type="button"
              className="action-button"
              onClick={() => {
                setNewWatchlistName('');
                addWatchlist({ name: newWatchlistName.trim(), symbols: [], notes: '' });
              }}
              disabled={!newWatchlistName.trim()}
            >
              <Plus size={16} />
              Create
            </button>
          </div>
        </div>
        {watchlists.length === 0 ? (
          <div className="empty-state empty-state--compact">
            <div className="empty-state__icon" aria-hidden="true">
              <List size={36} strokeWidth={1.25} />
            </div>
            <h2>No watchlists yet</h2>
            <p>Create a watchlist above, or add symbols from Discovery and Stock pages using Save to watchlist.</p>
          </div>
        ) : (
          <div className="watchlist-manage-list">
            {watchlists.map((wl) => (
              <div key={wl.id} className="watchlist-manage-item">
                <div className="watchlist-manage-header">
                  <button
                    type="button"
                    className="watchlist-manage-toggle"
                    onClick={() =>
                      setExpandedWatchlistId((id) => (id === wl.id ? null : wl.id))
                    }
                  >
                    {expandedWatchlistId === wl.id ? 'v' : '>'} {wl.name}
                    {wl.symbols.length > 0 ? ` (${wl.symbols.length})` : ''}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => {
                      if (window.confirm(`Delete watchlist "${wl.name}"?`)) {
                        removeWatchlist(wl.id);
                      }
                    }}
                    aria-label="Delete watchlist"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                {expandedWatchlistId === wl.id ? (
                  <div className="watchlist-manage-body">
                    <label>
                      Name
                      <input
                        type="text"
                        value={wl.name}
                        onChange={(e) => updateWatchlist(wl.id, { name: e.target.value })}
                        placeholder="Watchlist name"
                      />
                    </label>
                    <label>
                      Notes
                      <input
                        type="text"
                        value={wl.notes}
                        onChange={(e) => updateWatchlist(wl.id, { notes: e.target.value })}
                        placeholder="Optional notes"
                      />
                    </label>
                    <div className="watchlist-symbols">
                      {wl.symbols.map((s) => (
                        <span key={s} className="watchlist-symbol-tag">
                          {s}
                          <button
                            type="button"
                            className="watchlist-symbol-remove"
                            onClick={() => removeSymbolFromWatchlist(wl.id, s)}
                            aria-label={`Remove ${s}`}
                          >
                            x
                          </button>
                        </span>
                      ))}
                      <AddSymbolToWatchlistForm
                        watchlistId={wl.id}
                        onAdd={addSymbolToWatchlist}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="Actions"
        eyebrow="Controls"
        subtitle="Use this when you want to revert to the default model profile or reset the look."
      >
        <div className="summary-card__actions">
          <button type="button" className="action-button" onClick={() => resetUserSettings()}>
            Reset settings
          </button>
          <button type="button" className="pill-button" onClick={() => setTheme('emerald')}>
            Reset theme
          </button>
        </div>
      </Panel>
    </div>
  );
}
