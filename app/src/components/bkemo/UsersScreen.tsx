import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { UserStore } from '@/store/user';
import { api } from '@/lib/trpc';
import { PromiseCall } from '@/store/standard/PromiseState';

type Perms = { canShare: boolean; manageSiteSettings: boolean; manageUsers: boolean; enabled: boolean };
const DEFAULT_PERMS: Perms = { canShare: true, manageSiteSettings: false, manageUsers: false, enabled: true };

const isOwnerRole = (role?: string | null) => role === 'superadmin';
const resolveRowPerms = (row: any): Perms => {
  if (isOwnerRole(row?.role)) return { canShare: true, manageSiteSettings: true, manageUsers: true, enabled: true };
  const p = (row?.permissions ?? {}) as Partial<Perms>;
  return {
    canShare: p.canShare ?? DEFAULT_PERMS.canShare,
    manageSiteSettings: p.manageSiteSettings ?? DEFAULT_PERMS.manageSiteSettings,
    manageUsers: p.manageUsers ?? DEFAULT_PERMS.manageUsers,
    enabled: p.enabled ?? DEFAULT_PERMS.enabled,
  };
};

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.06em', color: 'var(--fg-3)', textTransform: 'uppercase' };
const fieldStyle: React.CSSProperties = { background: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', width: '100%' };

function Toggle({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <span
      onClick={() => !disabled && onChange(!on)}
      style={{ width: 38, height: 22, borderRadius: 100, background: on ? 'var(--accent)' : 'var(--bg-3)', border: '1px solid var(--border-2)', position: 'relative', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, flexShrink: 0, transition: 'background .15s', display: 'inline-block' }}
    >
      <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: 50, background: '#fff', transition: 'left .15s' }} />
    </span>
  );
}

function Chip({ label, tone }: { label: string; tone: 'accent' | 'warn' | 'muted' }) {
  const color = tone === 'accent' ? 'var(--accent)' : tone === 'warn' ? '#E0696B' : 'var(--fg-3)';
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 7px', borderRadius: 100, border: `1px solid ${color}`, color, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</span>
  );
}

const PERMS_FIELDS: { key: keyof Perms; title: string; sub: string }[] = [
  { key: 'manageSiteSettings', title: 'Admin power', sub: 'Edit global site settings: AI, storage, schedule tasks, proxy, SSO.' },
  { key: 'manageUsers', title: 'Manage users', sub: 'Create, edit and delete users and set their permissions.' },
  { key: 'canShare', title: 'Allow public sharing', sub: 'Publish memos publicly and create /m/ share links.' },
  { key: 'enabled', title: 'Account enabled', sub: 'When off, the user can no longer sign in.' },
];

const UserModal = observer(function UserModal({ row, onClose }: { row: any | null; onClose: () => void }) {
  const blinko = RootStore.Get(BlinkoStore);
  const owner = isOwnerRole(row?.role);
  const editing = !!row?.id;
  const [name, setName] = useState(row?.name ?? '');
  const [nickname, setNickname] = useState(row?.nickname ?? '');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [perms, setPerms] = useState<Perms>(row ? resolveRowPerms(row) : DEFAULT_PERMS);
  const [saving, setSaving] = useState(false);
  const isOauth = row?.loginType === 'oauth';

  const save = async () => {
    if (saving) return;
    if (!editing && !password.trim()) return; // password required on create
    setSaving(true);
    try {
      await PromiseCall(api.users.upsertUserByAdmin.mutate({
        ...(editing ? { id: row.id } : {}),
        name: name.trim() || undefined,
        nickname: nickname.trim() || undefined,
        password: password.trim() || undefined,
        // The owner's permissions are immutable; don't send them.
        ...(owner ? {} : { permissions: perms }),
      }));
      await blinko.userList.call();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: '100%', maxHeight: '90vh', overflow: 'auto', background: 'var(--bg-2)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius-lg)', padding: 22 }} className="bk-scroll">
        <div className="h-stack" style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--fg)' }}>{editing ? 'Edit user' : 'Create user'}</div>
          {owner && <span style={{ marginLeft: 8 }}><Chip label="Owner" tone="accent" /></span>}
          <span className="spacer" />
          <span onClick={onClose} style={{ cursor: 'pointer', color: 'var(--fg-3)', fontSize: 18 }}>✕</span>
        </div>

        <label style={{ ...mono, display: 'block', marginBottom: 6 }}>Username</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="username" disabled={isOauth} style={{ ...fieldStyle, marginBottom: 14, opacity: isOauth ? 0.6 : 1 }} />

        <label style={{ ...mono, display: 'block', marginBottom: 6 }}>Nickname</label>
        <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="nickname" style={{ ...fieldStyle, marginBottom: 14 }} />

        <label style={{ ...mono, display: 'block', marginBottom: 6 }}>Password {editing ? '(leave blank to keep)' : '*'}</label>
        <div className="h-stack" style={{ gap: 8, marginBottom: 18 }}>
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" type={showPw ? 'text' : 'password'} style={fieldStyle} />
          <span onClick={() => setShowPw((v) => !v)} style={{ cursor: 'pointer', color: 'var(--fg-3)', fontSize: 13, flexShrink: 0 }}>{showPw ? '🙈' : '👁'}</span>
        </div>

        <div style={{ ...mono, marginBottom: 8 }}>Permissions</div>
        {PERMS_FIELDS.map((f) => (
          <div key={f.key} className="h-stack" style={{ padding: '12px 0', borderTop: '1px solid var(--border)', gap: 16, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, color: 'var(--fg)' }}>{f.title}</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-2)', marginTop: 2, lineHeight: 1.5 }}>{f.sub}</div>
            </div>
            <Toggle on={owner ? true : perms[f.key]} disabled={owner} onChange={(v) => setPerms((p) => ({ ...p, [f.key]: v }))} />
          </div>
        ))}
        {owner && <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 8 }}>The owner account always has full permissions.</div>}

        <div className="h-stack" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
          <button onClick={save} disabled={saving || (!editing && !password.trim())} style={{ background: 'var(--accent)', border: 'none', color: '#fff', padding: '8px 18px', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 500, opacity: saving || (!editing && !password.trim()) ? 0.6 : 1 }}>Save</button>
        </div>
      </div>
    </div>
  );
});

