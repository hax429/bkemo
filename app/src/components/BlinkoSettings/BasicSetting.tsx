import { observer } from "mobx-react-lite";
import { Alert, Button, Input } from "@heroui/react";
import { RootStore } from "@/store";
import { Icon } from '@/components/Common/Iconify/icons';
import { UserStore } from "@/store/user";
import { useTranslation } from "react-i18next";
import { DialogStore } from "@/store/module/Dialog";
import { UpdateUserInfo, UpdateUserPassword } from "../Common/UpdateUserInfo";
import { Copy } from "../Common/Copy";
import { PromiseCall } from "@/store/standard/PromiseState";
import { api } from "@/lib/trpc";
import { BlinkoStore } from "@/store/blinkoStore";
import { useEffect, useState } from "react";
import { ShowGen2FATokenModal } from "../Common/TwoFactorModal/gen2FATokenModal";
import { eventBus } from "@/lib/event";
import { UploadFileWrapper } from "../Common/UploadFile";
import { signOut } from "../Auth/auth-client";
import { getBlinkoEndpoint } from "@/lib/blinkoEndpoint";
import { ToastPlugin } from "@/store/module/Toast/Toast";

// Custom Row component styled exactly like SettingsScreen's Row
function Row({ title, sub, control }: { title: React.ReactNode; sub?: React.ReactNode; control: React.ReactNode }) {
  return (
    <div className="h-stack" style={{ padding: '16px 0', borderBottom: '1px solid var(--border)', gap: 24, alignItems: 'flex-start' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, color: 'var(--fg)', fontWeight: 500 }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--fg-2)', marginTop: 4, lineHeight: 1.5 }}>{sub}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{control}</div>
    </div>
  );
}

// Custom Toggle component styled exactly like SettingsScreen's Toggle
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <span onClick={() => onChange(!on)} style={{ width: 38, height: 22, borderRadius: 100, background: on ? 'var(--accent)' : 'var(--bg-3)', border: '1px solid var(--border-2)', position: 'relative', cursor: 'pointer', flexShrink: 0, transition: 'background .15s', display: 'inline-block' }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: 50, background: '#fff', transition: 'left .15s' }} />
    </span>
  );
}

