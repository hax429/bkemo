# bkemo UI reference

Current visual system for agents changing React UI. Source of truth for tokens
and class names is `app/src/styles/bkemo-theme.css`. Preferences live in
`app/src/lib/bkemoSettings.ts`.

## Design language

bkemo UI is dark-first and Linear / Issue-inspired: sparse surfaces, hairline
borders, mono kickers, compact rows. Prefer native controls + `bk-*` CSS over
HeroUI chrome. Do not ship purple HeroUI panel look, marketing card grids with
arrows, or glossy multi-layer shadows.

Priority signals are separate from brand accent:

- `--accent` — primary CTA / selection (user-overridable)
- `--important` — gold, high-value / matters
- `--urgent` — red, time-critical

## Token scope

All product UI must live under a `.bkemo` root so CSS variables apply:

| Attribute / style | Meaning |
|---|---|
| `className="bkemo"` | Enables token scope |
| `data-theme="dark" \| "light"` | Light/dark surfaces |
| `data-preset="coffee" \| "developer" \| "dusk"` | Warm / clinical / default dusk |
| `data-density="compact" \| "regular" \| "comfy"` | Row padding / line-height |
| `style={{ ['--accent']: prefs.accent }}` | Custom accent override |

Core tokens: `--bg`, `--bg-2`, `--bg-3`, `--fg`, `--fg-2`, `--fg-3`, `--border`,
`--border-2`, `--hover`, `--accent`, `--accent-soft`, `--important`, `--urgent`,
`--radius`, `--radius-lg`, `--font-mono`, `--font-body`, `--note-font`.

Presets:

- **Coffee** — warm espresso blacks, cream text, honey accent default
- **Developer** — clinical near-black, rigid 6–8px radius, Issue blue accent
- **Dusk** — default violet-tinted dark when accent is neither coffee nor developer

Root shell: `app/src/components/bkemo/BkemoLayout.tsx`.

## Typography patterns

- Body / UI: Inter (or Settings font override via `--font-family`)
- Note content: Lora (`--note-font`)
- Kickers / meta / empty states: `var(--font-mono)`, ~10.5–11px, uppercase,
  letter-spacing ~0.06–0.08em, color `--fg-3`
- Titles: 13–17px, weight ~600–650, color `--fg`
- Supporting copy: 12–12.5px, `--fg-2`

Shared kicker classes: `.bk-ai-dialog-kicker`, `.bk-ai-setup-kicker`,
`.bk-ai-message-role`.

## Layout helpers

Inside `.bkemo`:

- `.h-stack` / `.v-stack` / `.spacer`
- `.bk-scroll` — hide scrollbars on dense panes

Memo stream cards use `.bk-memo` with hover lift; keep that pattern for stream
items, not for settings lists or AI pickers.

## Native controls

Prefer native `<input>`, `<select>`, `<textarea>`, `<button>` styled with:

| Class | Role |
|---|---|
| `.bk-native-field` | Label + control stack; label is mono uppercase |
| `.bk-native-input-wrap` | Composer-like field shell |
| `.bk-native-button` | `is-primary` / `is-secondary` / `is-ghost` / `is-small` |
| `.bk-native-mini-button` | Inline field actions (e.g. copy) |
| `.bk-native-textarea` | Settings textareas |

Focus ring: accent border + `--accent-soft` glow. Do not introduce new HeroUI
`Input` / `Select` / `Button` for AI dialogs or new bkemo surfaces.

## AI shell

Primary files:

- `app/src/components/bkemo/ai/AIThread.tsx`
- `app/src/components/bkemo/AIScreen.tsx`
- `.bk-ai-shell`, `.bk-ai-sidebar`, `.bk-ai-composer`, `.bk-ai-message*` in
  `bkemo-theme.css`

Patterns to copy when building AI-adjacent UI:

- Flat sidebar conversation rows (`.bk-ai-conversation`, `.is-active`)
- Accent-filled primary buttons (new chat, send)
- User bubbles on `--bg-2`; assistant messages as open text with hairline divider
- Composer bar: bordered `--bg-2` wrap, transparent textarea, accent Send
- Mono empty states (`.bk-ai-empty-chat`)

