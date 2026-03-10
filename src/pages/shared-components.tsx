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
  const inputValue = value > 0 ? String(value) : '';

  return (
    <div className={className ?? 'buying-power-editor'}>
      <label className="buying-power-editor__field">
        <span>Buying power</span>
        <input
          type="number"
          min={0}
          step={0.01}
          value={inputValue}
          onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
          placeholder="0"
        />
      </label>
      <div className="buying-power-editor__quick-actions">
        {[500, 1000, 5000].map((amount) => (
          <button
            key={amount}
            type="button"
            className="pill-button"
            onClick={() => onChange(Math.max(0, value + amount))}
          >
            +{formatCurrency(amount)}
          </button>
        ))}
      </div>
      <p>Enter the cash you can actually invest right now. Portfolio totals update immediately.</p>
    </div>
  );
}
