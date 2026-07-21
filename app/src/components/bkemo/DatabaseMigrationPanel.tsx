import { useEffect, useRef, useState } from 'react';
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
type DevelopmentAttachStatus = Awaited<ReturnType<typeof api.databaseMigration.developmentAttachStatus.query>>;
type DevelopmentAttachPreflight = Awaited<ReturnType<typeof api.databaseMigration.preflightExistingDevelopmentNeon.mutate>>;
const pollingStatuses = new Set(['queued', 'pausing', 'dumping', 'restoring', 'verifying', 'cutover_pending', 'return_pending', 'verifying_cutover']);

export function DatabaseMigrationPanel({ target, onActivityChange }: { target: 'local' | 'neon'; onActivityChange?: () => void }) {
  const [connectionString, setConnectionString] = useState('');
  const [password, setPassword] = useState('');
  const [confirmHost, setConfirmHost] = useState('');
  const [overrideQuota, setOverrideQuota] = useState(false);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [job, setJob] = useState<MigrationJob>(null);
  const [busy, setBusy] = useState<'preflight' | 'start' | 'cutover' | 'finalize' | 'return' | 'unlock' | 'dev-preflight' | 'dev-attach' | null>(null);
  const [error, setError] = useState('');
  const [pooledConnectionString, setPooledConnectionString] = useState('');
  const [cutoverPassword, setCutoverPassword] = useState('');
  const [returnPassword, setReturnPassword] = useState('');
  const [returnConfirmation, setReturnConfirmation] = useState('');
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockConfirmation, setUnlockConfirmation] = useState('');
  const [developmentAttachStatus, setDevelopmentAttachStatus] = useState<DevelopmentAttachStatus | null>(null);
  const [developmentPooledUrl, setDevelopmentPooledUrl] = useState('');
  const [developmentPassword, setDevelopmentPassword] = useState('');
  const [developmentConfirmation, setDevelopmentConfirmation] = useState('');
  const [developmentPreflight, setDevelopmentPreflight] = useState<DevelopmentAttachPreflight | null>(null);
  const [developmentMessage, setDevelopmentMessage] = useState('');
  const finalizing = useRef(false);

  const loadStatus = async () => {
    try { setJob(await api.databaseMigration.status.query()); } catch { /* schema may not exist before deployment */ }
  };

  useEffect(() => {
    loadStatus();
    api.databaseMigration.developmentAttachStatus.query().then(setDevelopmentAttachStatus).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!job || !pollingStatuses.has(job.status)) return;
    const timer = window.setInterval(loadStatus, 1500);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);

  const finalize = async (passwordOverride?: string) => {
    const finalPassword = passwordOverride || cutoverPassword || returnPassword;
    if (!job || !finalPassword || finalizing.current) return;
    finalizing.current = true;
    setBusy('finalize'); setError('');
    try {
      const next = await api.databaseMigration.finalizeCutover.mutate({ jobId: job.id, password: finalPassword });
      setJob(next); setCutoverPassword(''); setReturnPassword(''); onActivityChange?.();
    } catch (value: any) {
      const message = value?.message || 'Post-restart verification is not ready';
      if (!/fetch|network|load failed/i.test(message)) setError(message);
    } finally { finalizing.current = false; setBusy(null); }
  };

  useEffect(() => {
    if (!job) return;
    const runningOnTarget = job.direction === 'neon-to-local'
      ? job.currentProvider === 'local'
      : job.currentProvider === 'neon';
    if (runningOnTarget && ['cutover_pending', 'return_pending'].includes(job.status) && (cutoverPassword || returnPassword)) {
      void finalize();
    }
  }, [job?.status, job?.currentProvider]);

  const runPreflight = async () => {
    if (!connectionString || !password || busy) return;
    setBusy('preflight'); setError(''); setPreflight(null);
    try {
      const result = await api.databaseMigration.preflight.mutate({ connectionString, password });
      setPreflight(result); setConfirmHost('');
    } catch (value: any) { setError(value?.message || 'Preflight failed'); }
    finally { setBusy(null); }
  };

  const preflightExistingDevelopmentNeon = async () => {
    if (!developmentPooledUrl || !developmentPassword || busy) return;
    setBusy('dev-preflight'); setError(''); setDevelopmentMessage(''); setDevelopmentPreflight(null);
    try {
      const result = await api.databaseMigration.preflightExistingDevelopmentNeon.mutate({
        pooledConnectionString: developmentPooledUrl,
        password: developmentPassword,
      });
      setDevelopmentPreflight(result); setDevelopmentConfirmation('');
    } catch (value: any) { setError(value?.message || 'Could not inspect the existing Neon development database'); }
    finally { setBusy(null); }
  };

  const attachExistingDevelopmentNeon = async () => {
    if (!developmentPreflight || developmentConfirmation !== developmentPreflight.confirmation || busy) return;
    setBusy('dev-attach'); setError(''); setDevelopmentMessage('');
    try {
      const result = await api.databaseMigration.attachExistingDevelopmentNeon.mutate({
        pooledConnectionString: developmentPooledUrl,
        password: developmentPassword,
        confirmation: developmentConfirmation,
      });
      setDevelopmentMessage(result.message);
      setDevelopmentPooledUrl(''); setDevelopmentPassword(''); setDevelopmentConfirmation(''); setDevelopmentPreflight(null);
      setDevelopmentAttachStatus(await api.databaseMigration.developmentAttachStatus.query());
      onActivityChange?.();
    } catch (value: any) { setError(value?.message || 'Could not attach the existing Neon development database'); }
    finally { setBusy(null); }
  };

  const start = async () => {
    if (!preflight || confirmHost !== preflight.targetHost || busy) return;
    setBusy('start'); setError('');
    try {
      const result = await api.databaseMigration.start.mutate({ connectionString, password, confirmHost, overrideQuota });
      setJob(result); setConnectionString(''); setPassword(''); setConfirmHost(''); setPreflight(null); onActivityChange?.();
    } catch (value: any) { setError(value?.message || 'Could not start database migration'); }
    finally { setBusy(null); }
  };

  const cutover = async () => {
    if (!job || !pooledConnectionString || !cutoverPassword || busy) return;
    setBusy('cutover'); setError('');
    try {
      setJob(await api.databaseMigration.cutover.mutate({ jobId: job.id, pooledConnectionString, password: cutoverPassword }));
      setPooledConnectionString(''); onActivityChange?.();
    } catch (value: any) { setError(value?.message || 'Could not start guarded cutover'); }
    finally { setBusy(null); }
  };

  const returnLocal = async () => {
    if (!returnPassword || returnConfirmation !== 'RETURN TO LOCAL' || busy) return;
    setBusy('return'); setError('');
    try {
      setJob(await api.databaseMigration.returnToLocal.mutate({ password: returnPassword, confirmation: returnConfirmation }));
      setReturnConfirmation(''); onActivityChange?.();
    } catch (value: any) { setError(value?.message || 'Could not start the local PostgreSQL transfer'); }
    finally { setBusy(null); }
  };

  const unlock = async () => {
    if (!job || busy) return;
    setBusy('unlock'); setError('');
    try {
      setJob(await api.databaseMigration.cancelReady.mutate({ jobId: job.id, password: unlockPassword, confirmation: unlockConfirmation }));
      setUnlockPassword(''); setUnlockConfirmation(''); onActivityChange?.();
    } catch (value: any) { setError(value?.message || 'Could not unlock local PostgreSQL'); }
    finally { setBusy(null); }
  };

  const relevantActiveJob = !!job && job.maintenanceMode;
  const showNeonSetup = target === 'neon' && job?.currentProvider !== 'neon' && (!job || ['failed', 'cancelled'].includes(job.status));
  const showReturnSetup = target === 'local' && job?.currentProvider === 'neon' && (!relevantActiveJob || (job.direction === 'neon-to-local' && job.status === 'verification_failed'));
  const needsManualFinalize = !!job && job.maintenanceMode && ['cutover_pending', 'return_pending', 'verification_failed'].includes(job.status)
    && ((job.direction === 'neon-to-local' && job.currentProvider === 'local') || (job.direction !== 'neon-to-local' && job.currentProvider === 'neon'));

  return (
    <div style={{ border: '1px solid var(--border)', background: 'var(--bg-2)', borderRadius: 'var(--radius-lg)', padding: 18 }}>
      <div className="h-stack" style={{ gap: 10, alignItems: 'flex-start' }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent)', flexShrink: 0 }}><Icon icon="tabler:database" width={19} height={19} /></span>
        <div>
          <div style={{ color: 'var(--fg)', fontSize: 14, fontWeight: 650 }}>{target === 'neon' ? 'Transfer PostgreSQL to Neon' : 'Transfer Neon back to local PostgreSQL'}</div>
          <div style={{ color: 'var(--fg-2)', fontSize: 11.5, lineHeight: 1.55, marginTop: 3 }}>Superadmin-only. Site writes and background jobs remain locked until the destination restarts and passes every verification.</div>
        </div>
      </div>

      {job && (relevantActiveJob || (target === 'neon' && job.direction !== 'neon-to-local' && job.status === 'completed')) ? (
        <div style={{ marginTop: 15, padding: 13, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)' }}>
          <div className="h-stack" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ color: 'var(--fg)', fontSize: 12.5, fontWeight: 650 }}>{job.status.replaceAll('_', ' ')}</div>
            <div style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>{job.targetHost} · {formatBytes(job.estimatedBytes)}</div>
          </div>
          <div style={{ color: job.status.includes('failed') ? '#E0696B' : 'var(--fg-2)', fontSize: 11.5, lineHeight: 1.55, marginTop: 6 }}>{job.message}</div>
          {pollingStatuses.has(job.status) ? <div style={{ height: 4, marginTop: 10, borderRadius: 10, background: 'var(--bg-3)', overflow: 'hidden' }}><div className="bkemo-indeterminate" style={{ height: '100%', width: '38%', background: 'var(--accent)' }} /></div> : null}

          {job.status === 'ready' ? (
            <div style={{ marginTop: 12, display: 'grid', gap: 9 }}>
              {!job.cutoverHelperAvailable ? <div style={{ color: '#E0696B', fontSize: 11.5 }}>Install and start the guarded cutover helper before continuing.</div> : null}
              <label><span style={{ display: 'block', color: 'var(--fg)', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>Neon pooled connection URL</span><input type="password" style={inputStyle} value={pooledConnectionString} onChange={(e) => setPooledConnectionString(e.target.value)} placeholder="postgresql://…-pooler…neon.tech/…?sslmode=require" autoComplete="new-password" /></label>
              <label><span style={{ display: 'block', color: 'var(--fg)', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>Current superadmin password</span><input type="password" style={inputStyle} value={cutoverPassword} onChange={(e) => setCutoverPassword(e.target.value)} autoComplete="current-password" /></label>
              <button type="button" onClick={cutover} disabled={!!busy || !job.cutoverHelperAvailable || !pooledConnectionString || !cutoverPassword} style={{ minHeight: 40, border: 0, borderRadius: 'var(--radius)', background: 'var(--accent)', color: '#fff', fontWeight: 650, opacity: !job.cutoverHelperAvailable || !pooledConnectionString || !cutoverPassword ? .5 : 1 }}>{busy === 'cutover' ? 'Starting safe cutover…' : 'Run migrations, switch, restart, and verify'}</button>
            </div>
          ) : null}

          {job.status === 'verification_failed' && job.direction !== 'neon-to-local' && job.currentProvider === 'local' ? (
            <div style={{ marginTop: 12, display: 'grid', gap: 9 }}><label><span style={{ display: 'block', color: 'var(--fg)', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>Re-enter the matching Neon pooled connection URL</span><input type="password" style={inputStyle} value={pooledConnectionString} onChange={(e) => setPooledConnectionString(e.target.value)} autoComplete="new-password" /></label><label><span style={{ display: 'block', color: 'var(--fg)', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>Current superadmin password</span><input type="password" style={inputStyle} value={cutoverPassword} onChange={(e) => setCutoverPassword(e.target.value)} autoComplete="current-password" /></label><button type="button" onClick={cutover} disabled={!!busy || !pooledConnectionString || !cutoverPassword} style={{ minHeight: 40, border: 0, borderRadius: 'var(--radius)', background: 'var(--accent)', color: '#fff', fontWeight: 650, opacity: !pooledConnectionString || !cutoverPassword ? .5 : 1 }}>Retry guarded cutover</button></div>
          ) : null}

          {needsManualFinalize ? (
            <div style={{ marginTop: 12, padding: 11, borderRadius: 'var(--radius)', background: 'var(--accent-soft)' }}>
              <div style={{ color: 'var(--fg-2)', fontSize: 11.5, lineHeight: 1.5 }}>The destination is running but remains read-only. Re-enter your password to verify login data, notes, attachments, storage access, and reversible note creation.</div>
              <div className="h-stack" style={{ gap: 8, marginTop: 9, flexWrap: 'wrap' }}><input type="password" style={{ ...inputStyle, flex: '1 1 240px' }} value={cutoverPassword || returnPassword} onChange={(e) => job.direction === 'neon-to-local' ? setReturnPassword(e.target.value) : setCutoverPassword(e.target.value)} autoComplete="current-password" placeholder="Current superadmin password" /><button type="button" onClick={() => finalize()} disabled={!!busy || !(cutoverPassword || returnPassword)} style={{ minHeight: 40, padding: '8px 13px', border: 0, borderRadius: 'var(--radius)', background: 'var(--accent)', color: '#fff' }}>{busy === 'finalize' ? 'Verifying…' : 'Verify and unlock destination'}</button></div>
            </div>
          ) : null}

          {job.status === 'ready' ? <details style={{ marginTop: 11 }}><summary style={{ color: 'var(--fg-3)', fontSize: 11.5, cursor: 'pointer' }}>Cancel before cutover and unlock local PostgreSQL</summary><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 9, marginTop: 10 }}><input type="password" style={inputStyle} value={unlockPassword} onChange={(e) => setUnlockPassword(e.target.value)} placeholder="Current superadmin password" autoComplete="current-password" /><input style={inputStyle} value={unlockConfirmation} onChange={(e) => setUnlockConfirmation(e.target.value)} placeholder="Type UNLOCK LOCAL DATABASE" autoComplete="off" /></div><button type="button" onClick={unlock} disabled={busy === 'unlock' || !unlockPassword || unlockConfirmation !== 'UNLOCK LOCAL DATABASE'} style={{ marginTop: 9, minHeight: 36, padding: '7px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border-2)', background: 'var(--bg)', color: 'var(--fg)', opacity: !unlockPassword || unlockConfirmation !== 'UNLOCK LOCAL DATABASE' ? .5 : 1 }}>Unlock local database</button></details> : null}
        </div>
      ) : null}

      {showNeonSetup ? <div style={{ marginTop: 16 }}>
        <label style={{ display: 'block' }}><span style={{ display: 'block', color: 'var(--fg)', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Empty Neon direct connection URL</span><input type="password" style={inputStyle} value={connectionString} onChange={(e) => { setConnectionString(e.target.value); setPreflight(null); setError(''); }} placeholder="postgresql://…neon.tech/…?sslmode=require" autoComplete="new-password" spellCheck={false} /><span style={{ display: 'block', color: 'var(--fg-3)', fontSize: 11, lineHeight: 1.45, marginTop: 5 }}>Only Neon is accepted. The URL is used in memory for the verified copy and is never persisted.</span></label>
        <label style={{ display: 'block', marginTop: 12 }}><span style={{ display: 'block', color: 'var(--fg)', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Current superadmin password</span><input type="password" style={inputStyle} value={password} onChange={(e) => { setPassword(e.target.value); setPreflight(null); }} autoComplete="current-password" /></label>
        <div className="h-stack" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button type="button" onClick={runPreflight} disabled={!!busy || !connectionString || !password} style={{ minHeight: 38, padding: '8px 14px', borderRadius: 'var(--radius)', border: '1px solid var(--border-2)', background: 'var(--bg)', color: 'var(--fg)', opacity: busy || !connectionString || !password ? .5 : 1 }}>{busy === 'preflight' ? 'Checking…' : 'Check empty Neon destination'}</button></div>
        {preflight ? <div style={{ marginTop: 13, padding: 13, borderRadius: 'var(--radius)', border: '1px solid color-mix(in srgb, var(--accent) 55%, var(--border))', background: 'var(--accent-soft)' }}><div style={{ color: 'var(--fg)', fontSize: 12.5, fontWeight: 650 }}>Empty Neon destination verified</div><div style={{ color: 'var(--fg-2)', fontSize: 11.5, lineHeight: 1.6, marginTop: 6 }}>{preflight.sourceTableCount} tables · {formatBytes(preflight.sourceBytes)} source · about {formatBytes(preflight.estimatedBytes)} restored · PostgreSQL {preflight.targetPostgresVersion}</div>{preflight.quotaWarning ? <div style={{ color: '#E0A25F', fontSize: 11.5, marginTop: 7 }}>This approaches Neon’s 0.5 GB free limit.</div> : null}{preflight.quotaBlocked ? <label className="h-stack" style={{ gap: 8, marginTop: 9, color: 'var(--fg-2)', fontSize: 11.5 }}><input type="checkbox" checked={overrideQuota} onChange={(e) => setOverrideQuota(e.target.checked)} /> I understand the estimate exceeds 450 MiB</label> : null}<label style={{ display: 'block', marginTop: 10 }}><span style={{ display: 'block', color: 'var(--fg-2)', fontSize: 11.5, marginBottom: 5 }}>Type destination host to confirm: <code>{preflight.targetHost}</code></span><input style={inputStyle} value={confirmHost} onChange={(e) => setConfirmHost(e.target.value)} autoComplete="off" /></label><button type="button" onClick={start} disabled={!!busy || confirmHost !== preflight.targetHost || (preflight.quotaBlocked && !overrideQuota)} style={{ width: '100%', minHeight: 40, marginTop: 10, border: 0, borderRadius: 'var(--radius)', background: 'var(--accent)', color: '#fff', fontWeight: 650, opacity: confirmHost !== preflight.targetHost || (preflight.quotaBlocked && !overrideQuota) ? .5 : 1 }}>{busy === 'start' ? 'Starting…' : 'Lock writes and copy to Neon'}</button></div> : null}

        {developmentAttachStatus?.available ? <details style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 13 }}>
          <summary style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 650, cursor: 'pointer' }}>Development only: connect an existing Neon branch</summary>
          <div style={{ color: 'var(--fg-2)', fontSize: 11.5, lineHeight: 1.55, marginTop: 9 }}>This one-use local path verifies a compatible non-empty bkemo database and applies pending migrations. It never restores or merges data, and the production server rejects this operation unconditionally.</div>
          <label style={{ display: 'block', marginTop: 11 }}><span style={{ display: 'block', color: 'var(--fg)', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>Existing Neon pooled connection URL</span><input type="password" style={inputStyle} value={developmentPooledUrl} onChange={(event) => { setDevelopmentPooledUrl(event.target.value); setDevelopmentPreflight(null); setError(''); }} placeholder="postgresql://…-pooler…neon.tech/…?sslmode=require" autoComplete="new-password" /></label>
          <label style={{ display: 'block', marginTop: 9 }}><span style={{ display: 'block', color: 'var(--fg)', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>Current local superadmin password</span><input type="password" style={inputStyle} value={developmentPassword} onChange={(event) => { setDevelopmentPassword(event.target.value); setDevelopmentPreflight(null); }} autoComplete="current-password" /></label>
          <button type="button" onClick={preflightExistingDevelopmentNeon} disabled={!!busy || !developmentPooledUrl || !developmentPassword} style={{ width: '100%', minHeight: 38, marginTop: 10, borderRadius: 'var(--radius)', border: '1px solid var(--border-2)', background: 'var(--bg)', color: 'var(--fg)', opacity: !developmentPooledUrl || !developmentPassword ? .5 : 1 }}>{busy === 'dev-preflight' ? 'Inspecting…' : 'Inspect existing Neon branch'}</button>
          {developmentPreflight ? <div style={{ marginTop: 10, padding: 11, borderRadius: 'var(--radius)', background: 'var(--accent-soft)', border: '1px solid color-mix(in srgb, var(--accent) 55%, var(--border))' }}><div style={{ color: 'var(--fg)', fontSize: 12, fontWeight: 650 }}>Compatible non-empty bkemo database</div><div style={{ color: 'var(--fg-2)', fontSize: 11, lineHeight: 1.5, marginTop: 5 }}>{developmentPreflight.tableCount} tables · {developmentPreflight.accountCount} accounts · {developmentPreflight.superadminCount} superadmin</div><label style={{ display: 'block', marginTop: 9 }}><span style={{ display: 'block', color: 'var(--fg-2)', fontSize: 11, marginBottom: 5 }}>Type host/database to confirm: <code>{developmentPreflight.confirmation}</code></span><input style={inputStyle} value={developmentConfirmation} onChange={(event) => setDevelopmentConfirmation(event.target.value)} autoComplete="off" /></label><button type="button" onClick={attachExistingDevelopmentNeon} disabled={!!busy || developmentConfirmation !== developmentPreflight.confirmation} style={{ width: '100%', minHeight: 40, marginTop: 9, border: 0, borderRadius: 'var(--radius)', background: 'var(--accent)', color: '#fff', fontWeight: 650, opacity: developmentConfirmation !== developmentPreflight.confirmation ? .5 : 1 }}>{busy === 'dev-attach' ? 'Applying migrations and configuring…' : 'Configure once and require restart'}</button></div> : null}
        </details> : null}
        {developmentMessage ? <div style={{ marginTop: 12, padding: 11, borderRadius: 'var(--radius)', background: 'var(--accent-soft)', color: 'var(--fg)', fontSize: 11.5, lineHeight: 1.5 }}>{developmentMessage}</div> : null}
      </div> : null}

      {showReturnSetup ? <div style={{ marginTop: 16, padding: 13, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg)' }}><div style={{ color: 'var(--fg-2)', fontSize: 11.5, lineHeight: 1.6 }}>The helper will snapshot Neon, back up the retained local database, restore the current site into local PostgreSQL, restart bkemo, and keep both databases locked until verification passes.</div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 9, marginTop: 10 }}><input type="password" style={inputStyle} value={returnPassword} onChange={(e) => setReturnPassword(e.target.value)} placeholder="Current superadmin password" autoComplete="current-password" /><input style={inputStyle} value={returnConfirmation} onChange={(e) => setReturnConfirmation(e.target.value)} placeholder="Type RETURN TO LOCAL" autoComplete="off" /></div><button type="button" onClick={returnLocal} disabled={!!busy || returnConfirmation !== 'RETURN TO LOCAL' || !returnPassword || !job?.cutoverHelperAvailable} style={{ width: '100%', minHeight: 40, marginTop: 10, border: 0, borderRadius: 'var(--radius)', background: 'var(--accent)', color: '#fff', fontWeight: 650, opacity: returnConfirmation !== 'RETURN TO LOCAL' || !returnPassword || !job?.cutoverHelperAvailable ? .5 : 1 }}>{busy === 'return' ? 'Starting guarded return…' : 'Back up, transfer, restart, and verify'}</button></div> : null}

      {error ? <div style={{ marginTop: 12, color: '#E0696B', fontSize: 11.5, lineHeight: 1.5 }}>{error}</div> : null}
    </div>
  );
}