## AI settings & dialogs

Settings mount: `app/src/components/BlinkoSettings/AiSetting/`.

| Surface | File | Notes |
|---|---|---|
| Setup overview | `AiSetupOverview.tsx` | Status grid + CTAs |
| Provider / model list | `ProviderCard.tsx`, `AiSetting.tsx` | Still has some HeroUI; prefer native on new work |
| Connect provider | `ProviderDialogContent.tsx` | Searchable provider rows |
| Add / edit model | `ModelDialogContent.tsx` | Filterable model list + capability pills |

Dialog open pattern via `DialogStore`:

```ts
RootStore.Get(DialogStore).setData({
  isOpen: true,
  size: '2xl',
  noPadding: true,
  onlyContent: true,
  className: 'bk-ai-modal',
  content: <ProviderDialogContent />,
});
```

Dialog chrome classes:

| Class | Role |
|---|---|
| `.bk-ai-modal` | Transparent HeroUI Modal wrapper |
| `.bk-ai-dialog` | Native dialog surface (also add `bkemo` + theme attrs) |
| `.bk-ai-dialog-hero` / `-body` / `-footer` | Compact header / content / actions |
| `.bk-ai-dialog-progress` | Quiet `Select · Configure` text steps |
| `.bk-ai-search-field` | Search input with icon |
| `.bk-ai-pick-list` | Scrollable selection list |
| `.bk-ai-provider-row` | Provider pick row (`is-pinned` for Custom) |
| `.bk-ai-pick-model-row` | Model pick row (`is-selected`) |
| `.bk-ai-capability-pill` | Capability toggle (`is-selected`) |

Do **not** reuse `.bk-ai-model-row` for dialog pickers — that class belongs to
`ProviderCard` list rows in settings.

### Portaled theme sync

Dialogs portal outside the app `.bkemo` root. Every AI dialog root must carry
theme attrs, matching `NoteModal` / `ContextMenu`:

```tsx
const prefs = loadPrefs();
const preset = prefs.theme === 'light'
  ? 'light'
  : prefs.accent?.toLowerCase() === '#5e6ad2'
    ? 'developer'
    : prefs.accent?.toLowerCase() === '#e2a96b'
      ? 'coffee'
      : 'dusk';

<div
  className="bkemo bk-ai-dialog"
  data-theme={prefs.theme}
  data-density={prefs.density}
  data-preset={preset}
  style={prefs.accent ? { ['--accent' as any]: prefs.accent } : undefined}
>
```

## Selection UX rules

For catalogs (providers, models, conversations):

- Use searchable / filterable **flat rows**, not 2-column marketing cards
- Pin special entries (e.g. Custom provider) at the top
- Show selection with `.is-selected` / `.is-active`, not heavy borders or glow
- Keep density close to the AI conversation sidebar

## What to avoid

- New HeroUI `Modal` / `Card` / `Button` skins for bkemo product surfaces
- Purple-on-white or purple panel defaults that ignore `.bkemo` tokens
- Numbered circle steppers, arrow-card grids, badge stickers on media
- Using `--accent` for priority meaning (use `--important` / `--urgent`)
- Assuming CSS variables work outside `.bkemo` without copying attrs

## Key files

| Path | Role |
|---|---|
| `app/src/styles/bkemo-theme.css` | Tokens + `bk-*` / `bk-ai-*` styles |
| `app/src/lib/bkemoSettings.ts` | Prefs, presets, accent swatches |
| `app/src/components/bkemo/BkemoLayout.tsx` | App root token shell |
| `app/src/components/bkemo/ai/AIThread.tsx` | Canonical AI chat UI |
| `app/src/components/BlinkoSettings/AiSetting/*` | Settings AI + provider/model dialogs |
| `app/src/store/module/Dialog/` | Modal host (`onlyContent` + `bk-ai-modal`) |
