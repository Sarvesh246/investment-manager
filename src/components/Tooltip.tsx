import { useState, type ReactNode } from 'react';
import clsx from 'clsx';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

export function Tooltip({ content, children, side = 'top', className }: TooltipProps) {
  const [visible, setVisible] = useState(false);

  return (
    <span
      className={clsx('tooltip-trigger', className)}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          className={clsx('tooltip', `tooltip--${side}`)}
          role="tooltip"
        >
          {content}
        </span>
      )}
    </span>
  );
}
