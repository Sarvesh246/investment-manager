import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

interface ChartPoint {
  x: number;
  y: number;
}

function buildTangents(points: ChartPoint[]) {
  const slopes: number[] = [];
  const tangents: number[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const dx = points[index + 1].x - points[index].x || 1;
    slopes.push((points[index + 1].y - points[index].y) / dx);
  }

  tangents[0] = slopes[0];
  tangents[points.length - 1] = slopes[slopes.length - 1];

  for (let index = 1; index < points.length - 1; index += 1) {
    const leftSlope = slopes[index - 1];
    const rightSlope = slopes[index];

    if (leftSlope === 0 || rightSlope === 0 || leftSlope * rightSlope < 0) {
      tangents[index] = 0;
      continue;
    }

    const leftWidth = points[index].x - points[index - 1].x || 1;
    const rightWidth = points[index + 1].x - points[index].x || 1;
    const weightLeft = (2 * rightWidth + leftWidth) / (rightWidth + leftWidth);
    const weightRight = (rightWidth + 2 * leftWidth) / (rightWidth + leftWidth);

    tangents[index] =
      (weightLeft + weightRight) /
      (weightLeft / leftSlope + weightRight / rightSlope);
  }

  return tangents;
}

function buildMonotonePath(points: ChartPoint[], tangents: number[]) {
  if (points.length === 0) {
    return '';
  }

  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }

  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const segmentWidth = next.x - current.x || 1;
    const controlPoint1X = current.x + segmentWidth / 3;
    const controlPoint1Y = current.y + (tangents[index] * segmentWidth) / 3;
    const controlPoint2X = next.x - segmentWidth / 3;
    const controlPoint2Y = next.y - (tangents[index + 1] * segmentWidth) / 3;

    path += ` C ${controlPoint1X} ${controlPoint1Y}, ${controlPoint2X} ${controlPoint2Y}, ${next.x} ${next.y}`;
  }

  return path;
}

function bezierAt(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function bezierXDerivative(t: number, x0: number, x1: number, x2: number, x3: number): number {
  const u = 1 - t;
  return 3 * u * u * (x1 - x0) + 6 * u * t * (x2 - x1) + 3 * t * t * (x3 - x2);
}

function sampleBezierSegmentY(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  targetX: number,
): number {
  let t = (targetX - x0) / (x3 - x0 || 1);
  t = Math.max(0, Math.min(1, t));

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const x = bezierAt(t, x0, x1, x2, x3);
    const derivative = bezierXDerivative(t, x0, x1, x2, x3);
    if (Math.abs(x - targetX) < 0.5 || Math.abs(derivative) < 1e-6) {
      break;
    }
    t -= (x - targetX) / derivative;
    t = Math.max(0, Math.min(1, t));
  }

  return bezierAt(t, y0, y1, y2, y3);
}

function sampleMonotoneY(points: ChartPoint[], tangents: number[], x: number) {
  if (points.length === 0) return 0;
  if (points.length === 1 || x <= points[0].x) return points[0].y;

  const lastPoint = points[points.length - 1];
  if (x >= lastPoint.x) return lastPoint.y;

  let segmentIndex = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    if (x >= points[index].x && x <= points[index + 1].x) {
      segmentIndex = index;
      break;
    }
  }

  const current = points[segmentIndex];
  const next = points[segmentIndex + 1];
  const segmentWidth = next.x - current.x || 1;
  const controlPoint1X = current.x + segmentWidth / 3;
  const controlPoint1Y = current.y + (tangents[segmentIndex] * segmentWidth) / 3;
  const controlPoint2X = next.x - segmentWidth / 3;
  const controlPoint2Y = next.y - (tangents[segmentIndex + 1] * segmentWidth) / 3;

  return sampleBezierSegmentY(
    current.x,
    current.y,
    controlPoint1X,
    controlPoint1Y,
    controlPoint2X,
    controlPoint2Y,
    next.x,
    next.y,
    x,
  );
}

