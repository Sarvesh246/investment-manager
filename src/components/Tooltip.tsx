import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

const TOOLTIP_OFFSET = 6;
const TOOLTIP_Z_INDEX = 10002;

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  openDelayMs?: number;
}

export function Tooltip({
  content,
  children,
  side = 'top',
  className,
  openDelayMs = 450,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || !visible) return;

    const rect = trigger.getBoundingClientRect();
    const tooltipWidth = Math.min(288, window.innerWidth - 24);
    const padding = 12;
    const showAbove = side === 'top' && rect.top > 120;

    const left = Math.max(padding, Math.min(window.innerWidth - tooltipWidth - padding, rect.left + rect.width / 2 - tooltipWidth / 2));

    if (showAbove) {
      /* Anchor by bottom so tooltip sits just above trigger regardless of content height */
      const bottom = window.innerHeight - (rect.top - TOOLTIP_OFFSET);
      setCoords({ left, bottom });
    } else {
      const top = rect.bottom + TOOLTIP_OFFSET;
      setCoords({ left, top: Math.min(top, window.innerHeight - 200) });
    }
  }, [visible, side]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [visible, updatePosition]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current != null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  function show() {
    if (timeoutRef.current != null) {
      window.clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      setVisible(true);
      timeoutRef.current = null;
    }, openDelayMs);
  }

  function hide() {
    if (timeoutRef.current != null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    setVisible(false);
  }

  const tooltipEl =
    visible && coords && typeof document !== 'undefined'
      ? createPortal(
          <span
            className={clsx('tooltip', 'tooltip--portal', `tooltip--${side}`)}
            role="tooltip"
            style={{
              position: 'fixed',
              left: coords.left,
              ...(coords.bottom != null ? { bottom: coords.bottom } : { top: coords.top ?? 0 }),
              zIndex: TOOLTIP_Z_INDEX,
            }}
          >
            {content}
          </span>,
          document.body,
        )
      : null;

  return (
    <>
      <span
        ref={triggerRef}
        className={clsx('tooltip-trigger', className)}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {tooltipEl}
    </>
  );
}
