import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/Common/Iconify/icons';
import { api } from '@/lib/trpc';

type Usage = Awaited<ReturnType<typeof api.config.neonCuUsage.query>>;
type Settings = Awaited<ReturnType<typeof api.config.neonCuSettings.query>>;

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 38,
  padding: '8px 10px',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border-2)',
  background: 'var(--bg)',
  color: 'var(--fg)',
  fontSize: 12.5,
  fontFamily: 'inherit',
  outline: 'none',
};

function formatCu(value: number | null) {
  if (value == null) return 'Not enough data';
  return `${value.toFixed(value >= 10 ? 1 : 2)} CU-h`;
}

export function NeonCuMonitor() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState({ orgId: '', projectId: '', apiKey: '' });
  const [configuring, setConfiguring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const nextSettings = await api.config.neonCuSettings.query();
      setSettings(nextSettings);
      setForm((current) => ({
        orgId: nextSettings.orgId,
        projectId: nextSettings.projectId,
        apiKey: current.apiKey,
      }));
      const nextUsage = await api.config.neonCuUsage.query();
      setUsage(nextUsage);
      if (!nextUsage.configured) setConfiguring(true);
    } catch (nextError: any) {
      setError(nextError?.message || 'Could not load Neon CU usage');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const saveSettings = async () => {
    if (saving) return;
    setSaving(true);
    setSettingsMessage('');
    try {
      await api.config.saveNeonCuSettings.mutate(form);
      setForm((current) => ({ ...current, apiKey: '' }));
      setSettingsMessage('Neon monitor settings saved.');
      setConfiguring(false);
      await load();
    } catch (nextError: any) {
      setSettingsMessage(nextError?.message || 'Could not save Neon settings');
    } finally {
      setSaving(false);
    }
  };

  const clearSettings = async () => {
    if (saving) return;
    setSaving(true);
    setSettingsMessage('');
    try {
      await api.config.clearNeonCuSettings.mutate();
      setForm({ orgId: '', projectId: '', apiKey: '' });
      setSettingsMessage('Portal settings removed.');
      await load();
    } catch (nextError: any) {
      setSettingsMessage(nextError?.message || 'Could not remove Neon settings');
    } finally {
      setSaving(false);
    }
  };

  const maxDaily = useMemo(() => {
    if (!usage?.configured) return 1;
    return Math.max(1, ...usage.daily.map((day) => day.cuHours));
  }, [usage]);

  return (
    <section style={{ border: '1px solid var(--border)', background: 'var(--bg-2)', borderRadius: 'var(--radius-lg)', padding: 18 }}>
      <div className="h-stack" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div className="h-stack" style={{ gap: 10, alignItems: 'flex-start' }}>
          <span style={{ width: 34, height: 34, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent)', flexShrink: 0 }}>
            <Icon icon="tabler:chart-histogram" width={19} height={19} />
          </span>
          <div>
            <div style={{ color: 'var(--fg)', fontSize: 14, fontWeight: 650 }}>Neon compute this month</div>
            <div style={{ color: 'var(--fg-3)', fontSize: 11, lineHeight: 1.45, marginTop: 2 }}>Completed UTC days · linear projection at the current trend</div>
          </div>
        </div>
        <div className="h-stack" style={{ gap: 7 }}>
          {error ? <button type="button" onClick={load} disabled={loading} className="bk-native-button is-secondary is-small">Retry</button> : null}
          <button type="button" onClick={() => setConfiguring((value) => !value)} className="bk-native-button is-secondary is-small">
            {configuring ? 'Close setup' : 'Configure'}
          </button>
        </div>
      </div>

      {configuring ? (
        <div style={{ border: '1px solid var(--border)', background: 'var(--bg)', borderRadius: 'var(--radius)', padding: 13, marginTop: 15 }}>
          <div style={{ color: 'var(--fg)', fontSize: 12.5, fontWeight: 650 }}>Neon Management API</div>
          <div style={{ color: 'var(--fg-3)', fontSize: 11, lineHeight: 1.5, marginTop: 3 }}>Saved for this site with authenticated encryption. Only superadmins can configure or query this monitor.</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, marginTop: 12 }}>
            <label style={{ color: 'var(--fg-2)', fontSize: 11.5 }}>
              Organization ID
              <input style={{ ...inputStyle, marginTop: 5 }} value={form.orgId} onChange={(event) => setForm((current) => ({ ...current, orgId: event.target.value }))} placeholder="org-…" autoComplete="off" spellCheck={false} />
            </label>
            <label style={{ color: 'var(--fg-2)', fontSize: 11.5 }}>
              Project ID
              <input style={{ ...inputStyle, marginTop: 5 }} value={form.projectId} onChange={(event) => setForm((current) => ({ ...current, projectId: event.target.value }))} placeholder="project-name-12345678" autoComplete="off" spellCheck={false} />
            </label>
            <label style={{ color: 'var(--fg-2)', fontSize: 11.5, gridColumn: '1 / -1' }}>
              Personal API key
              <input style={{ ...inputStyle, marginTop: 5 }} type="password" value={form.apiKey} onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))} placeholder={settings?.apiKeyConfigured ? 'Saved — leave blank to keep it' : 'napi_…'} autoComplete="new-password" spellCheck={false} />
            </label>
          </div>
          {settingsMessage ? <div style={{ color: settingsMessage.includes('saved') || settingsMessage.includes('removed') ? 'var(--accent)' : '#E0696B', fontSize: 11.5, marginTop: 10 }}>{settingsMessage}</div> : null}
          <div className="h-stack" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <div>
              {settings?.storedInPortal ? <button type="button" onClick={clearSettings} disabled={saving} className="bk-native-button is-ghost is-small">Remove portal settings</button> : null}
            </div>
            <button type="button" onClick={saveSettings} disabled={saving || !form.orgId.trim() || !form.projectId.trim() || (!form.apiKey.trim() && !settings?.apiKeyConfigured)} className="bk-native-button is-primary is-small">
              {saving ? 'Saving…' : 'Save & refresh'}
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 10.5, padding: '28px 0 10px' }}>LOADING NEON USAGE…</div>
      ) : error ? (
        <div style={{ border: '1px solid rgba(224,105,107,.45)', background: 'rgba(224,105,107,.08)', color: '#E0696B', borderRadius: 'var(--radius)', padding: 12, fontSize: 12, lineHeight: 1.5, marginTop: 15 }}>{error}</div>
      ) : usage && !usage.configured ? (
        <div style={{ border: '1px solid var(--border)', background: 'var(--bg)', borderRadius: 'var(--radius)', padding: 13, marginTop: 15 }}>
          <div style={{ color: 'var(--fg)', fontSize: 12.5, fontWeight: 600 }}>Connect the Neon Management API</div>
          <div style={{ color: 'var(--fg-2)', fontSize: 11.5, lineHeight: 1.55, marginTop: 4 }}>
            Configure the organization ID, project ID, and a newly rotated personal API key above. The key is encrypted at rest and is never returned to this browser.
          </div>
        </div>
      ) : usage?.configured ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 8, marginTop: 16 }}>
            {[
              { label: 'Past days used', value: formatCu(usage.usedCuHours) },
              { label: 'Estimated month', value: formatCu(usage.estimatedCuHours) },
              { label: 'Daily average', value: formatCu(usage.averageCuHoursPerDay) },
            ].map((item) => (
              <div key={item.label} style={{ border: '1px solid var(--border)', background: 'var(--bg)', borderRadius: 'var(--radius)', padding: '11px 12px' }}>
                <div style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.06em', textTransform: 'uppercase' }}>{item.label}</div>
                <div style={{ color: 'var(--fg)', fontSize: 18, fontWeight: 650, letterSpacing: '-.02em', marginTop: 4 }}>{item.value}</div>
              </div>
            ))}
          </div>

          {usage.daily.length ? (
            <div style={{ marginTop: 17 }}>
              <div className="h-stack" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.06em' }}>DAILY CU-HOURS</span>
                <span style={{ color: 'var(--fg-3)', fontSize: 10.5 }}>{usage.elapsedDays} completed days</span>
              </div>
              <div style={{ height: 108, display: 'flex', alignItems: 'flex-end', gap: 3, overflowX: 'auto', padding: '8px 2px 0', borderBottom: '1px solid var(--border-2)' }}>
                {usage.daily.map((day) => {
                  const height = day.cuHours ? Math.max(4, (day.cuHours / maxDaily) * 92) : 2;
                  return (
                    <div key={day.date} title={`${day.date}: ${formatCu(day.cuHours)}`} style={{ flex: '1 0 8px', minWidth: 8, maxWidth: 22, height, borderRadius: '3px 3px 0 0', background: day.cuHours ? 'var(--accent)' : 'var(--border-2)', opacity: day.cuHours ? .85 : .6 }} />
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--fg-3)', fontSize: 11.5, marginTop: 15 }}>A projection will appear after the first complete UTC day of the month.</div>
          )}

          <div className="h-stack" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 9.5, marginTop: 10 }}>
            <span>PROJECT {usage.projectId}</span>
            <span>UPDATED {new Date(usage.fetchedAt).toLocaleString()}</span>
          </div>
        </>
      ) : null}
    </section>
  );
}
