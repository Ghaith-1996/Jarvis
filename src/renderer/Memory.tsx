import { useCallback, useEffect, useState } from 'react';
import type { MemoryItem, MemoryKind } from '../shared/contracts.ts';
import { api, errText } from './api.ts';

export function MemoryPage({ onNotice }: { onNotice: (n: string) => void }) {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [draft, setDraft] = useState<{ kind: MemoryKind; text: string }>({ kind: 'preference', text: '' });
  const [editing, setEditing] = useState<Record<string, { kind: MemoryKind; text: string }>>({});
  const load = useCallback(() => api.memory.list().then(setItems).catch((e) => onNotice(errText(e))), [onNotice]);
  useEffect(() => { void load(); }, [load]);

  const add = async () => { await api.memory.add(draft.kind, draft.text, 'added on memory page'); setDraft({ ...draft, text: '' }); void load(); };
  const save = async (m: MemoryItem) => { const e = editing[m.id]!; await api.memory.update(m.id, e.kind, e.text); setEditing(({ [m.id]: _, ...rest }) => rest); void load(); };
  const remove = async (m: MemoryItem) => { if (confirm('Delete this memory item?')) { await api.memory.remove(m.id); void load(); } };

  return (
    <section className="memory" aria-labelledby="memory-title">
      <h2 id="memory-title">Memory</h2>
      <p className="muted">Only what you save here (or with “Remember this”) is remembered. Items are sent to the model at the start of each new conversation. Changes apply to new conversations.</p>
      <ul className="memory-list">
        {!items.length && <li className="muted">Nothing saved yet.</li>}
        {items.map((m) => {
          const e = editing[m.id];
          return (
            <li key={m.id}>
              {e ? (
                <div className="edit">
                  <select aria-label="Kind" value={e.kind} onChange={(ev) => setEditing({ ...editing, [m.id]: { ...e, kind: ev.target.value as MemoryKind } })}><option value="preference">Preference</option><option value="fact">Fact</option></select>
                  <textarea aria-label="Memory text" value={e.text} rows={2} onChange={(ev) => setEditing({ ...editing, [m.id]: { ...e, text: ev.target.value } })} />
                  <div className="row"><button onClick={() => void save(m)} disabled={!e.text.trim()}>Save</button><button onClick={() => setEditing(({ [m.id]: _, ...rest }) => rest)}>Cancel</button></div>
                </div>
              ) : (
                <>
                  <span className="tag">{m.kind}</span> {m.text}
                  <div className="muted small">Source: {m.source} · updated {new Date(m.updatedAt).toLocaleString()}</div>
                  <div className="row"><button onClick={() => setEditing({ ...editing, [m.id]: { kind: m.kind, text: m.text } })}>Edit</button><button onClick={() => void remove(m)}>Delete</button></div>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (draft.text.trim()) void add(); }}>
        <select aria-label="Kind" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as MemoryKind })}><option value="preference">Preference</option><option value="fact">Fact</option></select>
        <input aria-label="New memory item" placeholder="e.g. Prefers answers in French" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
        <button type="submit" disabled={!draft.text.trim()}>Add</button>
      </form>
    </section>
  );
}
