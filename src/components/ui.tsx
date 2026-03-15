import clsx from 'clsx';
import { useEffect, useState } from 'react';
import type { PropsWithChildren, ReactNode } from 'react';
import { ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';
import { Tooltip } from './Tooltip';

export function Panel({
  id,
  title,
  eyebrow,
  subtitle,
  action,
  helpText,
  collapsible = false,
  collapsed = false,
  onToggleCollapse,
  pinned = false,
  onTogglePin,
  className,
  children,
}: PropsWithChildren<{
  id?: string;
  title: string;
  eyebrow?: string;
  subtitle?: string;
  action?: ReactNode;
  helpText?: ReactNode;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
  className?: string;
}>) {
  const hasHeaderActions = action || helpText || collapsible || onTogglePin;

  return (
    <section id={id} className={clsx('panel', pinned && 'panel--pinned', className)}>
      <header className="panel__header">
        <div className="panel__header-main">
          {eyebrow ? <div className="panel__eyebrow">{eyebrow}</div> : null}
          <div className="panel__title-row">
            <h2 className="panel__title">{title}</h2>
            {helpText ? (
              <Tooltip content={helpText}>
                <button
                  type="button"
                  className="panel__help"
                  aria-label={`What ${title} means`}
                >
                  <HelpCircle size={14} aria-hidden="true" />
                </button>
              </Tooltip>
            ) : null}
          </div>
          {subtitle ? <p className="panel__subtitle">{subtitle}</p> : null}
        </div>
        {hasHeaderActions ? (
          <div className="panel__action">
            {action}
            {onTogglePin ? (
              <button
                type="button"
                className={clsx('panel__meta-button', pinned && 'panel__meta-button--active')}
                onClick={onTogglePin}
                aria-pressed={pinned}
              >
                {pinned ? 'Pinned' : 'Pin'}
              </button>
            ) : null}
            {collapsible ? (
              <button
                type="button"
                className="panel__meta-button"
                onClick={onToggleCollapse}
                aria-expanded={!collapsed}
              >
                {collapsed ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronUp size={14} aria-hidden="true" />}
                <span>{collapsed ? 'Show' : 'Hide'}</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </header>
      {!collapsed ? children : null}
    </section>
  );
}

/**
 * In-page jump links (e.g. Overview, Next moves, Risk radar, Exposure).
 * Use `compact` + `sticky={false}` on the dashboard so the nav scrolls away and doesn’t block content.
 * Highlights the link for the section currently in view (Intersection Observer).
 */
export function PageJumpNav({
  items,
  compact = false,
  sticky = true,
  wrap = false,
}: {
  items: Array<{ href: string; label: string; detail?: string }>;
  /** Single-line labels, detail as tooltip; less visual weight. */
  compact?: boolean;
  /** If false, nav scrolls with content instead of sticking. */
  sticky?: boolean;
  /** If true, links wrap onto multiple rows instead of horizontal scroll. */
  wrap?: boolean;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;

    const ids = items
      .map((item) => (item.href.startsWith('#') ? item.href.slice(1) : item.href))
      .filter(Boolean);
    if (ids.length === 0) return;

    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el != null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = entry.target.id;
          if (id) setActiveId(id);
        }
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: 0 },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items]);

  function handleJump(href: string) {
    if (typeof document === 'undefined') {
      return;
    }

    const targetId = href.startsWith('#') ? href.slice(1) : href;

    if (!targetId) {
      return;
    }

    const target = document.getElementById(targetId);
    if (!target) {
      return;
    }

    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <nav
      className={clsx(
        'page-jump-nav',
        compact && 'page-jump-nav--compact',
        !sticky && 'page-jump-nav--scroll',
        wrap && 'page-jump-nav--wrap',
      )}
      aria-label="Jump to section"
    >
      {items.map((item) => {
        const targetId = item.href.startsWith('#') ? item.href.slice(1) : item.href;
        const isActive = targetId && activeId === targetId;
        return (
          <button
            key={item.href}
            type="button"
            className={clsx('page-jump-nav__link', isActive && 'page-jump-nav__link--active')}
            onClick={() => handleJump(item.href)}
            title={compact && item.detail ? item.detail : undefined}
            aria-current={isActive ? 'true' : undefined}
          >
            <strong>{item.label}</strong>
            {!compact && item.detail ? <span>{item.detail}</span> : null}
          </button>
        );
      })}
    </nav>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  tone = 'neutral',
  tooltip,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'positive' | 'negative' | 'neutral';
  tooltip?: string;
}) {
  return (
    <div className={clsx('metric-card', `metric-card--${tone}`)}>
      <div className="metric-card__label">
        {label}
        {tooltip ? (
          <Tooltip content={tooltip}>
            <span className="metric-card__help" tabIndex={0} aria-label={`Help for ${label}`}>
              <HelpCircle size={12} aria-hidden="true" />
            </span>
          </Tooltip>
        ) : null}
      </div>
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
        <div className="page-header__eyebrow">Atlas Capital Center</div>
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
  title,
}: {
  label: string;
  score: number | string;
  tone?: 'positive' | 'negative' | 'warning' | 'neutral';
  /** Optional tooltip (e.g. to explain why a value is often 30+ days). */
  title?: string;
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
    <div className={clsx('score-pill', `score-pill--${resolvedTone}`)} title={title}>
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
  tooltip,
}: PropsWithChildren<{
  tone?: 'positive' | 'negative' | 'warning' | 'neutral';
  tooltip?: string;
}>) {
  const content = <span className={clsx('tag', `tag--${tone}`)}>{children}</span>;
  return tooltip ? (
    <Tooltip content={tooltip}>{content}</Tooltip>
  ) : (
    content
  );
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
  numericColumnIndices,
  sortColumnIndex,
  sortDirection,
}: {
  columns: string[];
  rows: ReactNode[][];
  /** Zero-based indices of columns that should be right-aligned (e.g. numbers). */
  numericColumnIndices?: number[];
  /** Zero-based index of the column that is currently sorted. */
  sortColumnIndex?: number;
  sortDirection?: 'asc' | 'desc';
}) {
  return (
    <div className="table-shell">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column, i) => (
              <th key={column}>
                {column}
                {sortColumnIndex === i && sortDirection != null ? (
                  <span className="data-table__sort-icon" aria-hidden>
                    {sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </span>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td
                  key={`${index}-${cellIndex}`}
                  className={numericColumnIndices?.includes(cellIndex) ? 'data-table__cell--num' : undefined}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
