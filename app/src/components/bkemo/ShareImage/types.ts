export type ShareImageTemplateId =
  | 'stamp'
  | 'peach'
  | 'calendar'
  | 'frame'
  | 'receipt'
  | 'xcard'
  | 'codeblock'
  | 'igpost'
  | 'applenotes';

export type ShareImageRatioId = '1:1' | '4:5' | '9:16' | '16:9' | '1.91:1' | 'auto';

export type ShareImageOverflow = 'truncate' | 'multipage' | 'poster';

export type ShareImageScale = 1 | 2 | 3;

export type ShareImageTheme = 'light' | 'dark';

export type ShareImageOptions = {
  template: ShareImageTemplateId;
  ratio: ShareImageRatioId;
  overflow: ShareImageOverflow;
  scale: ShareImageScale;
  theme: ShareImageTheme;
  accent: string;
  fontFamily: string;
  fontSize: number;
  showUsername: boolean;
  showAvatar: boolean;
  showBrand: boolean;
  showTags: boolean;
  showWordCount: boolean;
  showReadingTime: boolean;
  showCreated: boolean;
  showAttachments: boolean;
  showReactions: boolean;
  showStats: boolean;
  customFooter: string;
};

export type ShareImageAttachment = {
  path: string;
  name: string;
  type?: string | null;
  size?: number | string | null;
};

export type ShareImageContext = {
  content: string;
  createdAt?: Date | string | null;
  tags: string[];
  attachments: ShareImageAttachment[];
  /** path → data URL for crisp export of image attachments */
  attachmentDataUrls?: Record<string, string>;
  username: string;
  avatarUrl?: string;
  memoCount: number;
  accountDays: number;
  reactionCount: number;
  commentCount: number;
  isTask?: boolean;
  dueLabel?: string;
  done?: boolean;
};

export const TEMPLATE_META: {
  id: ShareImageTemplateId;
  label: string;
  accentable: boolean;
}[] = [
  { id: 'stamp', label: 'Stamp', accentable: true },
  { id: 'peach', label: 'Peach', accentable: true },
  { id: 'calendar', label: 'Calendar', accentable: true },
  { id: 'frame', label: 'Frame', accentable: true },
  { id: 'receipt', label: 'Receipt', accentable: false },
  { id: 'xcard', label: 'X card', accentable: true },
  { id: 'codeblock', label: 'Code', accentable: false },
  { id: 'igpost', label: 'IG post', accentable: true },
  { id: 'applenotes', label: 'Apple Notes', accentable: true },
];

/** Distinct widths — heights apply for truncate/pages; poster uses height as minimum. */
export const RATIO_META: { id: ShareImageRatioId; label: string; w: number; h: number | 'auto' }[] = [
  { id: '1:1', label: '1:1', w: 680, h: 680 },
  { id: '4:5', label: '4:5', w: 600, h: 750 },
  { id: '9:16', label: '9:16', w: 540, h: 960 },
  { id: '16:9', label: '16:9', w: 960, h: 540 },
  { id: '1.91:1', label: 'X', w: 1000, h: 524 },
  { id: 'auto', label: 'Auto', w: 640, h: 'auto' },
];

export const SHARE_FONT_FAMILIES: { id: string; label: string; stack: string }[] = [
  { id: 'note', label: 'Note serif', stack: "var(--note-font, Georgia, 'Times New Roman', serif)" },
  { id: 'system', label: 'System', stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  { id: 'outfit', label: 'Outfit', stack: "Outfit, 'Segoe UI', sans-serif" },
  { id: 'inter', label: 'Inter', stack: "Inter, 'Segoe UI', sans-serif" },
  { id: 'lora', label: 'Lora', stack: "Lora, Georgia, serif" },
  { id: 'mono', label: 'Mono', stack: "var(--font-mono, ui-monospace, Menlo, monospace)" },
];

export const SHARE_FONT_SIZES = [14, 16, 18, 20, 22, 24, 28] as const;

export const DEFAULT_SHARE_IMAGE_OPTIONS: ShareImageOptions = {
  template: 'frame',
  ratio: '1:1',
  overflow: 'truncate',
  scale: 2,
  theme: 'light',
  accent: '#e2a96b',
  fontFamily: 'note',
  fontSize: 18,
  showUsername: true,
  showAvatar: true,
  showBrand: true,
  showTags: true,
  showWordCount: false,
  showReadingTime: false,
  showCreated: true,
  showAttachments: false,
  showReactions: false,
  showStats: false,
  customFooter: '',
};
