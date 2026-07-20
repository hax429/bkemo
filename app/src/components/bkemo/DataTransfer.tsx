import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/trpc';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';
import { downloadFromLink } from '@/lib/tauriHelper';
import { UploadFileWrapper } from '@/components/Common/UploadFile';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';
import { ToastPlugin } from '@/store/module/Toast/Toast';

type Format = 'markdown' | 'json' | 'bk';
type Tab = 'import' | 'export';

const card: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-2)', padding: 16 };
const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', padding: '9px 11px', font: 'inherit', fontSize: 13, outline: 'none' };
const button: React.CSSProperties = { border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', background: 'var(--bg-3)', color: 'var(--fg)', padding: '9px 13px', font: 'inherit', fontSize: 13, cursor: 'pointer' };

const FORMATS: { id: Format; title: string; icon: string; description: string }[] = [
  { id: 'markdown', title: 'Markdown', icon: 'M↓', description: 'Readable memos with YAML metadata and attachment files in a ZIP.' },
  { id: 'json', title: 'JSON', icon: '{ }', description: 'Readable bkemo memos and metadata only. Attachment binaries are excluded.' },
  { id: 'bk', title: '.bk backup', icon: '◈', description: 'Complete, double-encrypted recovery archive. Requires both your passphrase and the site key.' },
];

function FormatCards({ value, onChange }: { value: Format; onChange: (format: Format) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
      {FORMATS.map((format) => {
        const active = value === format.id;
        return (
          <button
            type="button"
            key={format.id}
            onClick={() => onChange(format.id)}
            style={{ ...card, minHeight: 128, textAlign: 'left', cursor: 'pointer', font: 'inherit', borderColor: active ? 'var(--accent)' : 'var(--border)', background: active ? 'var(--accent-soft)' : 'var(--bg-2)', color: 'var(--fg)' }}
          >
            <div style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 15, marginBottom: 12 }}>{format.icon}</div>
            <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 5 }}>{format.title}</div>
            <div style={{ color: 'var(--fg-2)', fontSize: 11.5, lineHeight: 1.5 }}>{format.description}</div>
          </button>
        );
      })}
    </div>
  );
}

function Passphrase({ value, confirm, onValue, onConfirm }: { value: string; confirm?: string; onValue: (value: string) => void; onConfirm?: (value: string) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: onConfirm ? 'repeat(auto-fit, minmax(210px, 1fr))' : '1fr', gap: 10 }}>
      <label style={{ color: 'var(--fg-2)', fontSize: 12 }}>
        Passphrase
        <input type="password" autoComplete="new-password" value={value} onChange={(event) => onValue(event.target.value)} placeholder="At least 8 characters" style={{ ...field, marginTop: 6 }} />
      </label>
      {onConfirm && (
        <label style={{ color: 'var(--fg-2)', fontSize: 12 }}>
          Confirm passphrase
          <input type="password" autoComplete="new-password" value={confirm} onChange={(event) => onConfirm(event.target.value)} placeholder="Repeat passphrase" style={{ ...field, marginTop: 6 }} />
        </label>
      )}
    </div>
  );
}

