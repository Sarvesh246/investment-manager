import { useState, useRef, useEffect } from 'react';
import { BookmarkPlus } from 'lucide-react';
import type { Watchlist } from '../domain/types';
import { normalizeSymbol } from '../lib/symbols';

interface SaveToWatchlistButtonProps {
  symbol: string;
  watchlists: Watchlist[];
  onAdd: (watchlistId: string, symbol: string) => void;
  onCreateAndAdd?: (name: string, symbol: string) => void;
  className?: string;
}

export function SaveToWatchlistButton({
  symbol,
  watchlists,
  onAdd,
  onCreateAndAdd,
  className = '',
}: SaveToWatchlistButtonProps) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [open]);

  const normalized = normalizeSymbol(symbol);
  if (!normalized) return null;

  const userWatchlists = watchlists.filter((w) => w.id !== 'runtime-holdings');
  const watchlistsWithoutSymbol = userWatchlists.filter(
    (w) => !w.symbols.includes(normalized),
  );

  return (
    <div className={`save-to-watchlist ${className}`} ref={ref}>
      <button
        type="button"
        className="pill-button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <BookmarkPlus size={14} />
        Save to watchlist
      </button>
      {open && (
        <div className="save-to-watchlist__dropdown">
          {watchlistsWithoutSymbol.length === 0 && !onCreateAndAdd ? (
            <p className="save-to-watchlist__empty">No watchlists. Create one in Settings.</p>
          ) : (
            <>
              {watchlistsWithoutSymbol.map((wl) => (
                <button
                  key={wl.id}
                  type="button"
                  className="save-to-watchlist__option"
                  onClick={() => {
                    onAdd(wl.id, normalized);
                    setOpen(false);
                  }}
                >
                  {wl.name}
                </button>
              ))}
              {onCreateAndAdd && (
                <form
                  className="save-to-watchlist__new"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = newName.trim();
                    if (name) {
                      onCreateAndAdd(name, normalized);
                      setNewName('');
                      setOpen(false);
                    }
                  }}
                >
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="New watchlist name"
                  />
                  <button type="submit" className="pill-button" disabled={!newName.trim()}>
                    Create & add
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