export const UsersScreen = observer(function UsersScreen() {
  const blinko = RootStore.Get(BlinkoStore);
  const user = RootStore.Get(UserStore);
  const [modal, setModal] = useState<{ row: any | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  useEffect(() => { blinko.userList.call(); }, []);

  const del = async (id: number) => {
    try {
      await PromiseCall(api.users.deleteUser.mutate({ id }));
      await blinko.userList.call();
    } finally {
      setConfirmDelete(null);
    }
  };

  const rows = blinko.userList.value ?? [];

  return (
    <div className="v-stack" style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
      <div className="h-stack" style={{ height: 44, padding: '0 18px', borderBottom: '1px solid var(--border)', gap: 10, background: 'var(--bg)' }}>
        <span style={{ color: 'var(--fg)', fontSize: 13, fontWeight: 500 }}>Settings</span>
        <span style={{ color: 'var(--fg-3)' }}>/</span>
        <span style={{ color: 'var(--fg-2)', fontSize: 13 }}>Users</span>
      </div>

      <div className="bk-scroll" style={{ flex: 1, overflow: 'auto', padding: '24px 28px 48px' }}>
        <div style={{ maxWidth: 860 }}>
          <div className="h-stack" style={{ marginBottom: 18 }}>
            <div>
              <h2 style={{ fontSize: 24, fontWeight: 600, color: 'var(--fg)', letterSpacing: '-0.02em', margin: 0 }}>Users</h2>
              <div style={{ color: 'var(--fg-2)', fontSize: 13, marginTop: 4 }}>Create accounts and grant permissions. Each user's appearance & preferences are their own.</div>
            </div>
            <span className="spacer" />
            <button onClick={() => setModal({ row: null })} style={{ background: 'var(--accent)', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 500 }}>+ Create user</button>
          </div>

          {/* header */}
          <div className="h-stack" style={{ ...mono, padding: '0 4px 8px', gap: 12 }}>
            <span style={{ flex: 1 }}>Name</span>
            <span style={{ width: 110 }}>Role</span>
            <span style={{ flex: 1.4 }}>Permissions</span>
            <span style={{ width: 80, textAlign: 'right' }}>Action</span>
          </div>

          {rows.map((u: any) => {
            const owner = isOwnerRole(u.role);
            const p = resolveRowPerms(u);
            return (
              <div key={u.id} className="h-stack" style={{ padding: '12px 4px', borderTop: '1px solid var(--border)', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.nickname || u.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{u.name} · {u.loginType === 'oauth' ? 'oauth' : 'password'}</div>
                </div>
                <div style={{ width: 110 }}>
                  <Chip label={owner ? 'Owner' : 'User'} tone={owner ? 'accent' : 'muted'} />
                </div>
                <div className="h-stack" style={{ flex: 1.4, gap: 6, flexWrap: 'wrap' }}>
                  {owner ? <Chip label="all" tone="accent" /> : (
                    <>
                      {p.manageSiteSettings && <Chip label="admin" tone="accent" />}
                      {p.manageUsers && <Chip label="users" tone="accent" />}
                      {p.canShare && <Chip label="share" tone="muted" />}
                      {!p.enabled && <Chip label="disabled" tone="warn" />}
                    </>
                  )}
                </div>
                <div className="h-stack" style={{ width: 80, justifyContent: 'flex-end', gap: 8 }}>
                  <span onClick={() => setModal({ row: u })} title="Edit" style={{ cursor: 'pointer', color: 'var(--fg-2)' }}>✎</span>
                  {!owner && u.id !== Number(user.id) && (
                    confirmDelete === u.id ? (
                      <span className="h-stack" style={{ gap: 6 }}>
                        <span onClick={() => del(u.id)} title="Confirm delete" style={{ cursor: 'pointer', color: '#E0696B', fontSize: 11, fontFamily: 'var(--font-mono)' }}>yes</span>
                        <span onClick={() => setConfirmDelete(null)} style={{ cursor: 'pointer', color: 'var(--fg-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>no</span>
                      </span>
                    ) : (
                      <span onClick={() => setConfirmDelete(u.id)} title="Delete" style={{ cursor: 'pointer', color: 'var(--fg-3)' }}>⌫</span>
                    )
                  )}
                </div>
              </div>
            );
          })}
          {rows.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>No users.</div>}
        </div>
      </div>

      {modal && <UserModal row={modal.row} onClose={() => setModal(null)} />}
    </div>
  );
});