function ExportPanel() {
  const user = RootStore.Get(UserStore);
  const [format, setFormat] = useState<Format>('markdown');
  const [scope, setScope] = useState<'all' | 'active' | 'archived' | 'trash'>('active');
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const exportNow = async () => {
    if (format === 'bk' && (passphrase.length < 8 || passphrase !== confirm)) {
      return RootStore.Get(ToastPlugin).error('Enter matching passphrases with at least 8 characters.');
    }
    setBusy(true);
    try {
      const result = await api.task.exportPortable.mutate({ format, scope, passphrase: format === 'bk' ? passphrase : undefined });
      downloadFromLink(getBlinkoEndpoint(result.downloadUrl), result.filename);
      RootStore.Get(ToastPlugin).success(format === 'bk' && result.scope === 'site' ? 'Full-site encrypted backup created.' : 'Export created.');
    } catch (error: any) {
      RootStore.Get(ToastPlugin).error(error?.message ?? 'Export failed');
    } finally { setBusy(false); }
  };

  const exportKey = async () => {
    if (passphrase.length < 8 || passphrase !== confirm) return RootStore.Get(ToastPlugin).error('Enter matching passphrases first.');
    setBusy(true);
    try {
      const result = await api.task.exportRecoveryKey.mutate({ passphrase });
      downloadFromLink(getBlinkoEndpoint(result.downloadUrl), result.filename);
      RootStore.Get(ToastPlugin).success('Recovery key downloaded. Store it separately from backups.');
    } catch (error: any) { RootStore.Get(ToastPlugin).error(error?.message ?? 'Recovery key export failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="v-stack" style={{ gap: 18 }}>
      <FormatCards value={format} onChange={setFormat} />
      {format !== 'bk' ? (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 8 }}>Memo scope</div>
          <select value={scope} onChange={(event) => setScope(event.target.value as any)} style={field}>
            <option value="active">All non-trashed active memos</option>
            <option value="all">Everything, including archive and trash</option>
            <option value="archived">Archived only</option>
            <option value="trash">Trash only</option>
          </select>
        </div>
      ) : (
        <div style={card} className="v-stack">
          <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--fg)' }}>{user.isSuperAdmin ? 'Full-site superadmin archive' : 'Complete account archive'}</div>
          <div style={{ color: 'var(--fg-2)', fontSize: 12, lineHeight: 1.55, margin: '5px 0 14px' }}>
            {user.isSuperAdmin
              ? 'As the first superadmin, your double-encrypted .bk contains every account, site setting, deployment credential, and access-token record.'
              : 'Your .bk contains all data owned by this account. It never contains site settings or another account.'}
          </div>
          <Passphrase value={passphrase} confirm={confirm} onValue={setPassphrase} onConfirm={setConfirm} />
          <div style={{ marginTop: 10, color: 'var(--fg-3)', fontSize: 11.5 }}>The passphrase alone cannot decrypt this file. The originating site key is also required.</div>
          {user.isSuperAdmin && (
            <button type="button" disabled={busy} onClick={exportKey} style={{ ...button, marginTop: 12, alignSelf: 'flex-start' }}>Download separate recovery key</button>
          )}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" disabled={busy} onClick={exportNow} style={{ ...button, borderColor: 'var(--accent)', background: 'var(--accent)', color: '#fff', opacity: busy ? .65 : 1 }}>{busy ? 'Preparing…' : `Export ${format === 'bk' ? '.bk' : format}`}</button>
      </div>
    </div>
  );
}

function ImportPanel() {
  const user = RootStore.Get(UserStore);
  const [uploaded, setUploaded] = useState<{ filePath: string; fileName: string } | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [preserveSharing, setPreserveSharing] = useState(false);
  const [restoreSiteSettings, setRestoreSiteSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const isBk = uploaded?.fileName.toLowerCase().endsWith('.bk');
  const isRecoveryKey = uploaded?.fileName.toLowerCase().endsWith('.bk-key');

  useEffect(() => { setPreview(null); setResult(null); }, [uploaded?.filePath]);

  const previewNow = async () => {
    if (!uploaded) return;
    setBusy(true);
    try {
      const value = await api.task.previewPortableImport.mutate({ filePath: uploaded.filePath, passphrase: isBk ? passphrase : undefined });
      setPreview(value);
    } catch (error: any) { RootStore.Get(ToastPlugin).error(error?.message ?? 'Could not inspect import'); }
    finally { setBusy(false); }
  };

  const importNow = async () => {
    if (!uploaded) return;
    setBusy(true);
    try {
      if (isRecoveryKey) {
        const installed = await api.task.importRecoveryKey.mutate({ filePath: uploaded.filePath, passphrase });
        setResult({ recovery: true, siteId: installed.siteId });
      } else {
        const imported = await api.task.importPortable.mutate({ filePath: uploaded.filePath, passphrase: isBk ? passphrase : undefined, mode, preserveSharing: user.isSuperAdmin ? preserveSharing : false, restoreSiteSettings: user.isSuperAdmin ? restoreSiteSettings : false });
        setResult(imported);
      }
    } catch (error: any) { RootStore.Get(ToastPlugin).error(error?.message ?? 'Import failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="v-stack" style={{ gap: 16 }}>
      <UploadFileWrapper onUpload={(file) => setUploaded(file)}>
        <div style={{ ...card, minHeight: 138, borderStyle: 'dashed', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', textAlign: 'center' }}>
          <div style={{ color: 'var(--accent)', fontSize: 24, marginBottom: 8 }}>↑</div>
          <div style={{ color: 'var(--fg)', fontWeight: 600, fontSize: 14 }}>{uploaded?.fileName ?? 'Choose .md, .zip, .json, .bk, or .bk-key'}</div>
          <div style={{ color: 'var(--fg-3)', fontSize: 11.5, marginTop: 5 }}>Plain Markdown is accepted without metadata and imports as a new memo.</div>
        </div>
      </UploadFileWrapper>

      {(isBk || isRecoveryKey) && <div style={card}><Passphrase value={passphrase} onValue={setPassphrase} /></div>}

      {uploaded && !preview && !isRecoveryKey && (
        <button type="button" disabled={busy || (isBk && passphrase.length < 8)} onClick={previewNow} style={{ ...button, alignSelf: 'flex-start' }}>{busy ? 'Inspecting…' : 'Validate and preview'}</button>
      )}

      {preview && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--fg)', marginBottom: 10 }}>Validated {preview.format} import</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
            {[['Memos', preview.notes], ['Attachments', preview.attachments], ['Accounts', preview.accounts], ['Plain Markdown', preview.plainMarkdown]].map(([label, value]) => (
              <div key={String(label)} style={{ background: 'var(--bg)', borderRadius: 'var(--radius)', padding: 10 }}><div style={{ color: 'var(--fg-3)', fontSize: 10 }}>{label}</div><div style={{ color: 'var(--fg)', fontSize: 18, marginTop: 3 }}>{value}</div></div>
            ))}
          </div>
        </div>
      )}

      {(preview || isRecoveryKey) && !result && (
        <div style={card} className="v-stack">
          {!isRecoveryKey && user.isSuperAdmin && (
            <>
              <label style={{ color: 'var(--fg-2)', fontSize: 12 }}>Restore mode
                <select value={mode} onChange={(event) => setMode(event.target.value as any)} style={{ ...field, marginTop: 6 }}><option value="merge">Merge safely</option><option value="replace">Replace existing data</option></select>
              </label>
              {preview?.canRestoreSharing && <label style={{ color: 'var(--fg)', fontSize: 12, marginTop: 12 }}><input type="checkbox" checked={preserveSharing} onChange={(event) => setPreserveSharing(event.target.checked)} /> Restore public and internal sharing when URLs do not collide</label>}
              {preview?.canRestoreSiteSettings && <label style={{ color: 'var(--fg)', fontSize: 12, marginTop: 8 }}><input type="checkbox" checked={restoreSiteSettings} onChange={(event) => setRestoreSiteSettings(event.target.checked)} /> Restore the encrypted site-settings compartment</label>}
            </>
          )}
          {!isRecoveryKey && !user.isSuperAdmin && <div style={{ color: 'var(--fg-2)', fontSize: 12, lineHeight: 1.55 }}>Your import merges into this account. It cannot change sharing, roles, permissions, or site settings; newly imported memos are private.</div>}
          {isRecoveryKey && <div style={{ color: 'var(--fg-2)', fontSize: 12, lineHeight: 1.55 }}>Installing a recovery key allows this deployment to open backups created by the source site. Only the first superadmin can perform this operation.</div>}
          <button type="button" disabled={busy || ((isBk || isRecoveryKey) && passphrase.length < 8)} onClick={importNow} style={{ ...button, marginTop: 14, alignSelf: 'flex-end', borderColor: mode === 'replace' ? '#d66' : 'var(--accent)', background: mode === 'replace' ? '#a33' : 'var(--accent)', color: '#fff' }}>{busy ? 'Restoring…' : isRecoveryKey ? 'Install recovery key' : mode === 'replace' ? 'Replace and import' : 'Merge import'}</button>
        </div>
      )}

      {result && (
        <div style={{ ...card, borderColor: 'var(--accent)' }}>
          {result.recovery ? <div style={{ color: 'var(--fg)' }}>Recovery key installed for site <code>{result.siteId}</code>.</div> : (
            <>
              <div style={{ color: 'var(--fg)', fontWeight: 650 }}>Import complete</div>
              <div style={{ color: 'var(--fg-2)', fontSize: 12, marginTop: 7 }}>{result.created} created · {result.updated} updated · {result.conflicts} conflicts kept · {result.skipped} skipped</div>
              {result.warnings?.length > 0 && <details style={{ color: 'var(--fg-2)', fontSize: 11.5, marginTop: 10 }}><summary>{result.warnings.length} warning(s)</summary><ul>{result.warnings.map((warning: string, index: number) => <li key={index}>{warning}</li>)}</ul></details>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export const DataTransfer = observer(function DataTransfer({ tab, onTab }: { tab: Tab; onTab: (tab: Tab) => void }) {
  const options = useMemo(() => [{ id: 'export' as const, label: 'Export' }, { id: 'import' as const, label: 'Import' }], []);
  return (
    <div className="v-stack" style={{ gap: 22 }}>
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 650, color: 'var(--fg)', letterSpacing: '-.02em', margin: 0 }}>Data Transfer</h2>
        <div style={{ color: 'var(--fg-2)', fontSize: 13, lineHeight: 1.5, marginTop: 5 }}>Readable interchange formats for memos, plus encrypted `.bk` recovery with role-safe restore boundaries.</div>
      </div>
      <div style={{ display: 'inline-flex', alignSelf: 'flex-start', padding: 3, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-2)' }}>
        {options.map((option) => <button type="button" key={option.id} onClick={() => onTab(option.id)} style={{ border: 0, borderRadius: 5, padding: '7px 18px', background: tab === option.id ? 'var(--accent)' : 'transparent', color: tab === option.id ? '#fff' : 'var(--fg-2)', font: 'inherit', fontSize: 12.5, cursor: 'pointer' }}>{option.label}</button>)}
      </div>
      {tab === 'export' ? <ExportPanel /> : <ImportPanel />}
    </div>
  );
});
