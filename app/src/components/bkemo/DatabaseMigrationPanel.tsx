import { useEffect, useState } from 'react';
import { Icon } from '@/components/Common/Iconify/icons';
import { api } from '@/lib/trpc';

const inputStyle: React.CSSProperties = {
  width: '100%', minHeight: 40, padding: '9px 11px', borderRadius: 'var(--radius)',
  border: '1px solid var(--border-2)', background: 'var(--bg)', color: 'var(--fg)',
  fontSize: 13, fontFamily: 'inherit', outline: 'none',
};

function formatBytes(value?: number) {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return `${amount.toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

type Preflight = Awaited<ReturnType<typeof api.databaseMigration.preflight.mutate>>;
type MigrationJob = Awaited<ReturnType<typeof api.databaseMigration.status.query>>;

const activeStatuses = new Set(['queued', 'pausing', 'dumping', 'restoring', 'verifying']);

export function DatabaseMigrationPanel() {
  const [connectionString, setConnectionString] = useState('');
  const [password, setPassword] = useState('');
  const [confirmHost, setConfirmHost] = useState('');
  const [overrideQuota, setOverrideQuota] = useState(false);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [job, setJob] = useState<MigrationJob>(null);
  const [busy, setBusy] = useState<'preflight' | 'start' | 'unlock' | null>(null);
  const [error, setError] = useState('');
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockConfirmation, setUnlockConfirmation] = useState('');

  const loadStatus = async () => {
    try { setJob(await api.databaseMigration.status.query()); } catch { /* migration table may not exist before deploy */ }
  };

  useEffect(() => { loadStatus(); }, []);
  useEffect(() => {
    if (!job || !activeStatuses.has(job.status)) return;
    const timer = window.setInterval(loadStatus, 1500);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);

  const runPreflight = async () => {
    if (!connectionString || !password || busy) return;
    setBusy('preflight'); setError(''); setPreflight(null);
    try {
      const result = await api.databaseMigration.preflight.mutate({ connectionString, password });
      setPreflight(result);
      setConfirmHost('');
    } catch (value: any) {
      setError(value?.message || 'Preflight failed');
    } finally { setBusy(null); }
  };

  const start = async () => {
    if (!preflight || confirmHost !== preflight.targetHost || busy) return;
    setBusy('start'); setError('');
    try {
      const result = await api.databaseMigration.start.mutate({ connectionString, password, confirmHost, overrideQuota });
      setJob(result);
      setConnectionString(''); setPassword(''); setConfirmHost(''); setPreflight(null);
    } catch (value: any) {
      setError(value?.message || 'Could not start database migration');
    } finally { setBusy(null); }
  };

  const unlock = async () => {
    if (!job || busy) return;
    setBusy('unlock'); setError('');
    try {
      setJob(await api.databaseMigration.cancelReady.mutate({ jobId: job.id, password: unlockPassword, confirmation: unlockConfirmation }));
      setUnlockPassword(''); setUnlockConfirmation('');
    } catch (value: any) { setError(value?.message || 'Could not unlock the local database'); }
    finally { setBusy(null); }
  };

  return (
    <div style={{ border: '1px solid var(--border)', background: 'var(--bg-2)', borderRadius: 'var(--radius-lg)', padding: 18 }}>
      <div className="h-stack" style={{ gap: 10, alignItems: 'flex-start' }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent)', flexShrink: 0 }}><Icon icon="tabler:database" width={19} height={19} /></span>
        <div>
          <div style={{ color: 'var(--fg)', fontSize: 14, fontWeight: 650 }}>Move PostgreSQL to Neon</div>
          <div style={{ color: 'var(--fg-2)', fontSize: 11.5, lineHeight: 1.55, marginTop: 3 }}>Superadmin-only, full-site copy. The destination must be empty. Attachment binaries remain on the selected local/S3 provider.</div>
        </div>
      </div>

      {job ? (
        <div style={{ marginTop: 15, padding: 13, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)' }}>
          <div className="h-stack" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ color: 'var(--fg)', fontSize: 12.5, fontWeight: 650 }}>{job.status === 'ready' ? 'Ready for cutover' : `Migration ${job.status.replaceAll('_', ' ')}`}</div>
            <div style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>{job.targetHost} · {formatBytes(job.estimatedBytes)}</div>
          </div>
          <div style={{ color: job.status === 'failed' ? '#E0696B' : 'var(--fg-2)', fontSize: 11.5, lineHeight: 1.55, marginTop: 6 }}>{job.message}</div>
          {activeStatuses.has(job.status) ? <div style={{ height: 4, marginTop: 10, borderRadius: 10, background: 'var(--bg-3)', overflow: 'hidden' }}><div className="bkemo-indeterminate" style={{ height: '100%', width: '38%', background: 'var(--accent)' }} /></div> : null}
          {job.status === 'ready' ? (
            <div style={{ marginTop: 11, padding: 11, borderRadius: 'var(--radius)', background: 'var(--accent-soft)', color: 'var(--fg)', fontSize: 11.5, lineHeight: 1.6 }}>
              Set your deployment’s <code>DATABASE_URL</code> to Neon’s <strong>pooled</strong> connection string, run migrations with the direct connection, then restart bkemo. The old local database remains intact and write-locked for rollback.
            </div>
          ) : null}
          {job.status === 'ready' ? (
            <details style={{ marginTop: 11 }}>
              <summary style={{ color: 'var(--fg-3)', fontSize: 11.5, cursor: 'pointer' }}>Cancel cutover and unlock local PostgreSQL</summary>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 9, marginTop: 10 }}>
                <input type="password" style={inputStyle} value={unlockPassword} onChange={(e) => setUnlockPassword(e.target.value)} placeholder="Current superadmin password" autoComplete="current-password" />
                <input style={inputStyle} value={unlockConfirmation} onChange={(e) => setUnlockConfirmation(e.target.value)} placeholder="Type UNLOCK LOCAL DATABASE" autoComplete="off" />
              </div>
              <button type="button" onClick={unlock} disabled={busy === 'unlock' || !unlockPassword || unlockConfirmation !== 'UNLOCK LOCAL DATABASE'} style={{ marginTop: 9, minHeight: 36, padding: '7px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border-2)', background: 'var(--bg)', color: 'var(--fg)', opacity: !unlockPassword || unlockConfirmation !== 'UNLOCK LOCAL DATABASE' ? .5 : 1 }}>Unlock local database</button>
            </details>
          ) : null}
        </div>
      ) : null}

      {!job || ['failed', 'cancelled'].includes(job.status) ? (
        <div style={{ marginTop: 16 }}>
          <label style={{ display: 'block' }}>
            <span style={{ display: 'block', color: 'var(--fg)', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Empty Neon direct connection URL</span>
            <input type="password" style={inputStyle} value={connectionString} onChange={(e) => { setConnectionString(e.target.value); setPreflight(null); setError(''); }} placeholder="postgresql://…?sslmode=require" autoComplete="new-password" spellCheck={false} />
            <span style={{ display: 'block', color: 'var(--fg-3)', fontSize: 11, lineHeight: 1.45, marginTop: 5 }}>Used once in server memory. It is never saved, logged, exported, or placed in browser storage.</span>
          </label>
          <label style={{ display: 'block', marginTop: 12 }}>
            <span style={{ display: 'block', color: 'var(--fg)', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Current superadmin password</span>
            <input type="password" style={inputStyle} value={password} onChange={(e) => { setPassword(e.target.value); setPreflight(null); }} autoComplete="current-password" />
          </label>
          <div className="h-stack" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" onClick={runPreflight} disabled={!!busy || !connectionString || !password} style={{ minHeight: 38, padding: '8px 14px', borderRadius: 'var(--radius)', border: '1px solid var(--border-2)', background: 'var(--bg)', color: 'var(--fg)', opacity: busy || !connectionString || !password ? .5 : 1 }}>{busy === 'preflight' ? 'Checking…' : 'Check destination'}</button>
          </div>

          {preflight ? (
            <div style={{ marginTop: 13, padding: 13, borderRadius: 'var(--radius)', border: '1px solid color-mix(in srgb, var(--accent) 55%, var(--border))', background: 'var(--accent-soft)' }}>
              <div style={{ color: 'var(--fg)', fontSize: 12.5, fontWeight: 650 }}>Empty destination verified</div>
              <div style={{ color: 'var(--fg-2)', fontSize: 11.5, lineHeight: 1.6, marginTop: 6 }}>{preflight.sourceTableCount} tables · {formatBytes(preflight.sourceBytes)} source · about {formatBytes(preflight.estimatedBytes)} restored · PostgreSQL {preflight.targetPostgresVersion}</div>
              {preflight.quotaWarning ? <div style={{ color: '#E0A25F', fontSize: 11.5, marginTop: 7 }}>This approaches Neon’s 0.5 GB free limit. Leave room for indexes and future text.</div> : null}
              {preflight.quotaBlocked ? <label className="h-stack" style={{ gap: 8, marginTop: 9, color: 'var(--fg-2)', fontSize: 11.5 }}><input type="checkbox" checked={overrideQuota} onChange={(e) => setOverrideQuota(e.target.checked)} /> I understand the estimate exceeds 450 MiB</label> : null}
              <label style={{ display: 'block', marginTop: 10 }}><span style={{ display: 'block', color: 'var(--fg-2)', fontSize: 11.5, marginBottom: 5 }}>Type destination host to confirm: <code>{preflight.targetHost}</code></span><input style={inputStyle} value={confirmHost} onChange={(e) => setConfirmHost(e.target.value)} autoComplete="off" spellCheck={false} /></label>
              <button type="button" onClick={start} disabled={!!busy || confirmHost !== preflight.targetHost || (preflight.quotaBlocked && !overrideQuota)} style={{ width: '100%', minHeight: 40, marginTop: 10, border: 0, borderRadius: 'var(--radius)', background: 'var(--accent)', color: '#fff', fontWeight: 650, opacity: confirmHost !== preflight.targetHost || (preflight.quotaBlocked && !overrideQuota) ? .5 : 1 }}>{busy === 'start' ? 'Starting…' : 'Enter maintenance mode and copy to Neon'}</button>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <div style={{ marginTop: 12, color: '#E0696B', fontSize: 11.5, lineHeight: 1.5 }}>{error}</div> : null}
    </div>
  );
}
