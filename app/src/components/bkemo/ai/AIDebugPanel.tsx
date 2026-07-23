import { useEffect, useMemo, useRef, useState } from 'react';
import {
  clearAiDebugLog,
  getAiDebugEntries,
  isAiDebugAvailable,
  isAiDebugEnabled,
  setAiDebugEnabled,
  subscribeAiDebug,
  type AIDebugEntry,
} from '@/lib/aiDebug';

function formatTime(t: number, origin: number) {
  const ms = Math.max(0, t - origin);
  if (ms < 1000) return `+${ms}ms`;
  return `+${(ms / 1000).toFixed(2)}s`;
}

function levelClass(level: AIDebugEntry['level']) {
  if (level === 'error') return 'is-error';
  if (level === 'warn') return 'is-warn';
  if (level === 'server') return 'is-server';
  if (level === 'event') return 'is-event';
  return '';
}

/**
 * Floating AI loop inspector. Mounted only when Vite DEV + toggle enabled.
 */
export function AIDebugPanel() {
  const [enabled, setEnabled] = useState(() => isAiDebugEnabled());
  const [entries, setEntries] = useState(() => [...getAiDebugEntries()]);
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter] = useState('');
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return subscribeAiDebug(() => {
      setEnabled(isAiDebugEnabled());
      setEntries([...getAiDebugEntries()]);
    });
  }, []);

  useEffect(() => {
    if (collapsed) return;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, collapsed]);

  const origin = entries[0]?.t ?? Date.now();
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((entry) => {
      const hay = `${entry.phase} ${entry.message ?? ''} ${JSON.stringify(entry.data ?? '')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [entries, filter]);

  if (!isAiDebugAvailable() || !enabled) return null;

  return (
    <aside className={`bk-ai-debug-panel${collapsed ? ' is-collapsed' : ''}`} aria-label="AI debug channel">
      <header className="bk-ai-debug-head">
        <div className="bk-ai-debug-title">
          <span className="bk-ai-dialog-kicker">Dev</span>
          <strong>AI debug</strong>
          <small>{entries.length}</small>
        </div>
        <div className="h-stack bk-ai-debug-actions">
          <button type="button" className="bk-native-button is-ghost is-small" onClick={() => setCollapsed((v) => !v)}>
            {collapsed ? 'Expand' : 'Collapse'}
          </button>
          <button type="button" className="bk-native-button is-ghost is-small" onClick={() => clearAiDebugLog()}>
            Clear
          </button>
          <button
            type="button"
            className="bk-native-button is-secondary is-small"
            onClick={() => setAiDebugEnabled(false)}
          >
            Off
          </button>
        </div>
      </header>
      {!collapsed ? (
        <>
          <div className="bk-ai-debug-filter">
            <input
              value={filter}
              onChange={(event) => setFilter(event.currentTarget.value)}
              placeholder="Filter phase / message…"
            />
          </div>
          <div className="bk-ai-debug-log bk-scroll" ref={scrollerRef}>
            {visible.length === 0 ? (
              <div className="bk-ai-debug-empty">Send an AI message to see the full loop here.</div>
            ) : (
              visible.map((entry) => (
                <article key={entry.id} className={`bk-ai-debug-row ${levelClass(entry.level)}`}>
                  <div className="bk-ai-debug-meta">
                    <span>{formatTime(entry.t, origin)}</span>
                    <span>{entry.phase}</span>
                    <span>{entry.level}</span>
                  </div>
                  {entry.message ? <div className="bk-ai-debug-msg">{entry.message}</div> : null}
                  {entry.data != null ? (
                    <pre>{typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data, null, 2)}</pre>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </>
      ) : null}
    </aside>
  );
}

export function DeveloperAiDebugSettings() {
  const [enabled, setEnabled] = useState(() => isAiDebugEnabled());

  useEffect(() => subscribeAiDebug(() => setEnabled(isAiDebugEnabled())), []);

  if (!isAiDebugAvailable()) return null;

  return (
    <div className="v-stack bk-ai-dev-settings">
      <div className="bk-ai-dialog-kicker">Developer</div>
      <h3 style={{ margin: '4px 0 0', fontSize: 16, color: 'var(--fg)' }}>AI debug channel</h3>
      <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.5 }}>
        Streams the full client + server AI loop (RAG, deltas, aborts like BodyStreamBuffer, errors)
        into a floating inspector. Session-only, and this entire section is omitted from production builds.
      </p>
      <div className="h-stack" style={{ marginTop: 14, gap: 10, alignItems: 'center' }}>
        <button
          type="button"
          className={`bk-native-button ${enabled ? 'is-primary' : 'is-secondary'}`}
          onClick={() => setAiDebugEnabled(!enabled)}
        >
          {enabled ? 'Debug channel on' : 'Enable debug channel'}
        </button>
        {enabled ? (
          <button type="button" className="bk-native-button is-ghost" onClick={() => clearAiDebugLog()}>
            Clear log
          </button>
        ) : null}
      </div>
      <ul style={{ margin: '14px 0 0', paddingLeft: 18, color: 'var(--fg-3)', fontSize: 12, lineHeight: 1.55 }}>
        <li>Visible only when <code>import.meta.env.DEV</code> is true</li>
        <li>Stored in <code>sessionStorage</code> (not synced to the server)</li>
        <li>Use it to diagnose stream aborts and slow stages</li>
      </ul>
    </div>
  );
}
