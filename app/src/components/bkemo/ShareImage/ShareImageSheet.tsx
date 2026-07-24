import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from '@/lib/dayjs';
import type { Note } from '@shared/lib/types';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { UserStore } from '@/store/user';
import { ToastPlugin } from '@/store/module/Toast/Toast';
import { api } from '@/lib/trpc';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';
import { ACCENT_SWATCHES } from '@/lib/bkemoSettings';
import { isDone, isTask } from '@/lib/taskFilters';
import { ShareImageCard } from './ShareImageCard';
import { loadShareImagePrefs, saveShareImagePrefs } from './prefs';
import './shareImage.css';
import { copyDataUrlToClipboard, downloadDataUrl, exportSharePng, nativeShareDataUrl, urlToDataUrl } from './exportPng';
import { attachmentKind, attachmentUrl } from '@/lib/attachments';
import {
  accountDaysSince,
  extractShareTags,
  pageCharBudget,
  ratioBox,
  splitContentPages,
} from './utils';
import {
  RATIO_META,
  SHARE_FONT_FAMILIES,
  SHARE_FONT_SIZES,
  TEMPLATE_META,
  type ShareImageOptions,
  type ShareImageOverflow,
  type ShareImageRatioId,
  type ShareImageScale,
  type ShareImageTemplateId,
  type ShareImageTheme,
} from './types';