export const BasicSetting = observer(() => {
  const user = RootStore.Get(UserStore);
  const blinko = RootStore.Get(BlinkoStore);
  const { t } = useTranslation();

  const [showToken, setShowToken] = useState(false);

  const initials = (user.nickname || user.name || 'G').slice(0, 2).toUpperCase();

  return (
    <div className="v-stack" style={{ gap: 24 }}>
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 600, color: 'var(--fg)', letterSpacing: '-0.02em', margin: 0 }}>Basic Information</h2>
        <div style={{ color: 'var(--fg-2)', fontSize: 13, marginTop: 4, marginBottom: 18 }}>Your account details, API token and security settings. Synced to your account.</div>
      </div>

      <div className="v-stack" style={{ gap: 0 }}>
        {/* Profile Section Title */}
        <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg)', marginTop: 8, marginBottom: 4, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>Profile</h3>

        {/* Row 1: Name */}
        <Row
          title="Name"
          sub="Your account display name and initials avatar. Click the avatar to upload a custom image."
          control={
            <div className="h-stack" style={{ gap: 12, alignItems: 'center' }}>
              <span style={{ fontSize: 14, color: 'var(--fg-2)', fontWeight: 500 }}>{user.nickname || user.name}</span>
              <UploadFileWrapper
                acceptImage
                onUpload={async ({ filePath }) => {
                  if (!user.userInfo.value?.id) return;
                  await PromiseCall(api.users.upsertUser.mutate({
                    id: user.userInfo.value?.id,
                    image: filePath
                  }));
                  await user.userInfo.call(Number(user.id));
                }}
              >
                <div style={{ cursor: 'pointer', position: 'relative' }} title="Click to upload custom avatar">
                  {user.userInfo.value?.image ? (
                    <img
                      src={getBlinkoEndpoint(`${user.userInfo.value.image}?token=${user.tokenData.value?.token}`)}
                      alt="avatar"
                      style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div className="bk-avatar" style={{ width: 28, height: 28, borderRadius: '50%', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {initials}
                    </div>
                  )}
                </div>
              </UploadFileWrapper>

              <button
                onClick={() => {
                  RootStore.Get(DialogStore).setData({
                    isOpen: true,
                    title: t('change-user-info'),
                    content: <UpdateUserInfo />
                  });
                }}
                style={{
                  background: 'var(--bg-3)',
                  border: '1px solid var(--border-2)',
                  borderRadius: 8,
                  width: 28,
                  height: 28,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--fg-2)',
                  cursor: 'pointer'
                }}
                title="Edit Nickname"
              >
                <Icon icon="lucide:edit-3" width={14} height={14} />
              </button>

              <button
                onClick={() => {
                  RootStore.Get(DialogStore).setData({
                    title: t('rest-user-password'),
                    isOpen: true,
                    content: <UpdateUserPassword />
                  });
                }}
                style={{
                  background: 'var(--bg-3)',
                  border: '1px solid var(--border-2)',
                  borderRadius: 8,
                  width: 28,
                  height: 28,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--fg-2)',
                  cursor: 'pointer'
                }}
                title="Change Password"
              >
                <span style={{ fontSize: 10, fontWeight: 'bold' }}>***</span>
              </button>
            </div>
          }
        />

        {/* Security & API Section Title */}
        <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg)', marginTop: 24, marginBottom: 4, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>Security & APIs</h3>

        {/* Row 2: Access Token */}
        <Row
          title={
            <div className="v-stack" style={{ gap: 2 }}>
              <div className="h-stack" style={{ gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 14, color: 'var(--fg)', fontWeight: 500 }}>Access Token</span>
                <button
                  onClick={() => setShowToken(!showToken)}
                  style={{
                    background: 'var(--bg-3)',
                    border: 'none',
                    borderRadius: 6,
                    padding: '3px 8px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    cursor: 'pointer',
                    color: 'var(--fg-2)'
                  }}
                >
                  <Icon icon={showToken ? "lucide:eye-off" : "lucide:eye"} width={14} height={14} />
                </button>
              </div>
              <div
                onClick={async () => {
                  const response = await PromiseCall(api.users.genLowPermToken.mutate());
                  if (response?.token) {
                    RootStore.Get(DialogStore).setData({
                      isOpen: true,
                      title: t('generate-low-permission-token'),
                      content: (
                        <div className="flex flex-col gap-4">
                          <Alert
                            color="warning"
                            description={t('low-permission-token-desc')}
                            title={t('this-token-is-only-displayed-once-please-save-it-properly')}
                            variant="faded"
                          />
                          <Input
                            readOnly
                            className="w-full"
                            value={response.token}
                            endContent={<Copy size={20} content={response.token} />}
                          />
                        </div>
                      )
                    });
                  }
                }}
                style={{ fontSize: 12, color: 'var(--accent)', cursor: 'pointer', fontWeight: 500 }}
                className="hover:underline"
              >
                Generate Low Permission Token
              </div>
            </div>
          }
          sub="Required for webhook and API integrations. Keep this token private."
          control={
            <div className="h-stack" style={{ gap: 12, alignItems: 'center' }}>
              <div className="h-stack" style={{ background: 'var(--bg-3)', border: '1px solid var(--border-2)', borderRadius: 8, padding: '4px 8px', gap: 8, width: 240, alignItems: 'center' }}>
                <input
                  disabled
                  type={showToken ? "text" : "password"}
                  value={showToken ? (user.userInfo.value?.token ?? '') : '••••••••••••••••••••••••••••••••'}
                  style={{
                    background: 'transparent',
                    color: 'var(--fg)',
                    border: 'none',
                    outline: 'none',
                    fontSize: 12,
                    flex: 1,
                    cursor: 'default',
                    fontFamily: 'var(--font-mono)'
                  }}
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(user.userInfo.value?.token ?? '');
                    RootStore.Get(ToastPlugin).success(t('copied-successfully'));
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--fg-3)',
                    cursor: 'pointer',
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center'
                  }}
                  title="Copy Token"
                >
                  <Icon icon="lucide:copy" width={14} height={14} />
                </button>
              </div>
              <button
                onClick={async () => {
                  if (confirm("Are you sure you want to regenerate your access token? This will invalidate any existing integrations.")) {
                    await PromiseCall(api.users.regenToken.mutate());
                    await user.userInfo.call(Number(user.id));
                  }
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--fg-2)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  padding: 4
                }}
                title="Regenerate Token"
              >
                <Icon icon="lucide:refresh-cw" width={16} height={16} />
              </button>
            </div>
          }
        />

        {/* Row 3: Two-Factor Authentication */}
        <Row
          title="Two-Factor Authentication"
          sub="Protect your account with TOTP authenticator codes."
          control={
            <Toggle
              on={blinko.config.value?.twoFactorEnabled ?? false}
              onChange={async (checked) => {
                if (!checked) {
                  await PromiseCall(api.config.update.mutate({
                    key: 'twoFactorEnabled',
                    value: false
                  }));
                  await blinko.config.call();
                } else {
                  const response = await PromiseCall(api.users.generate2FASecret.mutate({
                    name: user.name!
                  }), { autoAlert: false });
                  if (response) {
                    ShowGen2FATokenModal({
                      qrCodeUrl: response.qrCode,
                      totpSecret: response.secret
                    });
                  }
                }
              }}
            />
          }
        />
      </div>

      {/* Danger Zone Section */}
      <div style={{ marginTop: 32, border: '1px solid #ff4d4f', borderRadius: 'var(--radius-lg)', padding: '20px 24px', background: 'rgba(255, 77, 79, 0.05)' }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: '#ff4d4f', margin: '0 0 12px 0' }}>Danger Zone</h3>
        <div className="v-stack" style={{ gap: 16 }}>
          
          {/* Logout Row */}
          <div className="h-stack" style={{ justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255, 77, 79, 0.15)', paddingBottom: 16 }}>
            <div>
              <div style={{ fontSize: 14, color: 'var(--fg)', fontWeight: 500 }}>Log out</div>
              <div style={{ fontSize: 12, color: 'var(--fg-2)', marginTop: 4 }}>Disconnect your session from this device.</div>
            </div>
            <button
              onClick={async () => {
                if (confirm("Are you sure you want to log out?")) {
                  await signOut({ callbackUrl: '/signin' });
                  eventBus.emit('user:signout');
                }
              }}
              style={{
                background: '#ff4d4f',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
              }}
            >
              <Icon icon="lucide:log-out" width={16} height={16} />
              Log out
            </button>
          </div>

          {/* Clear User Data Row */}
          <div className="h-stack" style={{ justifyContent: 'space-between', alignItems: 'center', borderBottom: user.canManageSite ? '1px solid rgba(255, 77, 79, 0.15)' : 'none', paddingBottom: user.canManageSite ? 16 : 0 }}>
            <div>
              <div style={{ fontSize: 14, color: 'var(--fg)', fontWeight: 500 }}>Clear my user data</div>
              <div style={{ fontSize: 12, color: 'var(--fg-2)', marginTop: 4 }}>Permanently delete all your memos, tasks, tags, comments, and attachments. This cannot be undone.</div>
            </div>
            <button
              onClick={async () => {
                if (confirm("WARNING: This will permanently delete ALL your memos, comments, tags, and attachments. This cannot be undone! Are you sure?")) {
                  const checkName = prompt("To confirm, type your username:");
                  if (checkName === user.name) {
                    await PromiseCall(api.users.clearUserData.mutate());
                    RootStore.Get(ToastPlugin).success("Your user data has been cleared.");
                    window.location.reload();
                  } else {
                    alert("Confirmation username did not match. Operation cancelled.");
                  }
                }
              }}
              style={{
                background: 'transparent',
                color: '#ff4d4f',
                border: '1px solid #ff4d4f',
                borderRadius: 8,
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Clear User Data
            </button>
          </div>

          {/* Clear Site Data Row (Admin Only) */}
          {user.canManageSite && (
            <div className="h-stack" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 14, color: 'var(--fg)', fontWeight: 500 }}>Clear all site data</div>
                <div style={{ fontSize: 12, color: 'var(--fg-2)', marginTop: 4 }}>Permanently delete all other user accounts, notes, comments, and attachments from the system. (Admin Only)</div>
              </div>
              <button
                onClick={async () => {
                  if (confirm("CRITICAL WARNING: This will permanently delete ALL OTHER USER ACCOUNTS and ALL system notes, comments, attachments, and configs. This is an administrative reset. Are you sure?")) {
                    const checkConfirm = prompt("To confirm, type 'DELETE ALL SITE DATA':");
                    if (checkConfirm === 'DELETE ALL SITE DATA') {
                      await PromiseCall(api.users.clearSiteData.mutate());
                      RootStore.Get(ToastPlugin).success("All site data has been cleared.");
                      window.location.reload();
                    } else {
                      alert("Confirmation typed text did not match. Operation cancelled.");
                    }
                  }
                }}
                style={{
                  background: 'transparent',
                  color: '#ff4d4f',
                  border: '1px solid #ff4d4f',
                  borderRadius: 8,
                  padding: '8px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Clear Site Data
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
});