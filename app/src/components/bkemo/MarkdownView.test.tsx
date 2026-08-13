import { renderBkemo } from '@/test/render';
import { screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/trpc', () => ({
  api: {
    public: { linkPreview: { query: vi.fn(async () => null) } },
    linkEnrichment: { getByUrl: { query: vi.fn(async () => null) } },
  },
}));

import { MarkdownView } from './MarkdownView';

const MEDIUM_URL =
  'https://medium.com/@chiragthummar16/5-claude-skills-every-android-developer-must-know-386c6c2e66d1';

describe('MarkdownView bookmarks', () => {
  test('replaces a bare URL paragraph with a bookmark card', () => {
    renderBkemo(<MarkdownView content={MEDIUM_URL} noteId={74} />, { router: false });

    expect(document.querySelector('.bk-bookmark-card')).toBeTruthy();
    expect(screen.queryByRole('link', { name: MEDIUM_URL })).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveTextContent('medium.com');
  });

  test('leaves titled markdown links as ordinary links', () => {
    renderBkemo(
      <MarkdownView content={`[Claude skills](${MEDIUM_URL})`} />,
      { router: false },
    );

    expect(document.querySelector('.bk-bookmark-card')).toBeNull();
    expect(screen.getByRole('link', { name: 'Claude skills' })).toHaveAttribute('href', MEDIUM_URL);
  });

  test('does not bookmark a URL that shares a paragraph with other text', () => {
    renderBkemo(
      <MarkdownView content={`See ${MEDIUM_URL} later`} />,
      { router: false },
    );

    expect(document.querySelector('.bk-bookmark-card')).toBeNull();
    expect(screen.getByRole('link', { name: MEDIUM_URL })).toBeInTheDocument();
  });
});
