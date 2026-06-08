import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import dayjs from '@/lib/dayjs';
import { api } from '@/lib/trpc';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';
import { ACCESS_SCOPES, type AccessScope } from '@shared/lib/accessTokenScopes';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' };

type TokenRow = {
  id: number; name: string; scopes: string[]; preview: string;
  lastUsedAt: Date | string | null; expiresAt: Date | string | null; createdAt: Date | string;
};

const EXPIRY_OPTIONS = [
  { v: 30, label: '30 days' },
  { v: 90, label: '90 days' },
  { v: 365, label: '1 year' },
  { v: 0, label: 'No expiry' },
];

function Chip({ children, tone = 'var(--fg-2)' }: { children: React.ReactNode; tone?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '1px 8px', borderRadius: 100, border: `1px solid color-mix(in srgb, ${tone} 35%, transparent)`, color: tone, fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>{children}</span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1400); }}
      style={{ background: 'var(--bg)', border: '1px solid var(--border-2)', color: 'var(--fg-2)', borderRadius: 'var(--radius)', padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-mono)', flexShrink: 0 }}
    >{copied ? '✓ copied' : 'copy'}</button>
  );
}

export const SecurityScreen = observer(function SecurityScreen() {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<AccessScope[]>(['notes:read']);
  const [expiry, setExpiry] = useState<number>(90);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);
  const [error, setError] = useState('');

  const apiBase = getBlinkoEndpoint('/api');
  const docsUrl = getBlinkoEndpoint('/docs');

  const load = async () => {
    setLoading(true);
    try { setTokens(await api.accessTokens.list.query() as any); }
    catch (e) { console.error('[security] list failed:', e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const toggleScope = (s: AccessScope) => setScopes((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);

  const create = async () => {
    setError('');
    if (!name.trim()) { setError('Give the token a name.'); return; }
    if (scopes.length === 0) { setError('Pick at least one scope.'); return; }
    setCreating(true);
    try {
      const res = await api.accessTokens.create.mutate({ name: name.trim(), scopes, expiresInDays: expiry > 0 ? expiry : null }) as any;
      setCreated({ token: res.token, name: res.name });
      setName(''); setScopes(['notes:read']); setExpiry(90);
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create token.');
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: number) => {
    if (!window.confirm('Revoke this token? Any integration using it will stop working immediately.')) return;
    try { await api.accessTokens.revoke.mutate({ id }); await load(); }
    catch (e) { console.error('[security] revoke failed:', e); }
  };

  const curlExample = useMemo(() => (
    `curl -X POST ${apiBase}/v1/note/list \\\n  -H "Authorization: Bearer <YOUR_TOKEN>" \\\n  -H "Content-Type: application/json" \\\n  -d '{"page":1,"size":20}'`
  ), [apiBase]);

  return (
    <div>
      <h2 style={{ fontSize: 24, fontWeight: 600, color: 'var(--fg)', letterSpacing: '-0.02em', margin: 0 }}>Security & API</h2>
      <div style={{ color: 'var(--fg-2)', fontSize: 13, marginTop: 4, marginBottom: 22 }}>
        Create scoped access tokens to use the bkemo REST API from scripts and integrations. Each token is shown once — store it safely.
      </div>

      {/* API reference */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-2)', padding: 16, marginBottom: 24 }}>
        <div className="h-stack" style={{ gap: 10, marginBottom: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>REST API</span>
          <a href={docsUrl} target="_blank" rel="noreferrer" style={{ ...mono, color: 'var(--accent)' }}>open API reference ↗</a>
        </div>
        <div style={{ ...mono, marginBottom: 8 }}>Base URL</div>
        <div className="h-stack" style={{ gap: 8, marginBottom: 12 }}>
          <code style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', padding: '6px 10px', fontSize: 12, color: 'var(--fg)', overflow: 'auto', whiteSpace: 'nowrap' }}>{apiBase}</code>
          <CopyButton text={apiBase} />
        </div>
        <div style={{ ...mono, marginBottom: 8 }}>Example</div>
        <pre style={{ background: 'var(--bg)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', padding: '10px 12px', fontSize: 11.5, color: 'var(--fg-2)', overflow: 'auto', margin: 0, lineHeight: 1.6 }}>{curlExample}</pre>
      </div>

      {/* Create */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-2)', padding: 16, marginBottom: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', marginBottom: 14 }}>Create access token</div>

        {created && (
          <div style={{ border: '1px solid color-mix(in srgb, var(--accent) 45%, transparent)', background: 'var(--accent-soft)', borderRadius: 'var(--radius)', padding: 12, marginBottom: 16 }}>
            <div style={{ fontSize: 12.5, color: 'var(--fg)', fontWeight: 600, marginBottom: 6 }}>“{created.name}” created</div>
            <div style={{ fontSize: 11.5, color: 'var(--fg-2)', marginBottom: 8 }}>Copy it now — it won’t be shown again.</div>
            <div className="h-stack" style={{ gap: 8 }}>
              <code style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', padding: '6px 10px', fontSize: 11.5, color: 'var(--fg)', overflow: 'auto', whiteSpace: 'nowrap' }}>{created.token}</code>
              <CopyButton text={created.token} />
              <button onClick={() => setCreated(null)} style={{ background: 'transparent', border: '1px solid var(--border-2)', color: 'var(--fg-3)', borderRadius: 'var(--radius)', padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>dismiss</button>
            </div>
          </div>
        )}

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Token name (e.g. “Raycast script”)"
          style={{ width: '100%', background: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', padding: '8px 10px', fontSize: 13, marginBottom: 14, outline: 'none', boxSizing: 'border-box' }}
        />

        <div style={{ ...mono, marginBottom: 8 }}>Scopes</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, marginBottom: 16 }}>
          {ACCESS_SCOPES.map((s) => {
            const on = scopes.includes(s.id);
            return (
              <div key={s.id} onClick={() => toggleScope(s.id)} style={{ display: 'flex', gap: 8, padding: '8px 10px', borderRadius: 'var(--radius)', border: `1px solid ${on ? 'var(--accent)' : 'var(--border-2)'}`, background: on ? 'var(--accent-soft)' : 'var(--bg)', cursor: 'pointer' }}>
                <span style={{ width: 15, height: 15, marginTop: 1, borderRadius: 4, border: `1.5px solid ${on ? 'var(--accent)' : 'var(--fg-3)'}`, background: on ? 'var(--accent)' : 'transparent', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, flexShrink: 0 }}>{on ? '✓' : ''}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--fg)', fontFamily: 'var(--font-mono)' }}>{s.id}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2, lineHeight: 1.4 }}>{s.description}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="h-stack" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="h-stack" style={{ gap: 8, fontSize: 12.5, color: 'var(--fg-2)' }}>
            <span style={mono}>expires</span>
            <select value={expiry} onChange={(e) => setExpiry(Number(e.target.value))} style={{ background: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', padding: '5px 8px', fontSize: 12 }}>
              {EXPIRY_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </label>
          {error && <span style={{ color: 'var(--urgent, #E0696B)', fontSize: 12 }}>{error}</span>}
          <span className="spacer" />
          <button onClick={create} disabled={creating} style={{ background: 'var(--accent)', border: 'none', color: '#fff', padding: '7px 16px', borderRadius: 'var(--radius)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', opacity: creating ? 0.6 : 1 }}>{creating ? 'Creating…' : 'Create token'}</button>
        </div>
      </div>

      {/* List */}
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', marginBottom: 12 }}>Your tokens</div>
      {loading ? (
        <div style={{ ...mono, padding: 16 }}>Loading…</div>
      ) : tokens.length === 0 ? (
        <div style={{ ...mono, padding: 16, border: '1px dashed var(--border-2)', borderRadius: 'var(--radius)', textAlign: 'center' }}>No tokens yet.</div>
      ) : (
        <div className="v-stack" style={{ gap: 8 }}>
          {tokens.map((t) => {
            const expired = t.expiresAt && dayjs(t.expiresAt).isBefore(dayjs());
            return (
              <div key={t.id} className="h-stack" style={{ gap: 12, padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-2)', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="h-stack" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 13.5, color: 'var(--fg)', fontWeight: 500 }}>{t.name}</span>
                    <span style={mono}>…{t.preview}</span>
                    {expired && <Chip tone="var(--urgent, #E0696B)">expired</Chip>}
                  </div>
                  <div className="h-stack" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {t.scopes.map((s) => <Chip key={s} tone="var(--accent)">{s}</Chip>)}
                  </div>
                  <div style={{ ...mono, marginTop: 8 }}>
                    created {dayjs(t.createdAt).format('MMM D, YYYY')}
                    {' · '}{t.lastUsedAt ? `last used ${dayjs(t.lastUsedAt).fromNow()}` : 'never used'}
                    {t.expiresAt ? ` · expires ${dayjs(t.expiresAt).format('MMM D, YYYY')}` : ' · no expiry'}
                  </div>
                </div>
                <button onClick={() => revoke(t.id)} style={{ background: 'transparent', border: '1px solid #5C2A2A', color: '#E0696B', padding: '5px 12px', borderRadius: 'var(--radius)', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>Revoke</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
