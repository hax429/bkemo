import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';
import { Icon } from '@/components/Common/Iconify/icons';
import { allSettings } from '@/pages/settings';
import { ACCENT_SWATCHES, type BkemoPrefs, type BkemoTheme, type BkemoDensity } from '@/lib/bkemoSettings';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.06em', color: 'var(--fg-3)', textTransform: 'uppercase' };

// Group the (reused) Blinko settings sections + the bkemo-native Appearance.
const GROUP_OF: Record<string, 'you' | 'system' | 'data'> = {
  appear: 'you', basic: 'you', prefer: 'you', hotkey: 'you', user: 'you',
  ai: 'system', httpproxy: 'system', task: 'system', storage: 'system', music: 'system', sso: 'system',
  import: 'data', export: 'data', plugin: 'data', about: 'data',
};
const GROUPS: { id: 'you' | 'system' | 'data'; label: string }[] = [
  { id: 'you', label: 'You' }, { id: 'system', label: 'System' }, { id: 'data', label: 'Data' },
];

function Segmented<T extends string>({ options, active, onChange }: { options: { v: T; label: string }[]; active: T; onChange: (v: T) => void }) {
  return (
    <div className="h-stack" style={{ background: 'var(--bg-2)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', padding: 2, gap: 2 }}>
      {options.map((o) => (
        <span key={o.v} onClick={() => onChange(o.v)} style={{ padding: '4px 12px', borderRadius: 4, background: o.v === active ? 'var(--bg-3)' : 'transparent', color: o.v === active ? 'var(--fg)' : 'var(--fg-2)', fontSize: 12, cursor: 'pointer' }}>{o.label}</span>
      ))}
    </div>
  );
}

function Row({ title, sub, control }: { title: string; sub?: string; control: React.ReactNode }) {
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

const Appearance = observer(function Appearance({ prefs, onChange }: { prefs: BkemoPrefs; onChange: (p: Partial<BkemoPrefs>) => void }) {
  return (
    <div>
      <h2 style={{ fontSize: 24, fontWeight: 600, color: 'var(--fg)', letterSpacing: '-0.02em', margin: 0 }}>Appearance</h2>
      <div style={{ color: 'var(--fg-2)', fontSize: 13, marginTop: 4, marginBottom: 18 }}>Theme, accent and density for the bkemo workspace.</div>
      <Row title="Theme" sub="bkemo defaults to dark." control={
        <Segmented<BkemoTheme> options={[{ v: 'dark', label: 'Dark' }, { v: 'light', label: 'Light' }]} active={prefs.theme} onChange={(v) => onChange({ theme: v })} />
      } />
      <Row title="Accent color" sub="Used for #tags, checkboxes, focus and charts." control={
        <div className="h-stack" style={{ gap: 8 }}>
          {ACCENT_SWATCHES.map((c) => (
            <span key={c} onClick={() => onChange({ accent: c })} style={{ width: 26, height: 26, borderRadius: 50, background: c, cursor: 'pointer', border: c === prefs.accent ? '2px solid var(--fg)' : '2px solid transparent', outline: c === prefs.accent ? '2px solid var(--accent)' : 'none', outlineOffset: -4 }} />
          ))}
        </div>
      } />
      <Row title="Density" sub="How tightly the stream and lists pack." control={
        <Segmented<BkemoDensity> options={[{ v: 'compact', label: 'Compact' }, { v: 'regular', label: 'Regular' }, { v: 'comfy', label: 'Comfy' }]} active={prefs.density} onChange={(v) => onChange({ density: v })} />
      } />
    </div>
  );
});

export const SettingsScreen = observer(function SettingsScreen({ prefs, onChange }: { prefs: BkemoPrefs; onChange: (p: Partial<BkemoPrefs>) => void }) {
  const { t } = useTranslation();
  const user = RootStore.Get(UserStore);
  const [section, setSection] = useState('appear');

  // Appearance (bkemo-native) + the reused Blinko sections, admin-filtered.
  const sections = [
    { key: 'appear', title: 'Appearance', icon: 'tabler:palette', requireAdmin: false, component: <Appearance prefs={prefs} onChange={onChange} /> },
    ...allSettings.filter((s) => !s.requireAdmin || user.isSuperAdmin),
  ];
  const active = sections.find((s) => s.key === section) ?? sections[0];

  return (
    <div className="v-stack" style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
      <div className="h-stack" style={{ height: 44, padding: '0 18px', borderBottom: '1px solid var(--border)', gap: 10, background: 'var(--bg)' }}>
        <span style={{ color: 'var(--fg)', fontSize: 13, fontWeight: 500 }}>Settings</span>
        <span style={{ color: 'var(--fg-3)' }}>/</span>
        <span style={{ color: 'var(--fg-2)', fontSize: 13 }}>{active.key === 'appear' ? 'Appearance' : t(active.title)}</span>
      </div>
      <div className="h-stack" style={{ flex: 1, overflow: 'hidden', alignItems: 'stretch' }}>
        {/* nav */}
        <div className="v-stack bk-scroll" style={{ width: 230, borderRight: '1px solid var(--border)', padding: '16px 8px', gap: 1, overflow: 'auto', background: 'var(--bg)', flexShrink: 0 }}>
          {GROUPS.map((g) => {
            const items = sections.filter((s) => GROUP_OF[s.key] === g.id);
            if (items.length === 0) return null;
            return (
              <div key={g.id}>
                <div style={{ ...mono, padding: '10px 12px 6px' }}>{g.label}</div>
                {items.map((s) => (
                  <div key={s.key} onClick={() => setSection(s.key)} className="h-stack" style={{ gap: 8, padding: '6px 10px', borderRadius: 'var(--radius)', background: section === s.key ? 'var(--hover)' : 'transparent', color: section === s.key ? 'var(--fg)' : 'var(--fg-2)', borderLeft: section === s.key ? '2px solid var(--accent)' : '2px solid transparent', fontSize: 13, cursor: 'pointer' }}>
                    <Icon icon={s.icon} width={16} height={16} style={{ color: section === s.key ? 'var(--accent)' : 'var(--fg-3)', flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.key === 'appear' ? 'Appearance' : t(s.title)}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        {/* body — bkemo-native Appearance renders bare; reused Blinko sections are
            wrapped in `dark bk-legacy-settings` so HeroUI maps to the bkemo palette. */}
        <div className="bk-scroll" style={{ flex: 1, overflow: 'auto', padding: '24px 28px 48px' }}>
          <div
            key={active.key}
            className={active.key === 'appear' ? undefined : 'dark bk-legacy-settings'}
            style={{ maxWidth: 860 }}
          >
            {active.component}
          </div>
        </div>
      </div>
    </div>
  );
});
