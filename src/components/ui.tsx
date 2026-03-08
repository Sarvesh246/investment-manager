import clsx from 'clsx';
import type { PropsWithChildren, ReactNode } from 'react';

export function Panel({
  title,
  eyebrow,
  subtitle,
  action,
  className,
  children,
}: PropsWithChildren<{
  title: string;
  eyebrow?: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}>) {
  return (
    <section className={clsx('panel', className)}>
      <header className="panel__header">
        <div>
          {eyebrow ? <div className="panel__eyebrow">{eyebrow}</div> : null}
          <h2 className="panel__title">{title}</h2>
          {subtitle ? <p className="panel__subtitle">{subtitle}</p> : null}
        </div>
        {action ? <div className="panel__action">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  return (
    <div className={clsx('metric-card', `metric-card--${tone}`)}>
      <div className="metric-card__label">{label}</div>
      <div className="metric-card__value">{value}</div>
      <div className="metric-card__detail">{detail}</div>
    </div>
  );
}

export function PageHeader({
  title,
  summary,
  meta,
}: {
  title: string;
  summary: string;
  meta?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <div className="page-header__eyebrow">Guided Wealth Console</div>
        <h1>{title}</h1>
        <p>{summary}</p>
      </div>
      {meta ? <div className="page-header__meta">{meta}</div> : null}
    </header>
  );
}

export function ScorePill({
  label,
  score,
  tone,
}: {
  label: string;
  score: number | string;
  tone?: 'positive' | 'negative' | 'warning' | 'neutral';
}) {
  const numericScore = typeof score === 'string' ? Number.parseFloat(score) : score;
  const resolvedTone =
    tone ??
    (typeof score === 'string' && score.startsWith('+')
      ? 'positive'
      : typeof score === 'string' && score.startsWith('-')
        ? 'negative'
        : Number.isNaN(numericScore) || typeof numericScore !== 'number'
          ? 'neutral'
          : numericScore >= 70
            ? 'positive'
            : numericScore >= 55
              ? 'warning'
              : 'negative');

  return (
    <div className={clsx('score-pill', `score-pill--${resolvedTone}`)}>
      <span>{label}</span>
      <strong>{typeof score === 'number' ? Math.round(score) : score}</strong>
    </div>
  );
}

export function SignalBar({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  return (
    <div className="signal-bar">
      <div className="signal-bar__label-row">
        <span>{label}</span>
        <strong>{Math.round(value)}</strong>
      </div>
      <div className="signal-bar__track">
        <div
          className={clsx('signal-bar__fill', `signal-bar__fill--${tone}`)}
          style={{ width: `${Math.max(4, Math.min(value, 100))}%` }}
        />
      </div>
    </div>
  );
}

export function Tag({
  children,
  tone = 'neutral',
}: PropsWithChildren<{ tone?: 'positive' | 'negative' | 'warning' | 'neutral' }>) {
  return <span className={clsx('tag', `tag--${tone}`)}>{children}</span>;
}

export function Sparkline({
  values,
  tone = 'positive',
}: {
  values: number[];
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  if (values.length === 0) {
    return null;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const path = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * 100;
      const y = 100 - ((value - min) / range) * 100;
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  return (
    <svg className={clsx('sparkline', `sparkline--${tone}`)} viewBox="0 0 100 100" preserveAspectRatio="none">
      <path d={path} pathLength={100} />
    </svg>
  );
}

export function Table({
  columns,
  rows,
}: {
  columns: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="table-shell">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={`${index}-${cellIndex}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
