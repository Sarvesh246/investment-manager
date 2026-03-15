import { useEffect, useState } from 'react';
import { formatCurrency } from './shared';

export function BuyingPowerEditor({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  const [localValue, setLocalValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  const valueString = value > 0 ? String(value) : '';

  useEffect(() => {
    if (!isFocused) {
      setLocalValue(valueString);
    }
  }, [valueString, isFocused]);

  const displayValue = isFocused ? localValue : valueString;

  return (
    <div className={className ?? 'buying-power-editor'}>
      <label className="buying-power-editor__field">
        <span>Buying power</span>
        <input
          type="number"
          min={0}
          step={0.01}
          value={displayValue}
          onFocus={() => {
            setIsFocused(true);
            setLocalValue(valueString);
          }}
          onBlur={() => {
            setIsFocused(false);
            const num = Math.max(0, Number(localValue) || 0);
            if (Number.isFinite(num)) {
              onChange(num);
            }
            setLocalValue(valueString);
          }}
          onChange={(event) => setLocalValue(event.target.value)}
          placeholder="0"
        />
      </label>
      <div className="buying-power-editor__quick-actions">
        {[500, 1000, 5000].map((amount) => (
          <button
            key={amount}
            type="button"
            className="pill-button"
            onClick={() => {
              const current = isFocused ? Math.max(0, Number(localValue) || 0) : value;
              const next = Math.max(0, current + amount);
              onChange(next);
              setLocalValue(next > 0 ? String(next) : '');
            }}
          >
            +{formatCurrency(amount)}
          </button>
        ))}
      </div>
      <p>Enter the cash you can actually invest right now. Portfolio totals update immediately.</p>
    </div>
  );
}
