import { observer } from 'mobx-react-lite';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';
import { BlinkoStore } from '@/store/blinkoStore';
import { Icon } from '@/components/Common/Iconify/icons';
import { api } from '@/lib/trpc';
import { PromiseCall, PageSize } from '@/store/standard/PromiseState';
import FontSwitcher from '@/components/Common/FontSwitcher';
import LanguageSwitcher from '@/components/Common/LanguageSwitcher';
import { UsersScreen } from './UsersScreen';
import { BasicSetting } from '@/components/BlinkoSettings/BasicSetting';
import AiSetting from '@/components/BlinkoSettings/AiSetting/AiSetting';
import { TaskSetting } from '@/components/BlinkoSettings/TaskSetting';
import { StorageSetting } from '@/components/BlinkoSettings/StorageSetting';
import { ImportSetting } from '@/components/BlinkoSettings/ImportSetting';
import { ExportSetting } from '@/components/BlinkoSettings/ExportSetting';
import { AboutSetting } from '@/components/BlinkoSettings/AboutSetting';
import { ACCENT_SWATCHES, PRESET_THEMES, type BkemoPreset, type BkemoPrefs, type BkemoTheme, type BkemoDensity } from '@/lib/bkemoSettings';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.06em', color: 'var(--fg-3)', textTransform: 'uppercase' };

// Group settings sections by visual tabs
const GROUP_OF: Record<string, 'you' | 'system' | 'data'> = {
  prefs: 'you',
  appear: 'you',
  account: 'you',
  ai: 'system',
  task: 'system',
  storage: 'system',
  import: 'data',
  export: 'data',
  about: 'data',
};
const GROUPS: { id: 'you' | 'system' | 'data'; label: string }[] = [
  { id: 'you', label: 'You' }, { id: 'system', label: 'System' }, { id: 'data', label: 'Data' },
];

