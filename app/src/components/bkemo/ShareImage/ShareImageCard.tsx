import React, { useState } from 'react';
import dayjs from '@/lib/dayjs';
import { MarkdownView } from '../MarkdownView';
import { attachmentKind, attachmentUrl, KIND_ICON } from '@/lib/attachments';
import {
  countWords,
  formatShareDate,
  readingTimeMinutes,
  ratioBox,
} from './utils';
import { ShareDecor } from './ShareDecor';
import { IgBookmarkIcon, IgCommentIcon, IgHeartIcon, IgShareIcon } from './IgIcons';
import { VsCodeBody } from './VsCodeBody';
import postageStampUrl from './assets/postage-stamp.png';
import { SHARE_FONT_FAMILIES, type ShareImageContext, type ShareImageOptions } from './types';
import './shareImage.css';

type Props = {
  opts: ShareImageOptions;
  ctx: ShareImageContext;
  content: string;
  pageIndex?: number;
  pageCount?: number;
  /** Fixed height for truncate / multipage; 'auto' hugs; omit for poster (min = ratio). */
  forceHeight?: number | 'auto';
  className?: string;
  cardRef?: React.Ref<HTMLDivElement>;
};

function UserChip({
  username,
  avatarUrl,
  showAvatar,
  ring,
  avatarOnly,
}: {
  username: string;
  avatarUrl?: string;
  showAvatar: boolean;
  /** Instagram-style gradient ring */
  ring?: boolean;
  /** Avatar without the name label (X card header) */
  avatarOnly?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const initial = (username || '?').slice(0, 1).toUpperCase();
  const avatar = showAvatar && (
    avatarUrl && !broken ? (
      <img className="bk-share-avatar" src={avatarUrl} alt="" onError={() => setBroken(true)} />
    ) : (
      <span className="bk-share-avatar-fallback">{initial}</span>
    )
  );
  if (avatarOnly) {
    return ring ? <span className="bk-share-ig-ring">{avatar}</span> : <>{avatar}</>;
  }
  return (
    <div className="bk-share-user">
      {showAvatar && (ring ? <span className="bk-share-ig-ring">{avatar}</span> : avatar)}
      <span className="bk-share-username">{username || 'anonymous'}</span>
    </div>
  );
}

function AttachRow({
  attachments,
  dataUrls,
}: {
  attachments: ShareImageContext['attachments'];
  /** Pre-inlined image sources keyed by attachment path (export-safe). */
  dataUrls?: Record<string, string>;
}) {
  const [hidden, setHidden] = useState<Record<string, true>>({});
  const visible = attachments.filter((a) => a.path && !hidden[a.path]);
  if (!visible.length) return null;
  const shown = visible.length > 4 ? visible.slice(0, 3) : visible.slice(0, 4);
  const extra = visible.length - shown.length;
  // When dataUrls is provided (export path), never fall back to remote URLs —
  // those look fine in HTML but break inside modern-screenshot's SVG foreignObject.
  const exporting = dataUrls !== undefined;

  return (
    <div className="bk-share-attach">
      {shown.map((a, i) => {
        const kind = attachmentKind(a.type, a.name);
        const url = dataUrls?.[a.path] || (exporting ? '' : attachmentUrl(a.path));
        if (kind === 'image' && url) {
          return (
            <div key={a.path + i} className="bk-share-thumb">
              <img
                src={url}
                alt=""
                loading="eager"
                decoding="sync"
                onError={() => setHidden((h) => ({ ...h, [a.path]: true }))}
              />
            </div>
          );
        }
        return (
          <div key={a.path + i} className="bk-share-thumb">
            <div className="bk-share-thumb-file">
              <div style={{ fontSize: 16, marginBottom: 4 }}>{KIND_ICON[kind === 'image' ? 'image' : kind]}</div>
              <div>{a.name}</div>
            </div>
          </div>
        );
      })}
      {extra > 0 && (
        <div className="bk-share-thumb">
          <span className="bk-share-thumb-more">+{extra}</span>
        </div>
      )}
    </div>
  );
}

function MetaLine({ opts, ctx, content }: { opts: ShareImageOptions; ctx: ShareImageContext; content: string }) {
  const parts: string[] = [];
  if (opts.showWordCount) parts.push(`${countWords(content)} words`);
  if (opts.showReadingTime) {
    const m = readingTimeMinutes(content);
    if (m) parts.push(`${m} min read`);
  }
  if (opts.showReactions) {
    const n = ctx.reactionCount + ctx.commentCount;
    if (n) parts.push(`${ctx.reactionCount} reactions · ${ctx.commentCount} comments`);
  }
  if (opts.showStats) parts.push(`${ctx.memoCount} memos · ${ctx.accountDays} days`);
  if (!parts.length && !opts.customFooter.trim()) return null;
  return (
    <div className="bk-share-meta" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {parts.length > 0 && <span>{parts.join(' · ')}</span>}
      {opts.customFooter.trim() && (
        <span style={{ textTransform: 'none', letterSpacing: '0.02em' }}>{opts.customFooter.trim()}</span>
      )}
    </div>
  );
}

function Tags({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  const shown = tags.slice(0, 8);
  const extra = tags.length - shown.length;
  return (
    <div className="bk-share-tags">
      {shown.map((t) => (
        <span key={t} className="bk-share-tag">#{t}</span>
      ))}
      {extra > 0 && <span className="bk-share-tag">+{extra}</span>}
    </div>
  );
}

export function ShareImageCard({
  opts,
  ctx,
  content,
  pageIndex = 0,
  pageCount = 1,
  forceHeight,
  className,
  cardRef,
}: Props) {
  const box = ratioBox(opts.ratio);
  const autoRatio = opts.ratio === 'auto' || box.height === 'auto';
  // Poster keeps the chosen ratio as a floor; only grows when content needs more room.
  // Truncate / multipage stay locked to the ratio box.
  const posterGrow = opts.overflow === 'poster' && !autoRatio;
  const hug = forceHeight === 'auto' || (forceHeight == null && autoRatio);
  const lockedHeight = !hug && !posterGrow
    ? (typeof forceHeight === 'number' ? forceHeight : box.height)
    : null;
  const date = formatShareDate(ctx.createdAt);
  const truncate = opts.overflow === 'truncate' && lockedHeight != null;
  const fontStack = SHARE_FONT_FAMILIES.find((f) => f.id === opts.fontFamily)?.stack
    ?? SHARE_FONT_FAMILIES[0]!.stack;
  const style: React.CSSProperties = {
    width: box.width,
    height: hug ? 'auto' : posterGrow ? 'auto' : (lockedHeight as number),
    minHeight: posterGrow && typeof box.height === 'number' ? box.height : undefined,
    ['--sic-accent' as string]: opts.accent,
    ['--sic-font' as string]: fontStack,
    ['--sic-body-size' as string]: `${opts.fontSize ?? 18}px`,
  };

  const showUser = opts.showUsername;
  const pageLabel = pageCount > 1 ? `${pageIndex + 1}/${pageCount}` : null;

  const body = (
    <>
      {ctx.isTask && (
        <div className="bk-share-task">
          <span className={`bk-share-task-box${ctx.done ? ' is-done' : ''}`}>{ctx.done ? '✓' : ''}</span>
          <span>{ctx.done ? 'done' : 'task'}{ctx.dueLabel ? ` · ${ctx.dueLabel}` : ''}</span>
        </div>
      )}
      <div className="bk-share-body">
        <MarkdownView content={content} dark={opts.theme === 'dark'} />
      </div>
      {opts.showTags && <Tags tags={ctx.tags} />}
      {opts.showAttachments && <AttachRow attachments={ctx.attachments} dataUrls={ctx.attachmentDataUrls} />}
    </>
  );

  const brand = opts.showBrand ? <span className="bk-share-brand">bkemo</span> : null;

  const metaFooter = (
    <div className="bk-share-footer">
      <MetaLine opts={opts} ctx={ctx} content={content} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        {brand}
        {pageLabel && <span className="bk-share-page">{pageLabel}</span>}
      </div>
    </div>
  );

  const commonFooter = (
    <div className="bk-share-footer">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
        {showUser && <UserChip username={ctx.username} avatarUrl={ctx.avatarUrl} showAvatar={opts.showAvatar} />}
        <MetaLine opts={opts} ctx={ctx} content={content} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        {brand}
        {pageLabel && <span className="bk-share-page">{pageLabel}</span>}
      </div>
    </div>
  );

  let inner: React.ReactNode;

  switch (opts.template) {
    case 'stamp':
      inner = (
        <div className="bk-share-stamp-shell">
          <div className="bk-share-inner">
            <img
              className="bk-share-postage"
              src={postageStampUrl}
              alt=""
              draggable={false}
            />
            <div className="bk-share-stamp-edge" />
            <div className="h-stack" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              {showUser ? <UserChip username={ctx.username} avatarUrl={ctx.avatarUrl} showAvatar={opts.showAvatar} /> : <span />}
              {opts.showCreated && <span className="bk-share-meta">{date.monthDay}</span>}
            </div>
            {body}
            {metaFooter}
          </div>
        </div>
      );
      break;
    case 'peach':
      inner = (
        <div className="bk-share-inner">
          {opts.showCreated && (
            <div className="bk-share-ornament">
              <span>✦ {date.full} ✦</span>
            </div>
          )}
          {body}
          {commonFooter}
        </div>
      );
      break;
    case 'calendar':
      inner = (
        <div className="bk-share-inner">
          <div className="h-stack" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            {showUser ? <UserChip username={ctx.username} avatarUrl={ctx.avatarUrl} showAvatar={opts.showAvatar} /> : <span />}
            {opts.showStats && <span className="bk-share-meta">{ctx.memoCount} memos</span>}
          </div>
          {opts.showCreated && (
            <div>
              <div className="bk-share-day">{date.day}</div>
              <div className="bk-share-day-sub">{date.weekday} · {date.year}</div>
            </div>
          )}
          <div className="bk-share-main">{body}</div>
          <div className="bk-share-footer">
            {brand}
            <div style={{ textAlign: 'right' }}>
              <MetaLine opts={opts} ctx={ctx} content={content} />
              {pageLabel && <div className="bk-share-page" style={{ marginTop: 4 }}>{pageLabel}</div>}
            </div>
          </div>
        </div>
      );
      break;
    case 'frame':
      inner = (
        <div className="bk-share-frame-mat">
          <div className="bk-share-frame-plate">
            <span className="bk-share-corner tl" />
            <span className="bk-share-corner tr" />
            <span className="bk-share-corner bl" />
            <span className="bk-share-corner br" />
            <div className="bk-share-inner">
              {opts.showCreated && <div className="bk-share-frame-date">{date.monthDay}</div>}
              {(opts.showBrand || opts.showStats) && (
                <div className="bk-share-meta" style={{ textAlign: 'center' }}>
                  {opts.showBrand && 'Captured by bkemo'}
                  {opts.showBrand && opts.showStats && ' · '}
                  {opts.showStats && `Chapter. ${ctx.memoCount}`}
                </div>
              )}
              {body}
              <div className="bk-share-footer" style={{ justifyContent: 'center', textAlign: 'center', flexDirection: 'column', gap: 8 }}>
                {showUser && (
                  <div className="bk-share-meta" style={{ textTransform: 'none', letterSpacing: '0.04em' }}>
                    {'{ Written by ──────── '}
                    {ctx.username}
                    {' }'}
                  </div>
                )}
                <MetaLine opts={opts} ctx={ctx} content={content} />
                {pageLabel && <span className="bk-share-page">{pageLabel}</span>}
              </div>
            </div>
          </div>
        </div>
      );
      break;
    case 'receipt':
      inner = (
        <div className="bk-share-receipt">
          <div className="bk-share-inner">
            {opts.showBrand && (
              <div className="bk-share-meta" style={{ textAlign: 'center', letterSpacing: '0.2em' }}>· bkemo ·</div>
            )}
            <div className="bk-share-main bk-share-receipt-main">{body}</div>
            <div className="bk-share-receipt-rows">
              {opts.showCreated && (
                <div className="bk-share-receipt-row"><span>DATE</span><span>{date.monthDay}, {date.year}</span></div>
              )}
              {showUser && (
                <div className="bk-share-receipt-row"><span>BY</span><span>{ctx.username}</span></div>
              )}
              {opts.showStats && (
                <div className="bk-share-receipt-row"><span>TOTAL</span><span>{ctx.memoCount} MEMOS · {ctx.accountDays} DAYS</span></div>
              )}
              {opts.showWordCount && (
                <div className="bk-share-receipt-row"><span>WORDS</span><span>{countWords(content)}</span></div>
              )}
              {opts.showReadingTime && readingTimeMinutes(content) > 0 && (
                <div className="bk-share-receipt-row"><span>READ</span><span>{readingTimeMinutes(content)} MIN</span></div>
              )}
              {opts.customFooter.trim() && (
                <div className="bk-share-receipt-row"><span>NOTE</span><span style={{ textTransform: 'none' }}>{opts.customFooter.trim()}</span></div>
              )}
            </div>
            <div className="bk-share-barcode" />
            {pageLabel && <div className="bk-share-page" style={{ textAlign: 'center', marginTop: 8 }}>{pageLabel}</div>}
          </div>
        </div>
      );
      break;
    case 'xcard':
      inner = (
        <div className="bk-share-inner bk-share-x-inner">
          <div className="bk-share-x-top">
            <div className="h-stack" style={{ gap: 12, alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
              {opts.showAvatar && (
                <UserChip username={ctx.username} avatarUrl={ctx.avatarUrl} showAvatar avatarOnly />
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                {showUser && (
                  <div className="bk-share-x-name-row">
                    <span className="bk-share-x-name">{ctx.username}</span>
                    <span className="bk-share-x-verified" title="Verified">✓</span>
                  </div>
                )}
                {showUser && (
                  <div className="bk-share-x-handle">@{ctx.username.replace(/\s+/g, '').toLowerCase() || 'user'}</div>
                )}
              </div>
            </div>
            <span className="bk-share-x-logo" aria-hidden>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.727-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644z" />
              </svg>
            </span>
          </div>
          {body}
          {opts.showCreated && (
            <div className="bk-share-x-time">
              {date.full.replace(/\s/g, ' · ')} · {date.year}
            </div>
          )}
          <div className="bk-share-x-divider" />
          <div className="bk-share-x-stats">
            <span><b>{Math.max(1, ctx.reactionCount || 3)}</b> Reposts</span>
            <span><b>{Math.max(1, (ctx.reactionCount || 0) + 2)}</b> Quotes</span>
            <span><b>{Math.max(ctx.commentCount || 0, 12)}</b> Likes</span>
            <span><b>{Math.max(ctx.memoCount || 1, 48)}</b> Views</span>
          </div>
          <div className="bk-share-x-divider" />
          <div className="bk-share-x-actions" aria-hidden>
            <span title="Reply">
              <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81A6.115 6.115 0 0 0 20.25 10.13C20.25 6.75 17.5 4 14.122 4H9.756z"/></svg>
            </span>
            <span title="Repost">
              <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M4.75 3.79l4.603 4.3-1.706 1.82L6 8.38v7.37c0 .97.784 1.75 1.75 1.75H13V20H7.75c-2.347 0-4.25-1.9-4.25-4.25V8.38L1.853 9.91.147 8.09l4.603-4.3zm11.5 2.71H11V4h5.25c2.347 0 4.25 1.9 4.25 4.25v7.37l1.647-1.53 1.706 1.82-4.603 4.3-4.603-4.3 1.706-1.82L18 15.62V8.25c0-.97-.784-1.75-1.75-1.75z"/></svg>
            </span>
            <span title="Like">
              <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.582 1.17-.585 3.14.896 5.33L12 21.35l6.71-8.61c1.48-2.19 1.477-4.16.895-5.33-.561-1.13-1.667-1.84-2.908-1.91zm-.421 6.56L12 18.26l-4.277-6.2c-1.005-1.48-.94-2.61-.697-3.1.25-.5.7-.85 1.29-.88.55-.03 1.4.28 2.21 1.26L12 7.58l1.475-1.5c.81-.98 1.66-1.29 2.21-1.26.59.03 1.04.38 1.29.88.243.49.308 1.62-.697 3.1z"/></svg>
            </span>
            <span title="Bookmark">
              <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5zM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11z"/></svg>
            </span>
            <span title="Share">
              <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z"/></svg>
            </span>
          </div>
          <div className="bk-share-footer" style={{ marginTop: 10 }}>
            <MetaLine opts={opts} ctx={ctx} content={content} />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {brand}
              {pageLabel && <span className="bk-share-page">{pageLabel}</span>}
            </div>
          </div>
        </div>
      );
      break;
    case 'codeblock':
      inner = (
        <div className="bk-share-inner bk-share-code-inner">
          <VsCodeBody content={content} filename={`${(ctx.username || 'note').replace(/\s+/g, '-').toLowerCase()}.md`} />
          <div className="bk-share-footer" style={{ marginTop: 10 }}>
            <MetaLine opts={opts} ctx={ctx} content={content} />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {showUser && <span className="bk-share-meta" style={{ textTransform: 'none' }}>{ctx.username}</span>}
              {brand}
              {pageLabel && <span className="bk-share-page">{pageLabel}</span>}
            </div>
          </div>
        </div>
      );
      break;
    case 'igpost':
      inner = (
        <div className="bk-share-ig-shell">
          <div className="bk-share-ig-bar" />
          <div className="bk-share-inner">
            <div className="bk-share-ig-top">
              {showUser && (
                <UserChip username={ctx.username} avatarUrl={ctx.avatarUrl} showAvatar={opts.showAvatar} ring />
              )}
              <span className="spacer" />
              {opts.showCreated && <span className="bk-share-meta">{date.monthDay}</span>}
              <span className="bk-share-ig-more" aria-hidden>⋯</span>
            </div>
            {body}
            <div className="bk-share-ig-actions" aria-hidden>
              <span className="bk-share-ig-action-group">
                <IgHeartIcon />
                <IgCommentIcon />
                <IgShareIcon />
              </span>
              <IgBookmarkIcon />
            </div>
            <div className="bk-share-ig-liked">
              Liked by <b>{ctx.username || 'you'}</b> and <b>{Math.max(12, ctx.reactionCount || 24)} others</b>
            </div>
            {ctx.commentCount > 0 && (
              <div className="bk-share-ig-comments">View all {ctx.commentCount} comments</div>
            )}
            {opts.showCreated && (
              <div className="bk-share-ig-ago">{date.monthDay.toUpperCase()}</div>
            )}
            <div className="bk-share-ig-add-comment">Add a comment…</div>
            {metaFooter}
          </div>
          <div className="bk-share-ig-bar bk-share-ig-bar--bottom" />
        </div>
      );
      break;
    case 'applenotes': {
      const appleWhen = ctx.createdAt
        ? dayjs(ctx.createdAt).format('MMMM D, YYYY [at] h:mm A')
        : dayjs().format('MMMM D, YYYY [at] h:mm A');
      inner = (
        <div className="bk-share-apple-shell">
          <div className="bk-share-apple-nav" aria-hidden>
            <span className="bk-share-apple-pill bk-share-apple-pill--round">
              {/* compose */}
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="14" height="14" rx="2" />
                <path d="M14 4l4 4M8 16l7.5-7.5" />
              </svg>
            </span>
            <div className="bk-share-apple-capsule">
              <span title="Format"><b style={{ fontSize: 12, letterSpacing: '-0.02em' }}>Aa</b></span>
              <span title="Checklist">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="6" cy="7" r="2.2" /><path d="M11 7h9M6 12.5a2.2 2.2 0 1 0 0 .01M11 12.5h9M6 18a2.2 2.2 0 1 0 0 .01M11 18h9" strokeLinecap="round" /></svg>
              </span>
              <span title="Table">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="5" width="16" height="14" rx="1.5" /><path d="M4 12h16M12 5v14" /></svg>
              </span>
              <span title="Attach">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M15.5 8.5 9.2 14.8a2.5 2.5 0 0 1-3.5-3.5l7.4-7.4a4 4 0 0 1 5.7 5.7l-8 8a5.5 5.5 0 0 1-7.8-7.8l7.1-7.1" /></svg>
              </span>
              <span title="Writing Tools">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 3c2.2 2.4 3.2 4.2 3.2 6.2A3.2 3.2 0 1 1 8.8 9.2C8.8 7.2 9.8 5.4 12 3z" /><path d="M9.5 14.5 7 20l3-1 3 1-1.5-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
            </div>
            <span className="bk-share-apple-capsule bk-share-apple-capsule--sm">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11M8 8l4-4 4 4" /><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" /></svg>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><circle cx="6" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18" cy="12" r="1.6" /></svg>
            </span>
            <span className="bk-share-apple-pill bk-share-apple-pill--round">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 3.5 3.5" strokeLinecap="round" /></svg>
            </span>
          </div>
          <div className="bk-share-apple-glass">
            <div className="bk-share-inner">
              {opts.showCreated && (
                <div className="bk-share-apple-date">{appleWhen}</div>
              )}
              {showUser && (
                <div className="bk-share-apple-user">
                  <UserChip username={ctx.username} avatarUrl={ctx.avatarUrl} showAvatar={opts.showAvatar} />
                </div>
              )}
              {body}
              <div className="bk-share-footer">
                <MetaLine opts={opts} ctx={ctx} content={content} />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  {brand}
                  {pageLabel && <span className="bk-share-page">{pageLabel}</span>}
                </div>
              </div>
            </div>
          </div>
        </div>
      );
      break;
    }
    default:
      inner = <div className="bk-share-inner">{body}{commonFooter}</div>;
  }

  return (
    <div
      ref={cardRef}
      className={`bk-share-card${truncate ? ' is-truncate' : ''}${hug ? ' is-hug' : ''}${posterGrow ? ' is-poster' : ''}${className ? ` ${className}` : ''}`}
      data-template={opts.template}
      data-theme={opts.theme}
      data-ratio={opts.ratio}
      style={style}
    >
      <ShareDecor template={opts.template} />
      {inner}
    </div>
  );
}
