import { useCallback, useRef, useState } from 'react';
import clsx from 'clsx';
import { formatCurrency } from '../lib/format';

function formatTimestamp(ts: string) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    hour: date.getHours() !== 0 || date.getMinutes() !== 0 ? 'numeric' : undefined,
    minute: date.getMinutes() !== 0 ? '2-digit' : undefined,
  }).format(date);
}

interface HoverableChartProps {
  values: number[];
  timestamps?: string[];
  tone?: 'positive' | 'negative' | 'neutral';
  formatValue?: (value: number) => string;
  className?: string;
}

export function HoverableChart({
  values,
  timestamps,
  tone = 'positive',
  formatValue = formatCurrency,
  className,
}: HoverableChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container || values.length === 0) return;

      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percent = (x / rect.width) * 100;
      const index = Math.round((percent / 100) * (values.length - 1));
      const clampedIndex = Math.max(0, Math.min(index, values.length - 1));

      setHoveredIndex(clampedIndex);
    },
    [values.length],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredIndex(null);
  }, []);

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

  const hoveredValue = hoveredIndex !== null ? values[hoveredIndex] : null;
  const hoveredTimestamp =
    hoveredIndex !== null && timestamps?.[hoveredIndex] ? timestamps[hoveredIndex] : null;
  const hoveredX =
    hoveredIndex !== null ? (hoveredIndex / Math.max(values.length - 1, 1)) * 100 : null;
  const dotYPercent =
    hoveredIndex !== null && hoveredValue !== null
      ? 100 - ((hoveredValue - min) / range) * 100
      : 50;
  const tooltipAbove = dotYPercent > 28;

  return (
    <div
      ref={containerRef}
      className={clsx('hoverable-chart', className)}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <svg
        className={clsx('hoverable-chart__svg', `hoverable-chart--${tone}`)}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <path d={path} className="hoverable-chart__line" />
      </svg>
      {hoveredX !== null && hoveredValue !== null && (
        <>
          <div
            className="hoverable-chart__crosshair"
            style={{ left: `${hoveredX}%` }}
          />
          <div
            className={clsx('hoverable-chart__marker', `hoverable-chart__marker--${tone}`)}
            style={{
              left: `${hoveredX}%`,
              top: `${dotYPercent}%`,
            }}
          >
            <div className="hoverable-chart__dot-halo" />
            <div className="hoverable-chart__dot" />
          </div>
        </>
      )}
      {hoveredIndex !== null && hoveredValue !== null && hoveredX !== null && (
        <div
          className="hoverable-chart__tooltip"
          style={{
            left: `${hoveredX}%`,
            top: `${dotYPercent}%`,
            transform: tooltipAbove
              ? 'translate(-50%, calc(-100% - 8px))'
              : 'translate(-50%, 8px)',
          }}
        >
          <div className="hoverable-chart__tooltip-value">{formatValue(hoveredValue)}</div>
          {hoveredTimestamp && (
            <div className="hoverable-chart__tooltip-date">{formatTimestamp(hoveredTimestamp)}</div>
          )}
        </div>
      )}
    </div>
  );
}
