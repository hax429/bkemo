import { renderBkemo } from '@/test/render';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { MobileTabBar } from './MobileTabBar';

describe('MobileTabBar', () => {
  test('routes primary actions through their public callbacks', async () => {
    const user = userEvent.setup();
    const onNav = vi.fn();
    const onNew = vi.fn();

    renderBkemo(<MobileTabBar activeRoute="home" onNav={onNav} onNew={onNew} />, { router: false });

    await user.click(screen.getByRole('button', { name: 'Today' }));
    await user.click(screen.getByRole('button', { name: 'New' }));

    expect(onNav).toHaveBeenCalledWith('today');
    expect(onNew).toHaveBeenCalledOnce();
  });

  test('opens the tools dialog and closes it after a selection', async () => {
    const user = userEvent.setup();
    const onNav = vi.fn();

    renderBkemo(<MobileTabBar activeRoute="home" onNav={onNav} onNew={vi.fn()} />, { router: false });

    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('dialog', { name: 'More tools' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Files' }));

    expect(onNav).toHaveBeenCalledWith('files');
    expect(screen.queryByRole('dialog', { name: 'More tools' })).not.toBeInTheDocument();
  });
});