function Segmented<T extends string>({ options, active, onChange }: { options: { v: T; label: string }[]; active: T; onChange: (v: T) => void }) {
  return (
    <div className="h-stack" style={{ background: 'var(--bg-2)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', padding: 2, gap: 2 }}>
      {options.map((o) => (
        <span key={o.v} onClick={() => onChange(o.v)} style={{ padding: '4px 12px', borderRadius: 4, background: o.v === active ? 'var(--accent)' : 'transparent', color: o.v === active ? '#ffffff' : 'var(--fg-2)', fontSize: 12, cursor: 'pointer', fontWeight: o.v === active ? 500 : 'normal', transition: 'background 0.15s, color 0.15s' }}>{o.label}</span>
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

const Appearance = observer(function Appearance({
  prefs,
  onChange,
  currentFont,
  onFontChange,
}: {
  prefs: BkemoPrefs;
  onChange: (p: Partial<BkemoPrefs>) => void;
  currentFont: string;
  onFontChange: (f: string) => void;
}) {
  const customInputRef = useRef<HTMLInputElement>(null);
  const isCustomAccent = !ACCENT_SWATCHES.map((c) => c.toUpperCase()).includes(prefs.accent.toUpperCase());

  // Check if current settings match any preset
  const activePreset = PRESET_THEMES.find(
    (p) =>
      p.theme === prefs.theme &&
      p.accent.toLowerCase() === prefs.accent.toLowerCase() &&
      p.density === prefs.density &&
      p.font === currentFont
  );

  return (
    <div className="v-stack" style={{ gap: 24 }}>
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 600, color: 'var(--fg)', letterSpacing: '-0.02em', margin: 0 }}>Appearance</h2>
        <div style={{ color: 'var(--fg-2)', fontSize: 13, marginTop: 4, marginBottom: 18 }}>Theme, accent and density for the bkemo workspace.</div>
      </div>

      {/* Preset Themes Section */}
      <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 24 }}>
        <div style={{ fontSize: 14, color: 'var(--fg)', fontWeight: 500, marginBottom: 12 }}>Preset Themes</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12 }}>
          {PRESET_THEMES.map((preset) => {
            const isSelected = activePreset?.key === preset.key;
            return (
              <div
                key={preset.key}
                onClick={() => {
                  onChange({ theme: preset.theme, accent: preset.accent, density: preset.density });
                  onFontChange(preset.font);
                }}
                style={{
                  padding: 12,
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--bg-2)',
                  border: isSelected ? `2px solid ${preset.accent}` : '2px solid var(--border)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
                className="hover-card"
              >
                <div className="h-stack" style={{ justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{preset.name}</span>
                  <div className="h-stack" style={{ gap: 4 }}>
                    <span
                      style={{
                        fontSize: 9,
                        padding: '1px 5px',
                        borderRadius: 4,
                        background: preset.theme === 'dark' ? '#1f2023' : '#e2e8f0',
                        color: preset.theme === 'dark' ? '#a1a1aa' : '#475569',
                        textTransform: 'uppercase',
                        fontWeight: 700,
                      }}
                    >
                      {preset.theme}
                    </span>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-2)', lineHeight: 1.4, flex: 1 }}>
                  {preset.description}
                </div>
                <div className="h-stack" style={{ gap: 8, marginTop: 4, fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                  <div className="h-stack" style={{ gap: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: preset.accent }} />
                    <span>{preset.accent}</span>
                  </div>
                  <span>•</span>
                  <span>{preset.font === 'default' ? 'System' : preset.font}</span>
                  <span>•</span>
                  <span style={{ textTransform: 'capitalize' }}>{preset.density}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Row title="Theme" sub="bkemo defaults to dark." control={
        <Segmented<BkemoTheme> options={[{ v: 'dark', label: 'Dark' }, { v: 'light', label: 'Light' }]} active={prefs.theme} onChange={(v) => onChange({ theme: v })} />
      } />
      <Row title="Accent color" sub="Used for #tags, checkboxes, focus and charts." control={
        <div className="h-stack" style={{ gap: 8, flexWrap: 'wrap', maxWidth: 360, justifyContent: 'flex-end' }}>
          {ACCENT_SWATCHES.map((c) => (
            <span key={c} onClick={() => onChange({ accent: c })} style={{ width: 26, height: 26, borderRadius: 50, background: c, cursor: 'pointer', border: c.toUpperCase() === prefs.accent.toUpperCase() ? '2px solid var(--fg)' : '2px solid transparent', outline: c.toUpperCase() === prefs.accent.toUpperCase() ? '2px solid var(--accent)' : 'none', outlineOffset: -4 }} />
          ))}
          {/* Custom color picker swatch */}
          <div style={{ position: 'relative', width: 26, height: 26 }}>
            <span
              onClick={() => customInputRef.current?.click()}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 26,
                height: 26,
                borderRadius: 50,
                background: isCustomAccent ? prefs.accent : 'linear-gradient(135deg, #ff007f, #00f0ff, #ff00ff)',
                cursor: 'pointer',
                border: isCustomAccent ? '2px solid var(--fg)' : '2px solid transparent',
                outline: isCustomAccent ? '2px solid var(--accent)' : 'none',
                outlineOffset: -4,
                boxShadow: 'inset 0 0 2px rgba(0,0,0,0.2)'
              }}
              title="Custom Accent Color"
            >
              <Icon
                icon="tabler:color-picker"
                width={14}
                height={14}
                style={{ color: '#fff', mixBlendMode: 'difference' }}
              />
            </span>
            <input
              ref={customInputRef}
              type="color"
              value={prefs.accent}
              onChange={(e) => onChange({ accent: e.target.value })}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                opacity: 0,
                width: 0,
                height: 0,
                pointerEvents: 'none'
              }}
            />
          </div>
        </div>
      } />
      <Row title="Density" sub="How tightly the stream and lists pack." control={
        <Segmented<BkemoDensity> options={[{ v: 'compact', label: 'Compact' }, { v: 'regular', label: 'Regular' }, { v: 'comfy', label: 'Comfy' }]} active={prefs.density} onChange={(v) => onChange({ density: v })} />
      } />
    </div>
  );
});

// ── bkemo-native form controls (themed to the bkemo palette) ──
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <span onClick={() => onChange(!on)} style={{ width: 38, height: 22, borderRadius: 100, background: on ? 'var(--accent)' : 'var(--bg-3)', border: '1px solid var(--border-2)', position: 'relative', cursor: 'pointer', flexShrink: 0, transition: 'background .15s', display: 'inline-block' }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: 50, background: '#fff', transition: 'left .15s' }} />
    </span>
  );
}

