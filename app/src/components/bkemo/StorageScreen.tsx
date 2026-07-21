import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/Common/Iconify/icons';
import { api } from '@/lib/trpc';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { UserStore } from '@/store/user';
import { DatabaseMigrationPanel } from './DatabaseMigrationPanel';

type Provider = 'local' | 's3';
type StorageForm = {
  provider: Provider;
  localCustomPath: string;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
  forcePathStyle: boolean;
};

type ConnectionState = {
  kind: 'success' | 'error';
  message: string;
  location?: string;
  freeBytes?: number;
} | null;

type StorageStats = {
  databaseBytes: number | null;
  totalCount: number;
  totalBytes: number;
  localCount: number;
  localBytes: number;
  s3Count: number;
  s3Bytes: number;
};

type MigrationJob = Awaited<ReturnType<typeof api.attachments.migrationStatus.query>>;
type StorageActivity = Awaited<ReturnType<typeof api.attachments.storageActivity.query>>;
type ActiveSetupVerification = Awaited<ReturnType<typeof api.config.verifyActiveSetup.mutate>>;
type ProviderPayload = { provider: 'local'; localCustomPath?: string } | {
  provider: 's3'; endpoint?: string; region: string; bucket: string; accessKeyId?: string;
  secretAccessKey?: string; prefix?: string; forcePathStyle?: boolean;
};
type SwitchOffer = {
  direction: 'local-to-s3' | 's3-to-local';
  count: number;
  bytes: number;
  previousPayload: ProviderPayload;
} | null;

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 40,
  padding: '9px 11px',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border-2)',
  background: 'var(--bg)',
  color: 'var(--fg)',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', minWidth: 0 }}>
      <span style={{ display: 'block', color: 'var(--fg)', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>{label}</span>
      {children}
      {hint ? <span style={{ display: 'block', color: 'var(--fg-3)', fontSize: 11, lineHeight: 1.45, marginTop: 5 }}>{hint}</span> : null}
    </label>
  );
}

function ProviderCard({
  active,
  selected,
  icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  selected: boolean;
  icon: string;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: 16,
        minHeight: 108,
        borderRadius: 'var(--radius-lg)',
        border: selected ? '1px solid var(--accent)' : '1px solid var(--border)',
        background: selected ? 'var(--accent-soft)' : 'var(--bg-2)',
        color: 'var(--fg)',
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <span style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: selected ? 'var(--accent)' : 'var(--bg-3)', color: selected ? '#fff' : 'var(--fg-2)', flexShrink: 0 }}>
        <Icon icon={icon} width={19} height={19} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
          <span style={{ fontSize: 14, fontWeight: 650 }}>{title}</span>
          {active ? <span style={{ padding: '2px 6px', borderRadius: 100, background: 'var(--accent)', color: '#fff', fontSize: 9, fontFamily: 'var(--font-mono)', letterSpacing: '.05em' }}>ACTIVE</span> : null}
        </span>
        <span style={{ display: 'block', color: 'var(--fg-2)', fontSize: 11.5, lineHeight: 1.5 }}>{description}</span>
      </span>
    </button>
  );
}