function dueLabel(dueDate?: Date | string | null): string | undefined {
  if (!dueDate) return undefined;
  const d = dayjs(dueDate).startOf('day');
  const diff = d.diff(dayjs().startOf('day'), 'day');
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff < 0) return `${-diff}d overdue`;
  return d.format('MMM D');
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 12.5, color: 'var(--fg-2)', cursor: 'pointer' }}>
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={String(o.id)}
            type="button"
            className={`bk-native-button is-small ${on ? 'is-primary' : 'is-ghost'}`}
            onClick={() => onChange(o.id)}
            style={{ minWidth: 0 }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ShareImageSheet({ note, onClose }: { note: Note; onClose: () => void }) {
  const user = RootStore.Get(UserStore);
  const blinko = RootStore.Get(BlinkoStore);
  const toast = RootStore.Get(ToastPlugin);
  const [opts, setOpts] = useState<ShareImageOptions>(() => loadShareImagePrefs());
  const [excerpt, setExcerpt] = useState(() => {
    const sel = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : '';
    return sel || note.content || '';
  });
  const [pageIndex, setPageIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [memoCount, setMemoCount] = useState(0);
  const [accountDays, setAccountDays] = useState(1);
  const exportHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveShareImagePrefs(opts);
  }, [opts]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const count = await api.notes.streamCount.query({});
        if (!cancelled) setMemoCount(count);
      } catch {
        if (!cancelled) setMemoCount(blinko.noteList.value?.length ?? 0);
      }
      try {
        const cached = localStorage.getItem('bkemo.accountStart');
        if (cached) {
          if (!cancelled) setAccountDays(accountDaysSince(cached));
          return;
        }
        const list = await blinko.queryNotes({ type: -1, isRecycle: false, isArchived: false }, 1, 200);
        const oldest = list
          .map((n) => n.createdAt)
          .filter(Boolean)
          .map((d) => dayjs(d!).valueOf())
          .sort((a, b) => a - b)[0];
        if (oldest) {
          const iso = new Date(oldest).toISOString();
          localStorage.setItem('bkemo.accountStart', iso);
          if (!cancelled) setAccountDays(accountDaysSince(iso));
        }
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = <K extends keyof ShareImageOptions>(key: K, value: ShareImageOptions[K]) => {
    setOpts((o) => ({ ...o, [key]: value }));
    if (key === 'overflow' || key === 'ratio' || key === 'template') setPageIndex(0);
  };

  const pages = useMemo(() => {
    if (opts.overflow !== 'multipage') return [excerpt];
    return splitContentPages(excerpt, pageCharBudget(opts.ratio));
  }, [excerpt, opts.overflow, opts.ratio]);

  useEffect(() => {
    if (pageIndex >= pages.length) setPageIndex(Math.max(0, pages.length - 1));
  }, [pages.length, pageIndex]);

  const avatarUrl = user.image
    ? getBlinkoEndpoint(`${user.image}${user.image.includes('?') ? '&' : '?'}token=${user.token ?? ''}`)
    : undefined;

  const reactionCount = Array.isArray(note.reactions) ? note.reactions.length : 0;
  const commentCount = note._count?.comments ?? 0;

  const ctx = useMemo(() => ({
    content: excerpt,
    createdAt: note.createdAt,
    tags: extractShareTags(excerpt, note.tags as any),
    attachments: (note.attachments ?? [])
      .filter((a: any) => a?.path)
      .map((a: any) => ({ path: a.path, name: a.name ?? 'file', type: a.type, size: a.size })),
    username: user.nickname || user.name || 'me',
    avatarUrl,
    memoCount,
    accountDays,
    reactionCount,
    commentCount,
    isTask: isTask(note),
    dueLabel: dueLabel(note.dueDate),
    done: isDone(note),
  }), [excerpt, note, user.nickname, user.name, avatarUrl, memoCount, accountDays, reactionCount, commentCount]);

  const prepareExportCtx = async () => {
    const next = { ...ctx, attachmentDataUrls: {} as Record<string, string> };
    const imageAtts = ctx.attachments.filter((a) => attachmentKind(a.type, a.name) === 'image');
    await Promise.all(
      imageAtts.map(async (a) => {
        const data = await urlToDataUrl(attachmentUrl(a.path));
        if (data) next.attachmentDataUrls[a.path] = data;
        else console.warn('[share-image] could not inline attachment', a.path);
      }),
    );
    if (ctx.avatarUrl && !ctx.avatarUrl.startsWith('data:')) {
      const av = await urlToDataUrl(ctx.avatarUrl);
      if (av) next.avatarUrl = av;
    }
    return next;
  };

  const box = ratioBox(opts.ratio);
  const autoRatio = opts.ratio === 'auto' || box.height === 'auto';
  // Poster keeps ratio as min size (card handles grow). Auto ratio hugs. Else lock height.
  const previewHeight: number | 'auto' | undefined = autoRatio
    ? 'auto'
    : opts.overflow === 'poster'
      ? undefined
      : box.height;
  const sizeLabel = autoRatio
    ? `${box.width}×auto`
    : opts.overflow === 'poster'
      ? `${box.width}×${box.height}+`
      : `${box.width}×${box.height}`;

  const accentable = TEMPLATE_META.find((t) => t.id === opts.template)?.accentable ?? false;

  const runExport = async (mode: 'download' | 'copy' | 'share') => {
    if (busy) return;
    setBusy(true);
    try {
      const host = exportHostRef.current;
      if (!host) throw new Error('Export host missing');
      const stamp = dayjs(note.createdAt ?? undefined).format('YYYYMMDD');
      const base = `bkemo-${stamp}-${note.id ?? 'note'}`;
      const exportPages = opts.overflow === 'multipage' ? pages : [excerpt];
      const urls: string[] = [];
      const { createRoot } = await import('react-dom/client');
      const exportCtx = await prepareExportCtx();

      for (let i = 0; i < exportPages.length; i++) {
        host.innerHTML = '';
        const mount = document.createElement('div');
        // Keep in-viewport so the browser actually decodes images (off-screen -10000 skips decode).
        mount.style.cssText = 'position:relative;width:max-content;';
        host.appendChild(mount);
        const root = createRoot(mount);
        await new Promise<void>((resolve) => {
          root.render(
            <ShareImageCard
              opts={opts}
              ctx={exportCtx}
              content={exportPages[i]!}
              pageIndex={i}
              pageCount={exportPages.length}
              forceHeight={
                autoRatio ? 'auto'
                  : opts.overflow === 'poster' ? undefined
                    : (typeof box.height === 'number' ? box.height : 'auto')
              }
            />,
          );
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        const el = mount.querySelector('.bk-share-card') as HTMLElement | null;
        if (!el) throw new Error('Card not rendered');
        // Wait for data: thumbs to decode before rasterize/capture
        await new Promise((r) => setTimeout(r, 80));
        const thumbImgs = [...el.querySelectorAll('.bk-share-thumb img, .bk-share-avatar')] as HTMLImageElement[];
        await Promise.all(
          thumbImgs.map(
            (img) =>
              new Promise<void>((resolve) => {
                if (img.complete && img.naturalWidth > 0) return resolve();
                const done = () => resolve();
                img.addEventListener('load', done, { once: true });
                img.addEventListener('error', done, { once: true });
                setTimeout(done, 4000);
              }),
          ),
        );
        urls.push(await exportSharePng(el, opts.scale));
        root.unmount();
      }

      if (mode === 'download') {
        urls.forEach((url, i) => {
          const name = urls.length > 1 ? `${base}-${i + 1}.png` : `${base}.png`;
          downloadDataUrl(url, name);
        });
        toast.success(urls.length > 1 ? `Saved ${urls.length} images` : 'Image saved');
      } else if (mode === 'copy') {
        const ok = await copyDataUrlToClipboard(urls[0]!);
        if (ok) toast.success(urls.length > 1 ? 'Copied page 1 (download for all pages)' : 'Copied image');
        else toast.error('Clipboard copy failed');
      } else {
        const ok = await nativeShareDataUrl(urls[0]!, urls.length > 1 ? `${base}-1.png` : `${base}.png`);
        if (!ok) {
          downloadDataUrl(urls[0]!, `${base}.png`);
          toast.success('Share unavailable — downloaded instead');
        }
      }
    } catch (e) {
      console.error('[share-image] export failed:', e);
      toast.error('Export failed');
    } finally {
      setBusy(false);
    }
  };

  const sheet = (
    <div
      className="bkemo"
      onMouseDown={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 110,
        background: 'rgba(0,0,0,.72)',
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
        padding: 'max(12px, 2vh) 12px 12px',
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 'min(1100px, 100%)',
          maxHeight: '96vh',
          background: 'var(--bg)',
          border: '1px solid var(--border-2)',
          borderRadius: 'var(--radius-lg)',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 340px)',
          gridTemplateRows: 'minmax(0, 1fr)',
          overflow: 'hidden',
          boxShadow: '0 24px 70px rgba(0,0,0,.5)',
        }}
        className="bk-share-sheet"
      >
        {/* Preview */}
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, background: '#0a0a0a', borderRight: '1px solid var(--border)' }}>
          <div className="h-stack" style={{ height: 48, padding: '0 14px', gap: 10, borderBottom: '1px solid #222' }}>
            <button type="button" className="bk-native-button is-ghost is-small" onClick={onClose} aria-label="Close">✕</button>
            <span style={{ color: '#eee', fontSize: 13, fontWeight: 600 }}>Share as image</span>
            <span className="spacer" />
            <span style={{ color: '#666', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
              {sizeLabel}
              {opts.overflow === 'poster' && !autoRatio ? ' · grow if needed' : ''}
              {opts.overflow === 'truncate' ? ' · clip' : ''}
            </span>
            {pages.length > 1 && (
              <div className="h-stack" style={{ gap: 6 }}>
                <button type="button" className="bk-native-button is-ghost is-small" disabled={pageIndex <= 0} onClick={() => setPageIndex((p) => Math.max(0, p - 1))}>‹</button>
                <span style={{ color: '#888', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{pageIndex + 1}/{pages.length}</span>
                <button type="button" className="bk-native-button is-ghost is-small" disabled={pageIndex >= pages.length - 1} onClick={() => setPageIndex((p) => Math.min(pages.length - 1, p + 1))}>›</button>
              </div>
            )}
          </div>
          <div className="bk-scroll" style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
            <div
              style={{
                width: box.width * Math.min(1, 520 / box.width),
                display: 'flex',
                justifyContent: 'center',
              }}
            >
              <div style={{ transform: `scale(${Math.min(1, 520 / box.width)})`, transformOrigin: 'top center', width: box.width }}>
                <ShareImageCard
                  opts={opts}
                  ctx={ctx}
                  content={pages[pageIndex] ?? excerpt}
                  pageIndex={pageIndex}
                  pageCount={pages.length}
                  forceHeight={previewHeight}
                />
              </div>
            </div>
          </div>
          <div style={{ padding: '10px 14px 14px', borderTop: '1px solid #222', overflowX: 'auto' }}>
            <div style={{ display: 'flex', gap: 8, minWidth: 'max-content' }}>
              {TEMPLATE_META.map((t) => {
                const on = opts.template === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => patch('template', t.id)}
                    title={t.label}
                    style={{
                      width: 72,
                      height: 88,
                      borderRadius: 8,
                      border: on ? '2px solid var(--accent)' : '1px solid #333',
                      background: '#151515',
                      color: '#ccc',
                      fontSize: 10,
                      fontFamily: 'var(--font-mono)',
                      cursor: 'pointer',
                      position: 'relative',
                      padding: 6,
                      textAlign: 'left',
                    }}
                  >
                    <div style={{
                      height: 48,
                      borderRadius: 4,
                      marginBottom: 6,
                      background:
                        t.id === 'stamp' ? opts.accent
                          : t.id === 'peach' ? 'linear-gradient(120deg,#f7d7c8,#f0c4b4)'
                            : t.id === 'calendar' ? '#e8c96a'
                              : t.id === 'frame' ? 'linear-gradient(160deg,#3a4a34,#1e2a1c)'
                                : t.id === 'receipt' ? '#fafafa'
                                  : t.id === 'xcard' ? '#0f1419'
                                    : t.id === 'codeblock' ? '#0d1117'
                                      : t.id === 'applenotes' ? 'linear-gradient(160deg,#e8eef8,#f5f0e8 50%,#dde7f5)'
                                        : 'linear-gradient(135deg,#f58529,#dd2a7b 45%,#8134af 70%,#515bd4)',
                      boxShadow: t.id === 'frame' ? 'inset 0 0 0 3px #c4b08a'
                        : t.id === 'applenotes' ? 'inset 0 0 0 1px rgba(255,255,255,.7)'
                          : undefined,
                    }} />
                    {t.label}
                    {on && <span style={{ position: 'absolute', right: 4, bottom: 4, color: '#3ddc84', fontSize: 12 }}>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Options */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg)' }}>
          <div className="bk-scroll" style={{ flex: 1, overflow: 'auto', padding: '14px 16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="bk-native-field">
              <label>Overflow</label>
              <Segmented<ShareImageOverflow>
                value={opts.overflow}
                onChange={(v) => patch('overflow', v)}
                options={[
                  { id: 'truncate', label: 'Truncate' },
                  { id: 'multipage', label: 'Pages' },
                  { id: 'poster', label: 'Poster' },
                ]}
              />
            </div>

            <div className="bk-native-field">
              <label>Ratio {opts.overflow === 'poster' ? '(min size · grows if needed)' : opts.overflow === 'multipage' ? '(page size)' : '(canvas)'}</label>
              <Segmented<ShareImageRatioId>
                value={opts.ratio}
                onChange={(v) => patch('ratio', v)}
                options={RATIO_META.map((r) => ({ id: r.id, label: r.label }))}
              />
            </div>

            <div className="bk-native-field">
              <label>Font</label>
              <select
                value={opts.fontFamily}
                onChange={(e) => patch('fontFamily', e.target.value)}
                style={{ width: '100%', padding: '8px 10px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--fg)', fontSize: 13 }}
              >
                {SHARE_FONT_FAMILIES.map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </div>

            <div className="bk-native-field">
              <label>Font size</label>
              <Segmented<number>
                value={opts.fontSize}
                onChange={(v) => patch('fontSize', v)}
                options={SHARE_FONT_SIZES.map((n) => ({ id: n, label: `${n}` }))}
              />
            </div>

            <div className="bk-native-field">
              <label>Theme</label>
              <Segmented<ShareImageTheme>
                value={opts.theme}
                onChange={(v) => patch('theme', v)}
                options={[
                  { id: 'light', label: 'Light' },
                  { id: 'dark', label: 'Dark' },
                ]}
              />
            </div>

            {accentable && (
              <div className="bk-native-field">
                <label>Accent</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {ACCENT_SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => patch('accent', c)}
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 999,
                        background: c,
                        border: opts.accent === c ? '2px solid var(--fg)' : '1px solid var(--border)',
                        cursor: 'pointer',
                      }}
                      aria-label={c}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="bk-native-field">
              <label>Export scale</label>
              <Segmented<ShareImageScale>
                value={opts.scale}
                onChange={(v) => patch('scale', v)}
                options={[
                  { id: 1, label: '1×' },
                  { id: 2, label: '2×' },
                  { id: 3, label: '3×' },
                ]}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
              <Toggle label="Username" checked={opts.showUsername} onChange={(v) => patch('showUsername', v)} />
              <Toggle label="Avatar" checked={opts.showAvatar} onChange={(v) => patch('showAvatar', v)} />
              <Toggle label="bkemo brand" checked={opts.showBrand} onChange={(v) => patch('showBrand', v)} />
              <Toggle label="Tags" checked={opts.showTags} onChange={(v) => patch('showTags', v)} />
              <Toggle label="Created date" checked={opts.showCreated} onChange={(v) => patch('showCreated', v)} />
              <Toggle label="Word count" checked={opts.showWordCount} onChange={(v) => patch('showWordCount', v)} />
              <Toggle label="Reading time" checked={opts.showReadingTime} onChange={(v) => patch('showReadingTime', v)} />
              <Toggle label="Attachments" checked={opts.showAttachments} onChange={(v) => patch('showAttachments', v)} />
              <Toggle label="Reactions & comments" checked={opts.showReactions} onChange={(v) => patch('showReactions', v)} />
              <Toggle label="Account stats" checked={opts.showStats} onChange={(v) => patch('showStats', v)} />
            </div>

            <div className="bk-native-field">
              <label>Custom footer</label>
              <input
                className="bk-native-input-wrap"
                style={{ width: '100%', padding: '8px 10px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--fg)', fontSize: 13 }}
                value={opts.customFooter}
                onChange={(e) => patch('customFooter', e.target.value)}
                placeholder="Optional signature line"
              />
            </div>

            <div className="bk-native-field">
              <label>Content</label>
              <textarea
                className="bk-native-textarea"
                value={excerpt}
                onChange={(e) => { setExcerpt(e.target.value); setPageIndex(0); }}
                rows={5}
                style={{ width: '100%', resize: 'vertical', minHeight: 88 }}
              />
            </div>
          </div>

          <div style={{ padding: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button type="button" className="bk-native-button is-primary" disabled={busy} onClick={() => void runExport('download')}>
              {busy ? 'Exporting…' : 'Download PNG'}
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="bk-native-button is-secondary" style={{ flex: 1 }} disabled={busy} onClick={() => void runExport('copy')}>
                Copy
              </button>
              <button type="button" className="bk-native-button is-secondary" style={{ flex: 1 }} disabled={busy} onClick={() => void runExport('share')}>
                Share
              </button>
            </div>
          </div>
        </div>
      </div>
      {/* Keep in-viewport: far off-screen hosts skip image decode and drop thumbs in PNG. */}
      <div
        ref={exportHostRef}
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          zIndex: -1,
          opacity: 0.01,
          pointerEvents: 'none',
          overflow: 'hidden',
        }}
        aria-hidden
      />
    </div>
  );

  return createPortal(sheet, document.body);
}

/** Convenience — currently unused; sheets are opened via local state. */
export type ShareImageTemplate = ShareImageTemplateId;
