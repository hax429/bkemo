import type { BkemoAttachment, BkemoNote } from '../types.js';
import {
  cardAccent,
  formatNoteTime,
  isTaskNote,
  noteCardBody,
  noteTags,
} from './noteList.js';

export type MemoCardRenderOptions = {
  note: BkemoNote;
  selected?: boolean;
  editing?: boolean;
  /** Fill `.bkemo-memo-body`. Defaults to plain text of `noteCardBody(note)`. */
  renderBody?: (host: HTMLElement, markdown: string) => void;
  renderAttachments?: (host: HTMLElement, attachments: BkemoAttachment[]) => void;
  onSelect?: (note: BkemoNote) => void;
  onEdit?: (note: BkemoNote) => void;
};

/** Build one feed memo card. Pure DOM — no Obsidian App dependency. */
export function renderMemoCard(parent: HTMLElement, options: MemoCardRenderOptions): HTMLElement {
  const {
    note,
    selected = false,
    editing = false,
    renderBody = (host, markdown) => {
      host.createEl('pre', { cls: 'bkemo-memo-plain', text: markdown });
    },
    renderAttachments,
    onSelect,
    onEdit,
  } = options;

  const accent = cardAccent(note);
  const card = parent.createDiv({
    cls: `bkemo-memo is-${accent}${selected ? ' is-active' : ''}${editing ? ' is-editing' : ''}`,
    attr: {
      role: 'button',
      tabindex: '0',
      'data-portable-id': note.portableId,
    },
  });

  const meta = card.createDiv({ cls: 'bkemo-memo-meta' });
  meta.createSpan({ cls: 'bkemo-memo-time', text: formatNoteTime(note.updatedAt) });
  const badges = meta.createDiv({ cls: 'bkemo-memo-badges' });
  if (isTaskNote(note)) badges.createSpan({ cls: 'bkemo-badge is-task', text: 'task' });
  if (note.isImportant) badges.createSpan({ cls: 'bkemo-badge is-important', text: 'important' });
  if (note.isUrgent) badges.createSpan({ cls: 'bkemo-badge is-urgent', text: 'urgent' });
  if (note.isArchived) badges.createSpan({ cls: 'bkemo-badge', text: 'archived' });

  const body = card.createDiv({ cls: 'bkemo-memo-body' });
  renderBody(body, noteCardBody(note));

  const tags = noteTags(note);
  if (tags.length) {
    const tagRow = card.createDiv({ cls: 'bkemo-tag-row' });
    for (const tag of tags) {
      tagRow.createSpan({ cls: 'bkemo-tag', text: `#${tag}` });
    }
  }

  renderAttachments?.(card, note.attachments || []);

  if (onSelect) {
    card.onclick = (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('a, button, .bkemo-attachment-file')) return;
      onSelect(note);
    };
    card.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(note);
      }
    };
  }

  if (onEdit) {
    card.ondblclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      onEdit(note);
    };
  }

  return card;
}

/** Compact attachment filename row used on cards and dock panels. */
export function renderAttachmentFilenames(
  host: HTMLElement,
  attachments: BkemoAttachment[],
  opts: {
    onOpen?: (attachment: BkemoAttachment) => void;
    onCopy?: (attachment: BkemoAttachment) => void;
    formatTitle?: (attachment: BkemoAttachment) => string;
  } = {},
): HTMLElement | null {
  if (!attachments.length) return null;
  const row = host.createDiv({ cls: 'bkemo-attachment-names' });
  for (const attachment of attachments) {
    const line = row.createDiv({ cls: 'bkemo-attachment-line' });
    const btn = line.createEl('button', {
      cls: 'bkemo-attachment-file',
      text: attachment.name || 'attachment',
      attr: {
        type: 'button',
        'aria-label': `Open attachment ${attachment.name || 'attachment'}`,
        title: opts.formatTitle?.(attachment) || '',
      },
    });
    if (opts.onOpen) {
      btn.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        opts.onOpen?.(attachment);
      };
    }
    if (opts.onCopy) {
      const copyBtn = line.createEl('button', {
        cls: 'bkemo-btn is-ghost bkemo-attachment-copy',
        text: 'Copy',
        attr: {
          type: 'button',
          'aria-label': `Copy ${attachment.name || 'attachment'} to vault`,
        },
      });
      copyBtn.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        opts.onCopy?.(attachment);
      };
    }
  }
  return row;
}