const fieldStyle: React.CSSProperties = { background: 'var(--bg-2)', color: 'var(--fg)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', padding: '5px 9px', fontSize: 12, fontFamily: 'inherit' };

function NativeSelect({ value, options, onChange }: { value: string; options: { v: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={fieldStyle}>
      {options.map((o) => <option key={o.v} value={o.v} style={{ background: 'var(--bg-2)', color: 'var(--fg)' }}>{o.label}</option>)}
    </select>
  );
}

function NumberField({ value, suffix, min, onCommit }: { value: number; suffix?: string; min?: number; onCommit: (v: number) => void }) {
  const [raw, setRaw] = useState(String(value));
  useEffect(() => { setRaw(String(value)); }, [value]);
  return (
    <span className="h-stack" style={{ gap: 6 }}>
      <input
        type="number" value={raw} min={min}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={() => { const n = parseInt(raw, 10); if (!isNaN(n)) onCommit(n); else setRaw(String(value)); }}
        style={{ ...fieldStyle, width: 84 }}
      />
      {suffix && <span style={{ color: 'var(--fg-3)', fontSize: 12 }}>{suffix}</span>}
    </span>
  );
}

const TIME_FORMATS = [
  { v: 'relative', label: '1 seconds ago' },
  { v: 'YYYY-MM-DD', label: '2024-01-01' },
  { v: 'YYYY-MM-DD HH:mm', label: '2024-01-01 15:30' },
  { v: 'HH:mm', label: '15:30' },
  { v: 'YYYY-MM-DD HH:mm:ss', label: '2024-01-01 15:30:45' },
  { v: 'MM-DD HH:mm', label: '03-20 15:30' },
  { v: 'MMM DD, YYYY', label: 'Mar 20, 2024' },
  { v: 'MMM DD, YYYY HH:mm', label: 'Mar 20, 2024 15:30' },
  { v: 'dddd, MMM DD, YYYY', label: 'Monday, Mar 20, 2024' },
];
const COL_OPTS = (max: number) => Array.from({ length: max }, (_, i) => ({ v: String(i + 1), label: String(i + 1) }));

const setConfig = async (key: string, value: any) => {
  const blinko = RootStore.Get(BlinkoStore);
  await PromiseCall(api.config.update.mutate({ key: key as any, value }), { autoAlert: false });
  await blinko.config.call();
};

const Preferences = observer(function Preferences() {
  const blinko = RootStore.Get(BlinkoStore);
  const user = RootStore.Get(UserStore);
  const c = (blinko.config.value ?? {}) as Record<string, any>;
  const [pageSize, setPageSizeState] = useState(PageSize.value);
  const [webhookEndpoint, setWebhookEndpoint] = useState('');

  useEffect(() => { if (!blinko.config.value) blinko.config.call(); }, []);
  useEffect(() => {
    setWebhookEndpoint(blinko.config.value?.webhookEndpoint ?? '');
  }, [blinko.config.value]);

  return (
    <div>
      <h2 style={{ fontSize: 24, fontWeight: 600, color: 'var(--fg)', letterSpacing: '-0.02em', margin: 0 }}>Preferences</h2>
      <div style={{ color: 'var(--fg-2)', fontSize: 13, marginTop: 4, marginBottom: 18 }}>How the stream, cards and navigation behave. Synced to your account.</div>

      <Row title="Language" sub="Interface language for settings and menus." control={
        <div className="dark bk-legacy-settings">
          <LanguageSwitcher value={c.language} onChange={(v: string) => setConfig('language', v)} />
        </div>
      } />

      <Row title="Default font" sub="Body font for the bkemo workspace." control={
        <div className="dark bk-legacy-settings">
          <FontSwitcher fontname={c.fontStyle} onChange={(v: string) => setConfig('fontStyle', v)} />
        </div>
      } />

      <Row title="Timestamp format" sub="How memo times read on each card." control={
        <NativeSelect value={c.timeFormat ?? 'YYYY-MM-DD HH:mm:ss'} options={TIME_FORMATS} onChange={(v) => setConfig('timeFormat', v)} />
      } />

      <Row title="Order by creation time" sub="Sort and group the stream by when memos were created instead of last edited." control={
        <Toggle on={!!c.isOrderByCreateTime} onChange={(v) => setConfig('isOrderByCreateTime', v)} />
      } />

      <Row title="Hide comments & reactions on cards" sub="Removes comments and reactions from stream cards. They still work on the public page." control={
        <Toggle on={!!c.isHideCommentInCard} onChange={(v) => setConfig('isHideCommentInCard', v)} />
      } />

      <Row title="Fold long memos" sub="Memos longer than this collapse behind “Show more”. 0 disables folding." control={
        <NumberField value={c.textFoldLength ?? 500} suffix="chars" min={0} onCommit={(v) => setConfig('textFoldLength', v)} />
      } />

      <Row title="Card columns" sub="Cards per row on phone · tablet · desktop." control={
        <div className="h-stack" style={{ gap: 8 }}>
          <NativeSelect value={String(c.smallDeviceCardColumns ?? 1)} options={COL_OPTS(2)} onChange={(v) => setConfig('smallDeviceCardColumns', v)} />
          <NativeSelect value={String(c.mediumDeviceCardColumns ?? 2)} options={COL_OPTS(4)} onChange={(v) => setConfig('mediumDeviceCardColumns', v)} />
          <NativeSelect value={String(c.largeDeviceCardColumns ?? 2)} options={COL_OPTS(6)} onChange={(v) => setConfig('largeDeviceCardColumns', v)} />
        </div>
      } />

      <Row title="Max content width" sub="Stream max width in px. 0 uses the responsive default." control={
        <NumberField value={c.maxHomePageWidth ?? 0} suffix="px" min={0} onCommit={(v) => setConfig('maxHomePageWidth', v)} />
      } />

      <Row title="Notes per load" sub="How many memos load per batch on the stream." control={
        <NumberField value={pageSize} min={10} onCommit={(v) => { const n = Math.min(100, Math.max(10, v)); PageSize.save(n); setPageSizeState(n); }} />
      } />

      <Row title="Close Daily review" sub="Hide the Daily review screen and its navigation entries." control={
        <Toggle on={!!c.isCloseDailyReview} onChange={(v) => setConfig('isCloseDailyReview', v)} />
      } />

      <Row title="Use modal editor on desktop" sub="Hide the inline composer; open the full-screen memo editor instead (the mobile-style editor)." control={
        <Toggle on={!!c.hidePcEditor} onChange={(v) => setConfig('hidePcEditor', v)} />
      } />

      <Row title="Hide mobile tab bar" sub="Hide the bottom navigation bar on phones." control={
        <Toggle on={!!c.isHiddenMobileBar} onChange={(v) => setConfig('isHiddenMobileBar', v)} />
      } />

      {/* Administrative System Settings */}
      {user.canManageSite && (
        <div style={{ marginTop: 32 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg)', marginTop: 24, marginBottom: 8, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>System Settings (Admin Only)</h3>
          
          <Row
            title="Allow Registration"
            sub="Allow new users to sign up on the registration page."
            control={
              <Toggle
                on={user.canRegister.value ?? false}
                onChange={async (checked) => {
                  await PromiseCall(api.config.update.mutate({
                    key: 'isAllowRegister',
                    value: checked
                  }));
                  await user.canRegister.call();
                }}
              />
            }
          />

          <Row
            title="Webhook"
            sub="Callback endpoint to trigger on system events."
            control={
              <input
                type="text"
                placeholder="Enter webhook URL"
                value={webhookEndpoint}
                onChange={(e) => setWebhookEndpoint(e.target.value)}
                onBlur={async () => {
                  await PromiseCall(api.config.update.mutate({
                    key: 'webhookEndpoint',
                    value: webhookEndpoint
                  }));
                }}
                style={{ ...fieldStyle, width: 240, outline: 'none' }}
              />
            }
          />
        </div>
      )}
    </div>
  );
});

const Account = observer(function Account() {
  const user = RootStore.Get(UserStore);
  return (
    <div className="v-stack" style={{ gap: 32 }}>
      <BasicSetting />
      {user.canManageUsers && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 32, marginTop: 16 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--fg)', marginBottom: 16 }}>User Management</h3>
          <UsersScreen />
        </div>
      )}
    </div>
  );
});

