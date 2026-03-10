import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Panel,
  PageHeader,
} from './../components/ui';
import { Modal } from './../components/Modal';
import { downloadBlob, exportJournalCsv } from './../lib/exportPortfolio';
import { normalizeSymbol } from './../lib/symbols';
import { usePortfolioWorkspace } from './../runtime/portfolioContext';
import { useToast } from './../runtime/toastContext';

const defaultJournalForm = {
  symbol: '',
  decisionDate: new Date().toISOString().slice(0, 10),
  decisionType: 'Buy',
  userThesis: '',
  invalidationRule: '',
  systemSummary: '',
  outcome: '',
};

export function JournalPage() {
  const {
    journal,
    addJournalEntry,
    updateJournalEntry,
    removeJournalEntry,
    model,
  } = usePortfolioWorkspace();
  const { addToast } = useToast();
  const [form, setForm] = useState(defaultJournalForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  const handleAdd = () => {
    const sym = normalizeSymbol(form.symbol);
    if (!sym) {
      addToast('Please enter a valid symbol', 'warning');
      return;
    }
    if (!form.userThesis.trim()) {
      addToast('Please enter your thesis', 'warning');
      return;
    }
    addJournalEntry({
      symbol: sym,
      decisionDate: form.decisionDate,
      decisionType: form.decisionType || 'Buy',
      userThesis: form.userThesis.trim(),
      invalidationRule: form.invalidationRule.trim(),
      systemSummary: form.systemSummary.trim(),
      outcome: form.outcome.trim(),
    });
    setForm(defaultJournalForm);
    setShowAddModal(false);
    addToast('Journal entry added', 'success');
  };

  const handleEdit = () => {
    if (!editingId) return;
    updateJournalEntry(editingId, {
      symbol: normalizeSymbol(form.symbol) || form.symbol,
      decisionDate: form.decisionDate,
      decisionType: form.decisionType || 'Buy',
      userThesis: form.userThesis.trim(),
      invalidationRule: form.invalidationRule.trim(),
      systemSummary: form.systemSummary.trim(),
      outcome: form.outcome.trim(),
    });
    setEditingId(null);
    setShowEditModal(false);
    setForm(defaultJournalForm);
    addToast('Journal entry updated', 'success');
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Delete this journal entry? This cannot be undone.')) {
      removeJournalEntry(id);
      if (editingId === id) {
        setEditingId(null);
        setShowEditModal(false);
      }
      addToast('Journal entry removed', 'success');
    }
  };

  const openEdit = (entry: (typeof journal)[0]) => {
    setEditingId(entry.id);
    setForm({
      symbol: entry.symbol,
      decisionDate: entry.decisionDate,
      decisionType: entry.decisionType,
      userThesis: entry.userThesis,
      invalidationRule: entry.invalidationRule,
      systemSummary: entry.systemSummary,
      outcome: entry.outcome,
    });
    setShowEditModal(true);
  };

  const systemSummaryForSymbol = (symbol: string) => {
    const scorecard = model.scorecards.find((c) => c.symbol === symbol);
    const security = model.dataset.securities.find((s) => s.symbol === symbol);
    if (!scorecard || !security) return '';
    const parts = [
      scorecard.action,
      `Opportunity ${scorecard.opportunity.score}`,
      `Fragility ${scorecard.fragility.score}`,
      `Fit ${scorecard.portfolioFit.score}`,
    ];
    return parts.join(', ');
  };

  return (
    <div className="page">
      <PageHeader
        title="Decision Journal"
        summary="Write down why you bought something, what would prove you wrong, and what the system said at the time."
        meta={
          <div className="page-header__actions">
            <button
              type="button"
              className="pill-button"
              onClick={() => {
                const blob = exportJournalCsv(journal);
                downloadBlob(blob, `journal-${new Date().toISOString().slice(0, 10)}.csv`);
                addToast('Journal exported', 'success');
              }}
              disabled={journal.length === 0}
            >
              Export CSV
            </button>
            <button
              type="button"
              className="action-button"
              onClick={() => {
                setForm(defaultJournalForm);
                setShowAddModal(true);
              }}
            >
              <Plus size={16} />
              Add entry
            </button>
          </div>
        }
      />

      {journal.length === 0 ? (
        <section className="empty-state empty-state--compact">
          <div className="empty-state__eyebrow">No entries yet</div>
          <h2>Add your first journal entry</h2>
          <p>
            Record why you bought a stock, what would prove you wrong, and what the system said at the time. This helps you learn from past decisions.
          </p>
          <button
            type="button"
            className="action-button"
            onClick={() => setShowAddModal(true)}
          >
            <Plus size={16} />
            Add your first entry
          </button>
        </section>
      ) : (
        <div className="stack-grid journal-stack">
          {journal.map((entry) => (
            <Panel
              key={entry.id}
              title={`${entry.symbol} - ${entry.decisionType}`}
              eyebrow={entry.decisionDate}
              subtitle={entry.systemSummary}
              className="journal-entry"
              action={
                <div className="journal-entry__actions">
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => openEdit(entry)}
                    aria-label="Edit entry"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => handleDelete(entry.id)}
                    aria-label="Delete entry"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              }
            >
              <div className="journal-block">
                <div>
                  <h3>Original thesis</h3>
                  <p>{entry.userThesis || '—'}</p>
                </div>
                <div>
                  <h3>Invalidation rule</h3>
                  <p>{entry.invalidationRule || '—'}</p>
                </div>
                <div>
                  <h3>Outcome</h3>
                  <p>{entry.outcome || '—'}</p>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add journal entry"
      >
        <JournalEntryForm
          form={form}
          setForm={setForm}
          securities={model.dataset.securities}
          onSuggestSystemSummary={() => {
            const sym = normalizeSymbol(form.symbol);
            if (sym) setForm((f) => ({ ...f, systemSummary: systemSummaryForSymbol(sym) }));
          }}
        />
        <div className="modal-actions">
          <button type="button" className="pill-button" onClick={() => setShowAddModal(false)}>
            Cancel
          </button>
          <button type="button" className="action-button" onClick={handleAdd}>
            Add entry
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setEditingId(null);
        }}
        title="Edit journal entry"
      >
        <JournalEntryForm
          form={form}
          setForm={setForm}
          securities={model.dataset.securities}
          onSuggestSystemSummary={() => {
            const sym = normalizeSymbol(form.symbol);
            if (sym) setForm((f) => ({ ...f, systemSummary: systemSummaryForSymbol(sym) }));
          }}
        />
        <div className="modal-actions">
          <button
            type="button"
            className="pill-button pill-button--danger"
            onClick={() => editingId && handleDelete(editingId)}
          >
            Delete
          </button>
          <button type="button" className="pill-button" onClick={() => setShowEditModal(false)}>
            Cancel
          </button>
          <button type="button" className="action-button" onClick={handleEdit}>
            Save changes
          </button>
        </div>
      </Modal>
    </div>
  );
}

function JournalEntryForm({
  form,
  setForm,
  securities,
  onSuggestSystemSummary,
}: {
  form: typeof defaultJournalForm;
  setForm: React.Dispatch<React.SetStateAction<typeof defaultJournalForm>>;
  securities: Array<{ symbol: string }>;
  onSuggestSystemSummary: () => void;
}) {
  const symbols = securities.map((s) => s.symbol).filter(Boolean);
  return (
    <div className="filters filters--stacked">
      <label>
        Symbol
        <input
          type="text"
          value={form.symbol}
          onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value.toUpperCase() }))}
          placeholder="AAPL"
          list="journal-symbol-list"
        />
        <datalist id="journal-symbol-list">
          {symbols.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </label>
      <label>
        Decision date
        <input
          type="date"
          value={form.decisionDate}
          onChange={(e) => setForm((f) => ({ ...f, decisionDate: e.target.value }))}
        />
      </label>
      <label>
        Decision type
        <select
          value={form.decisionType}
          onChange={(e) => setForm((f) => ({ ...f, decisionType: e.target.value }))}
        >
          <option value="Buy">Buy</option>
          <option value="Sell">Sell</option>
          <option value="Hold">Hold</option>
          <option value="Trim">Trim</option>
        </select>
      </label>
      <label>
        Original thesis
        <textarea
          value={form.userThesis}
          onChange={(e) => setForm((f) => ({ ...f, userThesis: e.target.value }))}
          placeholder="Why did you buy this?"
          rows={3}
        />
      </label>
      <label>
        Invalidation rule
        <textarea
          value={form.invalidationRule}
          onChange={(e) => setForm((f) => ({ ...f, invalidationRule: e.target.value }))}
          placeholder="What would prove you wrong?"
          rows={2}
        />
      </label>
      <label>
        System summary
        <div className="field-with-action">
          <textarea
            value={form.systemSummary}
            onChange={(e) => setForm((f) => ({ ...f, systemSummary: e.target.value }))}
            placeholder="What the system said at decision time"
            rows={2}
          />
          <button type="button" className="pill-button" onClick={onSuggestSystemSummary}>
            Suggest from model
          </button>
        </div>
      </label>
      <label>
        Outcome
        <textarea
          value={form.outcome}
          onChange={(e) => setForm((f) => ({ ...f, outcome: e.target.value }))}
          placeholder="How did it turn out? (fill in later)"
          rows={2}
        />
      </label>
    </div>
  );
}