export function HoverableChart({
  values,
  timestamps,
  tone = 'positive',
  formatValue = formatCurrency,
  className,
}: HoverableChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverState, setHoverState] = useState<{ x: number; index: number } | null>(null);
  const [chartSize, setChartSize] = useState({ width: 100, height: 100 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const updateSize = () => {
      setChartSize({
        width: Math.max(container.clientWidth, 100),
        height: Math.max(container.clientHeight, 100),
      });
    };

    updateSize();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize);
      return () => {
        window.removeEventListener('resize', updateSize);
      };
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  const padY = Math.max(chartSize.height * 0.08, 12);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = useMemo(
    () =>
      values.map((value, index) => {
        const x = (index / Math.max(values.length - 1, 1)) * chartSize.width;
        const y =
          chartSize.height -
          padY -
          ((value - min) / range) * (chartSize.height - padY * 2);
        return { x, y };
      }),
    [chartSize.height, chartSize.width, min, padY, range, values],
  );
  const tangents = useMemo(() => buildTangents(points), [points]);
  const path = useMemo(() => buildMonotonePath(points, tangents), [points, tangents]);

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container || values.length === 0) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
      const floatIndex = (x / rect.width) * Math.max(values.length - 1, 1);
      const nearestIndex = Math.max(0, Math.min(Math.round(floatIndex), values.length - 1));

      setHoverState({ x, index: nearestIndex });
    },
    [values.length],
  );

  const handleMouseLeave = useCallback(() => {
    setHoverState(null);
  }, []);

  const hoveredIndex = hoverState?.index ?? null;
  const hoveredX = hoverState?.x ?? null;
  const hoveredValue =
    hoveredX !== null
      ? min + ((chartSize.height - padY - sampleMonotoneY(points, tangents, hoveredX)) / (chartSize.height - padY * 2)) * range
      : null;
  const hoveredTimestamp =
    hoveredIndex !== null && timestamps?.[hoveredIndex] ? timestamps[hoveredIndex] : null;
  const hoveredPoint =
    hoveredX !== null
      ? {
          x: hoveredX,
          y: sampleMonotoneY(points, tangents, hoveredX),
        }
      : null;
  const tooltipTransform = hoveredPoint
    ? hoveredPoint.x > chartSize.width * 0.72
      ? 'translate(calc(-100% - 14px), -50%)'
      : hoveredPoint.y < chartSize.height * 0.38
        ? 'translate(14px, -50%)'
        : 'translate(-50%, calc(-100% - 10px))'
    : undefined;

  if (values.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={clsx('hoverable-chart', className)}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <svg
        className={clsx('hoverable-chart__svg', `hoverable-chart--${tone}`)}
        viewBox={`0 0 ${chartSize.width} ${chartSize.height}`}
        preserveAspectRatio="none"
      >
        <path d={path} className="hoverable-chart__line" />
        {hoveredPoint && hoveredValue !== null ? (
          <g className="hoverable-chart__hover-layer" aria-hidden>
            <line
              className="hoverable-chart__crosshair-svg"
              x1={hoveredPoint.x}
              y1={0}
              x2={hoveredPoint.x}
              y2={chartSize.height}
            />
            <circle
              className={clsx('hoverable-chart__marker-svg', `hoverable-chart__marker-svg--${tone}`)}
              cx={hoveredPoint.x}
              cy={hoveredPoint.y}
              r={9}
            />
            <circle
              className={clsx('hoverable-chart__marker-svg-dot', `hoverable-chart__marker-svg-dot--${tone}`)}
              cx={hoveredPoint.x}
              cy={hoveredPoint.y}
              r={4}
            />
          </g>
        ) : null}
      </svg>
      {hoveredIndex !== null && hoveredValue !== null && hoveredPoint ? (
        <div
          className="hoverable-chart__tooltip"
          style={{
            left: `${hoveredPoint.x}px`,
            top: `${hoveredPoint.y}px`,
            transform: tooltipTransform,
          }}
        >
          <div className="hoverable-chart__tooltip-value">{formatValue(hoveredValue)}</div>
          {hoveredTimestamp ? (
            <div className="hoverable-chart__tooltip-date">{formatTimestamp(hoveredTimestamp)}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
