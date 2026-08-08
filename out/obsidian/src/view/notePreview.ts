import { App, Component, MarkdownRenderer } from 'obsidian';
import type { BkemoNote } from '../types';
import { noteCardBody } from './noteList';
import { markdownHostClasses } from './markdownHost';

export function previewMarkdown(note: BkemoNote): string {
  return note.content || '_Empty note_';
}

export function previewExcerpt(note: BkemoNote): string {
  return noteCardBody(note);
}

/** Render markdown with Obsidian's engine without inheriting page layout rules. */
export async function renderObsidianMarkdown(
  app: App,
  markdown: string,
  el: HTMLElement,
  component: Component,
  sourcePath = '',
): Promise<void> {
  el.empty();
  el.addClasses([...markdownHostClasses]);
  el.toggleClass('is-readable-line-width', false);
  await MarkdownRenderer.render(app, markdown, el, sourcePath, component);
}