function formatBytes(value?: number) {
  if (!value || value < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

export const StorageScreen = observer(function StorageScreen() {
  const blinko = RootStore.Get(BlinkoStore);
  const user = RootStore.Get(UserStore);
  const config = (blinko.config.value ?? {}) as Record<string, any>;
  const activeProvider: Provider = config.objectStorage === 's3' ? 's3' : 'local';
  const [form, setForm] = useState<StorageForm>({
    provider: activeProvider,
    localCustomPath: '',
    endpoint: '',
    region: 'auto',
    bucket: '',
    accessKeyId: '',
    secretAccessKey: '',
    prefix: '',
    forcePathStyle: true,
  });
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [connection, setConnection] = useState<ConnectionState>(null);
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [migration, setMigration] = useState<MigrationJob>(null);
  const [activity, setActivity] = useState<StorageActivity | null>(null);
  const [selectedDatabase, setSelectedDatabase] = useState<'local' | 'neon' | null>(null);
  const [transferPanelRequested, setTransferPanelRequested] = useState(false);
  const [switchOffer, setSwitchOffer] = useState<SwitchOffer>(null);
  const [cleanupConfirmation, setCleanupConfirmation] = useState('');
  const [credentialConfirmation, setCredentialConfirmation] = useState('');
  const [migrationBusy, setMigrationBusy] = useState<'start' | 'retry' | 'cleanup' | 'cancel-switch' | null>(null);
  const [setupVerification, setSetupVerification] = useState<ActiveSetupVerification | null>(null);
  const [setupVerificationBusy, setSetupVerificationBusy] = useState(false);

  const loadStats = async () => {
    setStatsLoading(true);
    try {
      setStats(await api.attachments.storageStats.query());
    } catch {
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  };

  const loadActivity = async () => {
    try { setActivity(await api.attachments.storageActivity.query()); }
    catch { setActivity(null); }
  };

  const verifySetup = async () => {
    if (setupVerificationBusy) return;
    setSetupVerificationBusy(true);
    try {
      setSetupVerification(await api.config.verifyActiveSetup.mutate());
      await loadActivity();
    } catch (error: any) {
      setConnection({ kind: 'error', message: error?.message || 'Could not verify the active setup' });
    } finally {
      setSetupVerificationBusy(false);
    }
  };

  useEffect(() => {
    if (!blinko.config.value) {
      blinko.config.call();
      return;
    }
    setForm({
      provider: activeProvider,
      localCustomPath: config.localCustomPath ?? '',
      endpoint: config.s3Endpoint ?? '',
      region: config.s3Region || 'auto',
      bucket: config.s3Bucket ?? '',
      accessKeyId: config.s3AccessKeyIdMasked ?? '',
      secretAccessKey: config.s3SecretAccessKeyMasked ?? '',
      prefix: config.s3CustomPath ?? '',
      forcePathStyle: config.s3ForcePathStyle !== false,
    });
    loadStats();
    loadActivity();
    api.attachments.migrationStatus.query().then(setMigration).catch(() => undefined);
  }, [blinko.config.value]);

  useEffect(() => {
    if (!migration || !['queued', 'running'].includes(migration.status) && migration.cleanupStatus !== 'running') return;
    const timer = window.setInterval(async () => {
      const next = await api.attachments.migrationStatus.query({ jobId: migration.id }).catch(() => null);
      if (next) {
        setMigration(next);
        if (!['queued', 'running'].includes(next.status) && next.cleanupStatus !== 'running') {
          await Promise.all([loadStats(), loadActivity()]);
          if (!next.failed) setTransferPanelRequested(false);
        }
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [migration?.id, migration?.status, migration?.cleanupStatus]);

  useEffect(() => {
    if (!activity) return;
    const activeDatabaseTransfer = activity.records.find((record) => record.category === 'database-transfer' && !['completed', 'cancelled', 'failed'].includes(record.status));
    if (activeDatabaseTransfer) {
      setSelectedDatabase(activeDatabaseTransfer.destination === 'neon' ? 'neon' : 'local');
    } else {
      setSelectedDatabase((current) => current ?? activity.database.provider);
    }
  }, [activity]);

  const payload = useMemo(() => form.provider === 'local' ? {
    provider: 'local' as const,
    localCustomPath: form.localCustomPath,
  } : {
    provider: 's3' as const,
    endpoint: form.endpoint,
    region: form.region,
    bucket: form.bucket,
    accessKeyId: form.accessKeyId === config.s3AccessKeyIdMasked ? '' : form.accessKeyId,
    secretAccessKey: form.secretAccessKey === config.s3SecretAccessKeyMasked ? '' : form.secretAccessKey,
    prefix: form.prefix,
    forcePathStyle: form.forcePathStyle,
  }, [form]);

  const activePayload = useMemo<ProviderPayload>(() => activeProvider === 'local' ? {
    provider: 'local', localCustomPath: config.localCustomPath ?? '',
  } : {
    provider: 's3', endpoint: config.s3Endpoint ?? '', region: config.s3Region || 'auto', bucket: config.s3Bucket ?? '',
    accessKeyId: '', secretAccessKey: '', prefix: config.s3CustomPath ?? '',
    forcePathStyle: config.s3ForcePathStyle !== false,
  }, [activeProvider, blinko.config.value]);

  const canSubmit = form.provider === 'local' || (!!form.region.trim() && !!form.bucket.trim());
  const update = <K extends keyof StorageForm,>(key: K, value: StorageForm[K]) => {
    setConnection(null);
    setForm((current) => ({ ...current, [key]: value }));
  };

  const selectAttachmentProvider = (provider: Provider) => {
    setConnection(null);
    if (provider === activeProvider) {
      setSwitchOffer(null);
      setTransferPanelRequested(false);
    }
    if (provider !== activeProvider) setTransferPanelRequested(true);
    setForm((current) => ({ ...current, provider }));
  };

  const run = async (action: 'test' | 'save') => {
    if (busy || !canSubmit) return;
    setBusy(action);
    setConnection(null);
    try {
      const previousProvider = activeProvider;
      const previousPayload = activePayload;
      const previousStats = stats;
      const result = action === 'test'
        ? await api.config.testStorage.mutate(payload)
        : await api.config.saveStorage.mutate(payload);
      setConnection({ kind: 'success', message: action === 'save' ? `${result.message}. Storage provider activated.` : result.message, location: result.location, freeBytes: result.freeBytes });
      if (action === 'save') {
        await blinko.config.call();
        await Promise.all([loadStats(), loadActivity()]);
        if (previousProvider !== form.provider && previousStats) {
          const direction = form.provider === 's3' ? 'local-to-s3' : 's3-to-local';
          const count = direction === 'local-to-s3' ? previousStats.localCount : previousStats.s3Count;
          const bytes = direction === 'local-to-s3' ? previousStats.localBytes : previousStats.s3Bytes;
          if (count) {
            setSwitchOffer({ direction, count, bytes, previousPayload });
            setTransferPanelRequested(true);
          }
        }
      }
    } catch (error: any) {
      setConnection({ kind: 'error', message: error?.message || 'Storage connection failed' });
    } finally {
      setBusy(null);
    }
  };

  const startMigration = async (direction: 'local-to-s3' | 's3-to-local') => {
    setMigrationBusy('start');
    try {
      setMigration(await api.attachments.startStorageMigration.mutate({ direction }));
      setSwitchOffer(null);
      setTransferPanelRequested(true);
      await loadActivity();
    } catch (error: any) {
      setConnection({ kind: 'error', message: error?.message || 'Could not start attachment migration' });
    } finally { setMigrationBusy(null); }
  };

  const retryMigration = async () => {
    if (!migration) return;
    setMigrationBusy('retry');
    try { setMigration(await api.attachments.retryStorageMigration.mutate({ jobId: migration.id })); setTransferPanelRequested(true); }
    catch (error: any) { setConnection({ kind: 'error', message: error?.message || 'Could not retry migration' }); }
    finally { setMigrationBusy(null); }
  };

  const cleanupSources = async () => {
    if (!migration) return;
    setMigrationBusy('cleanup');
    try {
      setMigration(await api.attachments.cleanupStorageMigrationSources.mutate({ jobId: migration.id, confirmation: cleanupConfirmation }));
      setCleanupConfirmation('');
    } catch (error: any) { setConnection({ kind: 'error', message: error?.message || 'Could not clean up originals' }); }
    finally { setMigrationBusy(null); }
  };

  const availableDirection = activeProvider === 's3' ? 'local-to-s3' as const : 's3-to-local' as const;
  const availableCount = activeProvider === 's3' ? stats?.localCount ?? 0 : stats?.s3Count ?? 0;
  const migrationRunning = !!migration && ['queued', 'running'].includes(migration.status);

  const cancelProviderSwitch = async () => {
    if (!switchOffer) return;
    setMigrationBusy('cancel-switch');
    try {
      await api.config.saveStorage.mutate(switchOffer.previousPayload);
      setSwitchOffer(null);
      setTransferPanelRequested(false);
      await blinko.config.call();
      await Promise.all([loadStats(), loadActivity()]);
    } finally {
      setMigrationBusy(null);
    }
  };

  const removeStoredCredentials = async () => {
    if (credentialConfirmation !== 'REMOVE S3 CREDENTIALS') return;
    setBusy('save'); setConnection(null);
    try {
      await api.config.removeStorageCredentials.mutate({ confirmation: 'REMOVE S3 CREDENTIALS' });
      setCredentialConfirmation('');
      await Promise.all([blinko.config.call(), loadActivity()]);
      setConnection({ kind: 'success', message: 'Saved S3 credentials removed' });
    } catch (error: any) {
      setConnection({ kind: 'error', message: error?.message || 'Could not remove saved credentials' });
    } finally { setBusy(null); }
  };

  const databaseProvider = activity?.database.provider ?? 'local';
  const chosenDatabase = selectedDatabase ?? databaseProvider;
  const showTransferPanel = transferPanelRequested || !!switchOffer || migrationRunning || (!!migration && migration.failed > 0);
  const providerSelectionPending = form.provider !== activeProvider;
  const lastSelectedProviderCheck = activity?.records.find((record) => record.category === 'attachment-provider' && record.destination === form.provider && record.status === 'completed');

  const openTransferRecord = async (recordId: string) => {
    if (!recordId.startsWith('attachment:')) return;
    const jobId = recordId.slice('attachment:'.length);
    const selected = await api.attachments.migrationStatus.query({ jobId }).catch(() => null);
    if (selected) {
      setMigration(selected);
      setTransferPanelRequested(true);
    }
  };

  return (
    <div className="v-stack" style={{ gap: 22 }}>
      <div className="h-stack" style={{ justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 600, color: 'var(--fg)', letterSpacing: '-0.02em', margin: 0 }}>Storage</h2>
          <div style={{ color: 'var(--fg-2)', fontSize: 13, marginTop: 4, lineHeight: 1.55 }}>PostgreSQL stores site state and text. Attachment binaries are stored separately on the selected file provider.</div>
        </div>
        {user.isSuperAdmin ? <button type="button" onClick={verifySetup} disabled={setupVerificationBusy} style={{ minHeight: 38, padding: '8px 14px', borderRadius: 'var(--radius)', border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--fg)', opacity: setupVerificationBusy ? .6 : 1, fontFamily: 'inherit', fontSize: 12.5, cursor: setupVerificationBusy ? 'wait' : 'pointer' }}><span className="h-stack" style={{ gap: 7 }}><Icon icon="solar:shield-check-bold" width={16} height={16} />{setupVerificationBusy ? 'Verifying…' : 'Verify active setup'}</span></button> : null}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
        <div style={{ border: '1px solid var(--border)', background: 'var(--bg-2)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
          <div className="h-stack" style={{ gap: 10, marginBottom: 9 }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon icon="tabler:database" width={18} height={18} /></span>
            <div><div style={{ color: 'var(--fg)', fontSize: 13.5, fontWeight: 650 }}>Site database</div><div style={{ color: 'var(--fg-3)', fontSize: 10.5 }}>{databaseProvider === 'neon' ? `Neon PostgreSQL${activity?.database.pooled ? ' · pooled' : ''}` : 'Local PostgreSQL'} · active</div></div>
          </div>
          <div style={{ color: 'var(--fg-2)', fontSize: 11.5, lineHeight: 1.55 }}>Accounts, configuration, memo text, task state, sharing records, and attachment metadata. Memo attachment bytes are never written to PostgreSQL.</div>
          <div style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 10.5, marginTop: 9 }}>{statsLoading ? 'Measuring…' : stats?.databaseBytes != null ? `${formatBytes(stats.databaseBytes)} database size` : 'Database size unavailable'}</div>
        </div>
        <div style={{ border: '1px solid var(--border)', background: 'var(--bg-2)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
          <div className="h-stack" style={{ gap: 10, marginBottom: 9 }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon icon="tabler:cloud-network" width={18} height={18} /></span>
            <div><div style={{ color: 'var(--fg)', fontSize: 13.5, fontWeight: 650 }}>Attachments</div><div style={{ color: 'var(--fg-3)', fontSize: 10.5 }}>{activeProvider === 's3' ? 'S3-compatible / R2 · active' : 'Local filesystem · active'}</div></div>
          </div>
          <div style={{ color: 'var(--fg-2)', fontSize: 11.5, lineHeight: 1.55 }}>Images, PDFs, audio, video, archives, and other uploaded files. PostgreSQL keeps only the object path, filename, size, MIME type, owner, and note relationship.</div>
          <div style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 10.5, marginTop: 9 }}>{statsLoading ? 'Measuring…' : stats ? `${stats.totalCount} files · ${formatBytes(stats.totalBytes) || '0 B'}` : 'Attachment totals unavailable'}</div>
        </div>
      </div>

      {setupVerification ? <div style={{ border: `1px solid ${setupVerification.ok ? 'color-mix(in srgb, var(--accent) 55%, var(--border))' : '#E0A25F'}`, background: setupVerification.ok ? 'var(--accent-soft)' : 'rgba(224,162,95,.08)', borderRadius: 'var(--radius-lg)', padding: 15 }}>
        <div className="h-stack" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}><div style={{ color: 'var(--fg)', fontSize: 13, fontWeight: 650 }}>{setupVerification.ok ? 'Active setup is healthy' : 'Active setup needs attention'}</div><div style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 9.5 }}>{new Date(setupVerification.verifiedAt).toLocaleString()}</div></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 9, marginTop: 10 }}>
          {[{ label: 'Database', result: setupVerification.database }, { label: 'Attachments', result: setupVerification.attachments }].map(({ label, result }) => <div key={label} style={{ border: '1px solid var(--border)', background: 'var(--bg-2)', borderRadius: 'var(--radius)', padding: 11 }}>
            <div className="h-stack" style={{ justifyContent: 'space-between', gap: 8 }}><span style={{ color: 'var(--fg)', fontSize: 11.5, fontWeight: 650 }}>{label} · {result.provider}</span><span style={{ color: result.ok ? 'var(--accent)' : '#E0696B', fontSize: 10, fontFamily: 'var(--font-mono)' }}>{result.ok ? 'HEALTHY' : 'FAILED'}</span></div>
            <div style={{ color: result.ok ? 'var(--fg-2)' : '#E0696B', fontSize: 11, lineHeight: 1.45, marginTop: 5 }}>{result.message}</div>
            <div style={{ color: 'var(--fg-3)', fontSize: 9.5, fontFamily: 'var(--font-mono)', marginTop: 5 }}>{'host' in result && result.host ? result.host : 'location' in result && result.location ? result.location : 'Active provider'} · {result.latencyMs} ms</div>
          </div>)}
        </div>
      </div> : null}

      {user.isSuperAdmin ? <div>
        <div style={{ color: 'var(--fg-3)', fontSize: 10.5, fontFamily: 'var(--font-mono)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>Site database plan</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
          <ProviderCard active={databaseProvider === 'local'} selected={chosenDatabase === 'local'} icon="tabler:database" title="Local PostgreSQL" description="Keep site configuration, accounts, memo text, and metadata in the server’s retained PostgreSQL database." onClick={() => setSelectedDatabase('local')} />
          <ProviderCard active={databaseProvider === 'neon'} selected={chosenDatabase === 'neon'} icon="tabler:cloud-network" title="Neon PostgreSQL" description="Use a Neon direct connection for migration and its pooled connection for the production application." onClick={() => setSelectedDatabase('neon')} />
        </div>
      </div> : null}

      {user.isSuperAdmin && chosenDatabase !== databaseProvider ? <DatabaseMigrationPanel target={chosenDatabase} onActivityChange={loadActivity} /> : null}

      <div>
        <div style={{ color: 'var(--fg-3)', fontSize: 10.5, fontFamily: 'var(--font-mono)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>Attachment storage plan</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
        <ProviderCard
          active={activeProvider === 'local'}
          selected={form.provider === 'local'}
          icon="tabler:cards"
          title="Local filesystem"
          description="Keep binary files in bkemo’s managed uploads directory. PostgreSQL still stores only their metadata."
          onClick={() => selectAttachmentProvider('local')}
        />
        <ProviderCard
          active={activeProvider === 's3'}
          selected={form.provider === 's3'}
          icon="tabler:cloud-network"
          title="S3-compatible"
          description="Connect AWS S3, Cloudflare R2, MinIO, Backblaze B2, or another S3-compatible bucket."
          onClick={() => selectAttachmentProvider('s3')}
        />
        </div>
      </div>

      <div style={{ border: '1px solid var(--border)', background: 'var(--bg-2)', borderRadius: 'var(--radius-lg)', padding: 18 }}>
        <div className="h-stack" style={{ gap: 10, marginBottom: 18 }}>
          <Icon icon={form.provider === 'local' ? 'tabler:cards' : 'tabler:cloud-network'} width={19} height={19} style={{ color: 'var(--accent)' }} />
          <div>
            <div className="h-stack" style={{ gap: 8, color: 'var(--fg)', fontSize: 14, fontWeight: 650 }}>{form.provider === 'local' ? 'Local connection' : 'S3 connection'}{form.provider === activeProvider ? <span style={{ padding: '2px 7px', borderRadius: 100, background: 'var(--accent)', color: '#fff', fontSize: 9, fontFamily: 'var(--font-mono)', letterSpacing: '.05em' }}>{form.provider === 's3' ? 'USING S3/R2' : 'USING LOCAL'}</span> : null}</div>
            <div style={{ color: 'var(--fg-3)', fontSize: 11.5, marginTop: 2 }}>{form.provider === 'local' ? 'The server will verify that this folder can be written and read.' : 'The test creates, reads, and removes one small temporary object.'}</div>
            {lastSelectedProviderCheck ? <div style={{ color: 'var(--fg-3)', fontSize: 10, fontFamily: 'var(--font-mono)', marginTop: 3 }}>Last verified {new Date(lastSelectedProviderCheck.createdAt).toLocaleString()}</div> : null}
          </div>
        </div>

        {form.provider === 'local' ? (
          <Field label="Attachment folder" hint="Relative to bkemo’s managed upload directory. Leave blank to use the default root; absolute paths and parent traversal are rejected.">
            <input style={inputStyle} value={form.localCustomPath} onChange={(event) => update('localCustomPath', event.target.value)} placeholder="attachments" autoComplete="off" />
          </Field>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '15px 12px' }} className="bkemo-storage-grid">
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Endpoint" hint="For R2 use https://<ACCOUNT_ID>.r2.cloudflarestorage.com. If a pasted R2 URL ends in /<bucket>, bkemo removes that duplicate bucket path safely.">
                <input style={inputStyle} value={form.endpoint} onChange={(event) => update('endpoint', event.target.value)} placeholder="https://ACCOUNT_ID.r2.cloudflarestorage.com" inputMode="url" autoComplete="off" />
              </Field>
            </div>
            <Field label="Region" hint="Cloudflare R2 uses auto. AWS and other providers use their normal region code.">
              <input style={inputStyle} value={form.region} onChange={(event) => update('region', event.target.value)} placeholder="auto" autoComplete="off" />
            </Field>
            <Field label="Bucket">
              <input style={inputStyle} value={form.bucket} onChange={(event) => update('bucket', event.target.value)} placeholder="bkemo-files" autoComplete="off" />
            </Field>
            <Field label="Access key ID" hint={config.s3CredentialsConfigured ? 'Masked saved key. Leave it unchanged to keep the stored credential.' : 'Enter the access key ID and secret together.'}>
              <input style={inputStyle} value={form.accessKeyId} onChange={(event) => update('accessKeyId', event.target.value)} placeholder="Access key ID" autoComplete="off" spellCheck={false} />
            </Field>
            <Field label="Secret access key">
              <div style={{ position: 'relative' }}>
                <input style={{ ...inputStyle, paddingRight: 40 }} type={showSecret ? 'text' : 'password'} value={form.secretAccessKey} onChange={(event) => update('secretAccessKey', event.target.value)} placeholder="Secret access key" autoComplete="new-password" spellCheck={false} />
                <button type="button" onClick={() => setShowSecret((value) => !value)} aria-label={showSecret ? 'Hide secret' : 'Show secret'} style={{ position: 'absolute', right: 7, top: 7, width: 28, height: 28, display: 'grid', placeItems: 'center', border: 0, background: 'transparent', color: 'var(--fg-3)', cursor: 'pointer' }}>
                  <Icon icon="tabler:eye" width={16} height={16} />
                </button>
              </div>
            </Field>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Folder prefix" hint="Optional folder inside the bucket, for example bkemo/production.">
                <input style={inputStyle} value={form.prefix} onChange={(event) => update('prefix', event.target.value)} placeholder="bkemo" autoComplete="off" />
              </Field>
            </div>
            <label className="h-stack" style={{ gridColumn: '1 / -1', gap: 10, color: 'var(--fg-2)', fontSize: 12.5, cursor: 'pointer', width: 'fit-content' }}>
              <input type="checkbox" checked={form.forcePathStyle} onChange={(event) => update('forcePathStyle', event.target.checked)} style={{ accentColor: 'var(--accent)', width: 15, height: 15 }} />
              Use path-style URLs <span style={{ color: 'var(--fg-3)' }}>(recommended for MinIO, R2, and many compatible providers)</span>
            </label>
            {config.s3CredentialsConfigured ? <details style={{ gridColumn: '1 / -1' }}><summary style={{ color: 'var(--fg-3)', fontSize: 11.5, cursor: 'pointer' }}>Remove saved credentials</summary><div className="h-stack" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}><input style={{ ...inputStyle, flex: '1 1 260px' }} value={credentialConfirmation} onChange={(event) => setCredentialConfirmation(event.target.value)} placeholder="Type REMOVE S3 CREDENTIALS" autoComplete="off" /><button type="button" onClick={removeStoredCredentials} disabled={activeProvider === 's3' || credentialConfirmation !== 'REMOVE S3 CREDENTIALS' || !!busy} style={{ minHeight: 40, padding: '8px 12px', borderRadius: 'var(--radius)', border: '1px solid #E0696B', background: 'transparent', color: '#E0696B', opacity: activeProvider === 's3' || credentialConfirmation !== 'REMOVE S3 CREDENTIALS' ? .5 : 1 }}>Remove credentials</button></div>{activeProvider === 's3' ? <div style={{ color: 'var(--fg-3)', fontSize: 10.5, marginTop: 5 }}>Switch to local attachments before removing credentials used by the active provider.</div> : null}</details> : null}
          </div>
        )}

        {connection ? (
          <div style={{ marginTop: 16, borderRadius: 'var(--radius)', border: `1px solid ${connection.kind === 'success' ? 'color-mix(in srgb, var(--accent) 55%, var(--border))' : '#E0696B'}`, background: connection.kind === 'success' ? 'var(--accent-soft)' : 'rgba(224,105,107,.08)', padding: '11px 12px', color: connection.kind === 'success' ? 'var(--fg)' : '#E0696B', fontSize: 12.5, lineHeight: 1.5 }}>
            <div className="h-stack" style={{ gap: 7 }}>
              <Icon icon="tabler:info-circle" width={17} height={17} />
              <span style={{ fontWeight: 600 }}>{connection.message}</span>
            </div>
            {connection.location ? <div style={{ color: 'var(--fg-2)', marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>{connection.location}{connection.freeBytes ? ` · ${formatBytes(connection.freeBytes)} free` : ''}</div> : null}
          </div>
        ) : null}

        <div className="h-stack" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
          <button type="button" disabled={!!busy || !canSubmit} onClick={() => run('test')} style={{ minHeight: 38, padding: '8px 14px', borderRadius: 'var(--radius)', border: '1px solid var(--border-2)', background: 'var(--bg)', color: 'var(--fg)', cursor: busy || !canSubmit ? 'not-allowed' : 'pointer', opacity: busy || !canSubmit ? .55 : 1, fontFamily: 'inherit', fontSize: 12.5 }}>
            {busy === 'test' ? 'Testing…' : 'Test connection'}
          </button>
          <button type="button" disabled={!!busy || !canSubmit} onClick={() => run('save')} style={{ minHeight: 38, padding: '8px 16px', borderRadius: 'var(--radius)', border: 0, background: 'var(--accent)', color: '#fff', cursor: busy || !canSubmit ? 'not-allowed' : 'pointer', opacity: busy || !canSubmit ? .55 : 1, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600 }}>
            {busy === 'save' ? 'Connecting…' : `Save & use ${form.provider === 'local' ? 'local' : 'S3'}`}
          </button>
        </div>
      </div>

      {showTransferPanel ? <div style={{ border: '1px solid var(--border)', background: 'var(--bg-2)', borderRadius: 'var(--radius-lg)', padding: 18 }}>
        <div className="h-stack" style={{ justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div className="h-stack" style={{ gap: 8, color: 'var(--fg)', fontSize: 14, fontWeight: 650 }}><Icon icon="material-symbols:settings-backup-restore-rounded" width={18} height={18} style={{ color: 'var(--accent)' }} />Attachment transfer service</div>
            <div style={{ color: 'var(--fg-2)', fontSize: 11.5, lineHeight: 1.55, marginTop: 6, maxWidth: 650 }}>A resumable server job copies and verifies every binary, then points its stable attachment URL at the new provider. Originals are retained until you explicitly clean them up.</div>
          </div>
          <div style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 10.5, whiteSpace: 'nowrap' }}>{statsLoading ? 'Measuring…' : stats ? `${stats.localCount} local (${formatBytes(stats.localBytes) || '0 B'}) · ${stats.s3Count} cloud (${formatBytes(stats.s3Bytes) || '0 B'})` : 'Totals unavailable'}</div>
        </div>

        {migration && !providerSelectionPending ? (
          <div style={{ marginTop: 14, borderRadius: 'var(--radius)', border: `1px solid ${migration.failed ? '#E0A25F' : 'var(--border)'}`, background: migration.failed ? 'rgba(224,162,95,.08)' : 'var(--bg)', padding: '12px', color: 'var(--fg-2)', fontSize: 11.5, lineHeight: 1.5 }}>
            <div className="h-stack" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ color: 'var(--fg)', fontWeight: 600 }}>{migration.direction === 'local-to-s3' ? 'Local → S3/R2' : 'S3/R2 → local'} · {migration.status.replaceAll('_', ' ')}</div>
              <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>{migration.migrated + migration.skipped}/{migration.totalCount} · {formatBytes(migration.migratedBytes) || '0 B'}</div>
            </div>
            <div style={{ height: 5, marginTop: 9, borderRadius: 10, background: 'var(--bg-3)', overflow: 'hidden' }}><div style={{ width: `${migration.totalCount ? Math.min(100, Math.round((migration.processed / migration.totalCount) * 100)) : 100}%`, height: '100%', background: 'var(--accent)', transition: 'width .2s ease' }} /></div>
            {migration.errorMessage ? <div style={{ color: '#E0696B', marginTop: 7 }}>{migration.errorMessage}</div> : null}
            {migration.skipped ? <div style={{ marginTop: 7, color: 'var(--fg-3)' }}>{migration.skipped} stale transfer record{migration.skipped === 1 ? '' : 's'} skipped because its attachment metadata was already deleted.</div> : null}
            {migration.errors.length ? <div style={{ marginTop: 7, color: '#E0A25F' }}>{migration.failed} failed: {migration.errors.slice(0, 3).map((item) => `${item.name}: ${item.message}`).join(' · ')}</div> : null}
            {migration.cleanupStatus !== 'idle' ? <div style={{ marginTop: 7 }}>{migration.cleanupDeleted} verified originals deleted{migration.cleanupFailed ? ` · ${migration.cleanupFailed} cleanup failures` : ''} · cleanup {migration.cleanupStatus}</div> : null}
            {migration.failed && !migrationRunning ? <button type="button" onClick={retryMigration} disabled={!!migrationBusy} style={{ marginTop: 10, minHeight: 34, padding: '6px 11px', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', background: 'var(--bg)', color: 'var(--fg)' }}>{migrationBusy === 'retry' ? 'Retrying…' : `Retry ${migration.failed} failed files`}</button> : null}
            {!migrationRunning && migration.migrated > migration.cleanupDeleted && user.isSuperAdmin ? (
              <details style={{ marginTop: 10 }}>
                <summary style={{ color: 'var(--fg-3)', cursor: 'pointer' }}>Delete verified originals</summary>
                <div className="h-stack" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <input style={{ ...inputStyle, flex: '1 1 260px' }} value={cleanupConfirmation} onChange={(e) => setCleanupConfirmation(e.target.value)} placeholder="Type DELETE VERIFIED ORIGINALS" autoComplete="off" />
                  <button type="button" onClick={cleanupSources} disabled={cleanupConfirmation !== 'DELETE VERIFIED ORIGINALS' || !!migrationBusy} style={{ minHeight: 40, padding: '8px 12px', border: '1px solid #E0696B', borderRadius: 'var(--radius)', background: 'transparent', color: '#E0696B', opacity: cleanupConfirmation !== 'DELETE VERIFIED ORIGINALS' ? .5 : 1 }}>Delete originals</button>
                </div>
              </details>
            ) : null}
          </div>
        ) : null}

        <div className="h-stack" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" disabled={providerSelectionPending || !availableCount || migrationRunning || !!migrationBusy} onClick={() => startMigration(availableDirection)} style={{ minHeight: 38, padding: '8px 15px', borderRadius: 'var(--radius)', border: 0, background: 'var(--accent)', color: '#fff', cursor: providerSelectionPending || !availableCount || migrationRunning ? 'not-allowed' : 'pointer', opacity: providerSelectionPending || !availableCount || migrationRunning ? .5 : 1, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600 }}>
            {providerSelectionPending ? `Save & use ${form.provider === 's3' ? 'S3/R2' : 'local storage'} above to continue` : migrationRunning ? 'Transfer running on server…' : availableCount ? `${activeProvider === 's3' ? 'Upload' : 'Download'} ${availableCount} existing attachments` : `All attachments are ${activeProvider === 's3' ? 'in S3/R2' : 'local'}`}
          </button>
        </div>
      </div> : null}

      <div style={{ color: 'var(--fg-3)', fontSize: 11.5, lineHeight: 1.55 }}>
        Provider changes affect new uploads immediately. Existing physical paths remain readable during a mixed-storage migration; public attachment links stay stable.
      </div>

      <div style={{ border: '1px solid var(--border)', background: 'var(--bg-2)', borderRadius: 'var(--radius-lg)', padding: 18 }}>
        <div className="h-stack" style={{ justifyContent: 'space-between', gap: 10, marginBottom: 12 }}><div className="h-stack" style={{ gap: 8, color: 'var(--fg)', fontSize: 14, fontWeight: 650 }}><Icon icon="tabler:clock" width={18} height={18} style={{ color: 'var(--accent)' }} />Storage activity</div><button type="button" onClick={loadActivity} style={{ border: 0, background: 'transparent', color: 'var(--fg-3)', fontSize: 11, cursor: 'pointer' }}>Refresh</button></div>
        {!activity?.records.length ? <div style={{ color: 'var(--fg-3)', fontSize: 11.5 }}>No storage activity has been recorded yet.</div> : <div className="v-stack" style={{ gap: 0, maxHeight: 420, overflow: 'auto' }}>
          {activity.records.map((record) => <div key={record.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(130px, .7fr) minmax(180px, 1.7fr) auto', gap: 12, alignItems: 'center', padding: '10px 2px', borderTop: '1px solid var(--border)', contentVisibility: 'auto', containIntrinsicSize: '56px' }} className="bkemo-storage-activity-row">
            <div><div style={{ color: 'var(--fg)', fontSize: 11.5, fontWeight: 600 }}>{record.action.replaceAll('-', ' → ')}</div><div style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 9.5, marginTop: 3 }}>{new Date(record.createdAt).toLocaleString()}</div></div>
            <div style={{ color: record.status.includes('failed') ? '#E0696B' : 'var(--fg-2)', fontSize: 11.5, lineHeight: 1.45 }}>{record.summary}</div>
            <div className="h-stack" style={{ gap: 7, justifyContent: 'flex-end' }}><span style={{ padding: '3px 7px', borderRadius: 100, background: record.status === 'completed' ? 'var(--accent-soft)' : 'var(--bg-3)', color: record.status.includes('failed') ? '#E0696B' : 'var(--fg-2)', fontSize: 9.5, fontFamily: 'var(--font-mono)' }}>{record.status.replaceAll('_', ' ')}</span>{record.id.startsWith('attachment:') ? <button type="button" onClick={() => openTransferRecord(record.id)} style={{ border: 0, background: 'transparent', color: 'var(--accent)', fontSize: 10.5, cursor: 'pointer' }}>Manage</button> : null}</div>
          </div>)}
        </div>}
      </div>

      {switchOffer ? (
        <div role="dialog" aria-modal="true" aria-label="Move existing attachments" style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,.62)', display: 'grid', placeItems: 'center', padding: 18 }}>
          <div style={{ width: 'min(500px, 100%)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-2)', background: 'var(--bg-2)', boxShadow: '0 24px 80px rgba(0,0,0,.45)', padding: 20 }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon icon={switchOffer.direction === 'local-to-s3' ? 'tabler:upload' : 'tabler:download'} width={21} height={21} /></div>
            <h3 style={{ margin: '13px 0 5px', color: 'var(--fg)', fontSize: 18, fontWeight: 650 }}>{switchOffer.direction === 'local-to-s3' ? 'Upload existing attachments?' : 'Download existing attachments?'}</h3>
            <div style={{ color: 'var(--fg-2)', fontSize: 12.5, lineHeight: 1.6 }}>{switchOffer.count} files ({formatBytes(switchOffer.bytes) || '0 B'}) are still on {switchOffer.direction === 'local-to-s3' ? 'the local server' : 'S3/R2'}. Copying runs on the server and continues if you close this page. Originals are retained.</div>
            <div className="h-stack" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
              <button type="button" onClick={cancelProviderSwitch} disabled={!!migrationBusy} style={{ minHeight: 38, padding: '8px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border-2)', background: 'transparent', color: 'var(--fg-2)' }}>{migrationBusy === 'cancel-switch' ? 'Reverting…' : 'Cancel switch'}</button>
              <button type="button" onClick={() => { setSwitchOffer(null); setTransferPanelRequested(false); }} disabled={!!migrationBusy} style={{ minHeight: 38, padding: '8px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border-2)', background: 'var(--bg)', color: 'var(--fg)' }}>Later</button>
              <button type="button" onClick={() => startMigration(switchOffer.direction)} disabled={!!migrationBusy} style={{ minHeight: 38, padding: '8px 14px', borderRadius: 'var(--radius)', border: 0, background: 'var(--accent)', color: '#fff', fontWeight: 650 }}>{migrationBusy === 'start' ? 'Starting…' : switchOffer.direction === 'local-to-s3' ? 'Upload now' : 'Download now'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
});
