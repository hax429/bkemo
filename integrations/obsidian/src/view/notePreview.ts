import { App, Component, MarkdownRenderer } from 'obsidian';
import type { BkemoNote } from '../types';
import { noteCardBody } from './noteList';

export function previewMarkdown(note: BkemoNote): string {
  return note.content || '_Empty note_';
}

export function previewExcerpt(note: BkemoNote): string {
  return noteCardBody(note);
}

/**
 * Render markdown with Obsidian's preview engine + theme classes
 * so callouts, lists, checkboxes, code, and embeds match Reading view.
 */
export async function renderObsidianMarkdown(
  app: App,
  markdown: string,
  el: HTMLElement,
  component: Component,
  sourcePath = '',
): Promise<void> {
  el.empty();
  el.addClasses(['markdown-preview-view', 'markdown-rendered', 'bkemo-md']);
  // Match Obsidian reading-view host so theme CSS applies inside the sidebar.
  el.toggleClass('is-readable-line-width', false);
  await MarkdownRenderer.render(app, markdown, el, sourcePath, component);
}
