import { renderBkemo } from '@/test/render';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { clampSidebarWidth, sidebarTools, DEFAULT_PREFS } from '@/lib/bkemoSettings';

vi.mock('@/components/Auth/auth-client', () => ({ signOut: vi.fn(), navigate: vi.fn() }));
vi.mock('@/lib/trpc', () => ({
  api: { analytics: { dailyNoteCount: { mutate: vi.fn(async () => [{ date: '2026-09-23', count: 4 }]) } } },
}));
vi.mock('@/store', () => {
  const stores: Record<string, unknown> = {
    BlinkoStore: {
      tagList: { value: { listTags: [{ name: 'idea', metadata: { path: 'idea' }, children: [] }] }, call: vi.fn() },
      offlineNotes: [], offlinePendingOps: { list: [] }, updateTicker: 0,
    },
    BaseStore: { isOnline: true },
    UserStore: { nickname: 'Hector', tokenData: { value: null } },
  };
  return { RootStore: { Get: (cls: { name: string }) => stores[cls.name] } };
});

import { Sidebar } from './Sidebar';

const baseProps = { activeRoute: 'home', onNav: vi.fn(), onWidthChange: vi.fn(), width: 248 };

describe('Sidebar', () => {
  test('toolbar shows only the chosen shortcuts, each with a readable name', async () => {
    const user = userEvent.setup();
    const onNav = vi.fn();
    renderBkemo(<Sidebar {...baseProps} onNav={onNav} tools={['calendar', 'matrix', 'trash']} />, { router: false });

    const toolbar = screen.getByRole('toolbar', { name: 'Sidebar shortcuts' });
    const names = [...toolbar.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Calendar', 'Matrix', 'Trash']);

    await user.click(screen.getByRole('button', { name: 'Matrix' }));
    expect(onNav).toHaveBeenCalledWith('matrix');
  });

  test('keeps search, new memo and tags', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    const onNewMemo = vi.fn();
    renderBkemo(<Sidebar {...baseProps} tools={[]} onSearch={onSearch} onNewMemo={onNewMemo} />, { router: false });

    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(screen.getByRole('button', { name: 'New memo' }));
    expect(onSearch).toHaveBeenCalledOnce();
    expect(onNewMemo).toHaveBeenCalledOnce();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(screen.getByText('idea')).toBeVisible();
  });

  test('resizes from the keyboard and resets on double-click', () => {
    const onWidthChange = vi.fn();
    renderBkemo(<Sidebar {...baseProps} tools={['home']} onWidthChange={onWidthChange} />, { router: false });
    const handle = screen.getByRole('separator', { name: 'Resize sidebar' });

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onWidthChange).toHaveBeenLastCalledWith(264);
    fireEvent.doubleClick(handle);
    expect(onWidthChange).toHaveBeenLastCalledWith(248);
  });

  test('shows the month heatmap only when enabled', async () => {
    const { unmount } = renderBkemo(<Sidebar {...baseProps} tools={['home']} />, { router: false });
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    unmount();

    renderBkemo(<Sidebar {...baseProps} tools={['home']} showHeatmap />, { router: false });
    expect(await screen.findByRole('grid', { name: /^Memos in / })).toBeVisible();
  });
});

describe('sidebar prefs', () => {
  test('tool list is known, unique and capped at five; default when unset', () => {
    expect(sidebarTools(DEFAULT_PREFS)).toEqual(['home', 'today', 'week', 'calendar', 'trash']);
    expect(sidebarTools({ ...DEFAULT_PREFS, sidebarTools: [] })).toEqual([]);
    expect(sidebarTools({ ...DEFAULT_PREFS, sidebarTools: ['graph', 'graph', 'ai' as never, 'home', 'today', 'week', 'matrix', 'files'] }))
      .toEqual(['graph', 'home', 'today', 'week', 'matrix']);
  });
  test('width is clamped', () => {
    expect(clampSidebarWidth(undefined)).toBe(248);
    expect(clampSidebarWidth(50)).toBe(200);
    expect(clampSidebarWidth(9999)).toBe(420);
  });
});
