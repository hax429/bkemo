import type { ShareImageTemplateId } from './types';

/** Lightweight SVG / image stickers — decorative, non-interactive. */
export function ShareDecor({ template }: { template: ShareImageTemplateId }) {
  return (
    <div className="bk-share-decor" aria-hidden>
      {(template === 'peach' || template === 'calendar' || template === 'frame') && (
        <>
          <svg className="bk-share-sticker bk-share-sticker--tl" viewBox="0 0 64 64" width="56" height="56">
            <path d="M32 4l4.2 12.8H50l-11 8 4.2 12.8L32 29.6 20.8 37.6 25 24.8 14 16.8h13.8z" fill="currentColor" opacity="0.55" />
          </svg>
          <svg className="bk-share-sticker bk-share-sticker--br" viewBox="0 0 64 64" width="48" height="48">
            <circle cx="32" cy="32" r="10" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.45" />
            <circle cx="32" cy="32" r="3" fill="currentColor" opacity="0.55" />
            <path d="M32 6v8M32 50v8M6 32h8M50 32h8M14 14l6 6M44 44l6 6M14 50l6-6M44 20l6-6" stroke="currentColor" strokeWidth="2.5" opacity="0.4" />
          </svg>
        </>
      )}
      {(template === 'peach' || template === 'calendar') && (
        <svg className="bk-share-sticker bk-share-sticker--tr" viewBox="0 0 80 40" width="72" height="36">
          <path d="M8 28c8-18 20-22 32-10 8 8 16 6 24-2" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.4" />
          <circle cx="12" cy="26" r="3" fill="currentColor" opacity="0.45" />
          <circle cx="64" cy="16" r="2.5" fill="currentColor" opacity="0.45" />
        </svg>
      )}
      {template === 'frame' && (
        <>
          <svg className="bk-share-sticker bk-share-sticker--seal" viewBox="0 0 72 72" width="64" height="64">
            <circle cx="36" cy="36" r="28" fill="currentColor" opacity="0.9" />
            <circle cx="36" cy="36" r="22" fill="none" stroke="#fff" strokeWidth="2" opacity="0.55" strokeDasharray="3 3" />
            <text x="36" y="40" textAnchor="middle" fontSize="11" fill="#fff" fontFamily="ui-monospace, monospace" opacity="0.95">bk</text>
          </svg>
          <svg className="bk-share-sticker bk-share-sticker--flourish-l" viewBox="0 0 90 24" width="80" height="22">
            <path d="M2 12h24M78 12h10M30 12c8-10 22-10 30 0-8 10-22 10-30 0z" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.5" />
          </svg>
          <svg className="bk-share-sticker bk-share-sticker--flourish-r" viewBox="0 0 90 24" width="80" height="22">
            <path d="M2 12h10M54 12h34M26 12c8-10 22-10 30 0-8 10-22 10-30 0z" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.5" />
          </svg>
        </>
      )}
      {template === 'igpost' && (
        <>
          <div className="bk-share-ig-blob bk-share-ig-blob--a" />
          <div className="bk-share-ig-blob bk-share-ig-blob--b" />
          <div className="bk-share-ig-blob bk-share-ig-blob--c" />
        </>
      )}
      {template === 'receipt' && (
        <svg className="bk-share-sticker bk-share-sticker--star-sm" viewBox="0 0 40 40" width="28" height="28">
          <path d="M20 4l3 9h9l-7 5 3 9-8-5-8 5 3-9-7-5h9z" fill="currentColor" opacity="0.2" />
        </svg>
      )}
      {template === 'applenotes' && (
        <>
          <div className="bk-share-glass-shine bk-share-glass-shine--a" />
          <div className="bk-share-glass-shine bk-share-glass-shine--b" />
        </>
      )}
    </div>
  );
}
