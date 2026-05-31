/**
 * Reads the (server-persisted) Blinko `config` values that the bkemo surface
 * actually honors. The legacy preference toggles wrote to `api.config.update`;
 * bkemo now reads them here so a single source of truth drives both the
 * settings UI and the workspace.
 *
 * Call from inside an `observer` render — accessing `config.value` keeps the
 * component reactive to live updates.
 */
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';

export type BkemoConfig = {
  /** Hide the comment toggle/count on stream cards. */
  hideComments: boolean;
  /** Sort + group the stream by creation time instead of update time. */
  orderByCreate: boolean;
  /** Hide the Daily review screen + its nav entries. */
  closeDailyReview: boolean;
  /** Hide the mobile bottom tab bar. */
  hideMobileBar: boolean;
  /** Hide the inline desktop composer; use the New-memo modal instead. */
  hidePcEditor: boolean;
  /** Collapse stream memos longer than this many characters (0 = never). */
  textFoldLength: number;
  /** Override the stream content max-width in px (0 = default). */
  maxHomePageWidth: number;
  /** Card columns per device class for the stream grid. */
  smallCols: number;
  mediumCols: number;
  largeCols: number;
  /** dayjs format string, or 'relative'. */
  timeFormat: string | undefined;
  /** Custom font name (FontManager), or 'default'/undefined. */
  fontStyle: string | undefined;
};

const num = (v: unknown, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export function getBkemoConfig(): BkemoConfig {
  const c = (RootStore.Get(BlinkoStore).config.value ?? {}) as Record<string, any>;
  return {
    hideComments: !!c.isHideCommentInCard,
    orderByCreate: !!c.isOrderByCreateTime,
    closeDailyReview: !!c.isCloseDailyReview,
    hideMobileBar: !!c.isHiddenMobileBar,
    hidePcEditor: !!c.hidePcEditor,
    textFoldLength: num(c.textFoldLength, 500),
    maxHomePageWidth: Math.max(0, Number(c.maxHomePageWidth) || 0),
    smallCols: num(c.smallDeviceCardColumns, 1),
    mediumCols: num(c.mediumDeviceCardColumns, 2),
    largeCols: num(c.largeDeviceCardColumns, 2),
    timeFormat: c.timeFormat || undefined,
    fontStyle: c.fontStyle || undefined,
  };
}
