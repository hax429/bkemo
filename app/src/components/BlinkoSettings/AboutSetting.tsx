import { observer } from "mobx-react-lite";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from '@/components/Common/Iconify/icons';
import { RootStore } from "@/store";
import { ToastPlugin } from "@/store/module/Toast/Toast";

export const AboutSetting = observer(() => {
  const { t } = useTranslation();
  const [clearing, setClearing] = useState(false);

  const clearBrowserCache = async () => {
    setClearing(true);
    try {
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(cacheName => caches.delete(cacheName)));
      }
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(registration => registration.unregister()));
      }
      RootStore.Get(ToastPlugin).success(t('cache-cleared-successfully'));
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error('Failed to clear cache:', error);
      RootStore.Get(ToastPlugin).error(t('failed-to-clear-cache'));
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="v-stack" style={{ gap: 24 }}>
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 600, color: 'var(--fg)', letterSpacing: '-0.02em', margin: 0 }}>About</h2>
        <div style={{ color: 'var(--fg-2)', fontSize: 13, marginTop: 4, marginBottom: 18 }}>System details and workspace information.</div>
      </div>

      <div className="h-stack" style={{ gap: 16, background: 'var(--bg-2)', border: '1px solid var(--border)', padding: '20px', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ width: 56, height: 56, borderRadius: 'var(--radius-lg)', background: 'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 40%, #000))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 700, color: '#fff' }}>
          bk
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--fg)' }}>bkemo</div>
          <div style={{ fontSize: 13, color: 'var(--fg-2)', marginTop: 2 }}>
            A premium, minimal workspace for your stream and notes.
          </div>
        </div>
      </div>

      <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 24 }}>
        <div style={{ fontSize: 14, color: 'var(--fg)', fontWeight: 500, marginBottom: 12 }}>Version Information</div>
        <div className="v-stack" style={{ gap: 12 }}>
          <div className="h-stack" style={{ justifyContent: 'space-between', padding: '12px 16px', background: 'var(--bg-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
            <span style={{ fontSize: 13, color: 'var(--fg-2)' }}>Release Version</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>v0.8.0</span>
          </div>
          <div className="h-stack" style={{ justifyContent: 'space-between', padding: '12px 16px', background: 'var(--bg-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
            <span style={{ fontSize: 13, color: 'var(--fg-2)' }}>Architecture</span>
            <span style={{ fontSize: 13, color: 'var(--fg)', textTransform: 'capitalize' }}>Direction D</span>
          </div>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 14, color: 'var(--fg)', fontWeight: 500, marginBottom: 12 }}>Maintenance</div>
        <div className="h-stack" style={{ justifyContent: 'space-between', padding: '16px', background: 'var(--bg-2)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>Clear Cache</div>
            <div style={{ fontSize: 11, color: 'var(--fg-2)', marginTop: 2 }}>Unregisters service workers and purges browser cache to force reload assets.</div>
          </div>
          <button
            onClick={clearBrowserCache}
            disabled={clearing}
            style={{
              background: 'var(--accent-soft)',
              color: 'var(--accent)',
              border: '1px solid var(--accent)',
              borderRadius: 'var(--radius)',
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              opacity: clearing ? 0.6 : 1,
            }}
          >
            <Icon icon="mdi:cached" width={14} height={14} />
            {clearing ? 'Clearing...' : 'Clear Cache'}
          </button>
        </div>
      </div>
    </div>
  );
});