const displayTitle = (s: { key: string; title: string }) => {
  if (s.key === 'prefs') return 'Preferences';
  if (s.key === 'appear') return 'Appearance';
  if (s.key === 'account') return 'Account & Users';
  return s.title;
};

export const SettingsScreen = observer(function SettingsScreen({ prefs, onChange }: { prefs: BkemoPrefs; onChange: (p: Partial<BkemoPrefs>) => void }) {
  const { t } = useTranslation();
  const user = RootStore.Get(UserStore);
  const blinko = RootStore.Get(BlinkoStore);
  const [section, setSection] = useState('prefs');

  const c = (blinko.config.value ?? {}) as Record<string, any>;

  const sections = [
    { key: 'prefs', title: 'Preferences', icon: 'tabler:settings-2', requireAdmin: false, component: <Preferences /> },
    {
      key: 'appear',
      title: 'Appearance',
      icon: 'tabler:palette',
      requireAdmin: false,
      component: (
        <Appearance
          prefs={prefs}
          onChange={onChange}
          currentFont={c.fontStyle || 'default'}
          onFontChange={(v) => setConfig('fontStyle', v)}
        />
      ),
    },
    { key: 'account', title: 'Account', icon: 'tabler:user', requireAdmin: false, component: <Account /> },
    ...(user.canManageSite ? [
      { key: 'ai', title: 'AI', icon: 'hugeicons:ai-beautify', requireAdmin: true, component: <AiSetting /> },
      { key: 'task', title: 'Schedule Task', icon: 'tabler:list-check', requireAdmin: true, component: <TaskSetting /> },
      { key: 'storage', title: 'Storage', icon: 'tabler:database', requireAdmin: true, component: <StorageSetting /> },
    ] : []),
    { key: 'import', title: 'Import', icon: 'tabler:file-import', requireAdmin: true, component: <ImportSetting /> },
    { key: 'export', title: 'Export', icon: 'tabler:file-export', requireAdmin: false, component: <ExportSetting /> },
    { key: 'about', title: 'About', icon: 'tabler:info-circle', requireAdmin: false, component: <AboutSetting /> },
  ];

  const active = sections.find((s) => s.key === section) ?? sections[0];

  return (
    <div className="v-stack" style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
      <div className="h-stack" style={{ height: 44, padding: '0 18px', borderBottom: '1px solid var(--border)', gap: 10, background: 'var(--bg)' }}>
        <span style={{ color: 'var(--fg)', fontSize: 13, fontWeight: 500 }}>Settings</span>
        <span style={{ color: 'var(--fg-3)' }}>/</span>
        <span style={{ color: 'var(--fg-2)', fontSize: 13 }}>{displayTitle(active)}</span>
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
                  <div key={s.key} onClick={() => setSection(s.key)} className="h-stack" style={{ gap: 8, padding: '6px 10px', borderRadius: 'var(--radius)', background: section === s.key ? 'var(--accent-soft)' : 'transparent', color: section === s.key ? 'var(--accent)' : 'var(--fg-2)', borderLeft: section === s.key ? '2px solid var(--accent)' : '2px solid transparent', fontSize: 13, cursor: 'pointer' }}>
                    <Icon icon={s.icon} width={16} height={16} style={{ color: section === s.key ? 'var(--accent)' : 'var(--fg-3)', flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayTitle(s)}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        {/* body — bkemo-native Appearance/Preferences/Account render bare; reused Blinko sections are
            wrapped in `dark bk-legacy-settings` so HeroUI maps to the bkemo palette. */}
        <div className="bk-scroll" style={{ flex: 1, overflow: 'auto', padding: '24px 28px 48px' }}>
          <div
            key={active.key}
            className={active.key === 'appear' || active.key === 'about' || active.key === 'account' || active.key === 'prefs' ? undefined : 'dark bk-legacy-settings'}
            style={{ maxWidth: 860 }}
          >
            {active.component}
          </div>
        </div>
      </div>
    </div>
  );
});
