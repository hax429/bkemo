import { renderBkemo } from '@/test/render';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { apiMock } = vi.hoisted(() => {
  const misuseIncidents = { query: vi.fn(async () => []) };
  const revoke = { mutate: vi.fn(async () => undefined) };
  const dismissMisuse = { mutate: vi.fn(async () => undefined) };
  return {
    apiMock: {
      accessTokens: {
        list: { query: vi.fn(async () => []) },
        misuseIncidents,
        create: { mutate: vi.fn(async () => ({ token: 'x', name: 't' })) },
        revoke,
        dismissMisuse,
      },
      oauth: {
        connections: { query: vi.fn(async () => []) },
      },
    },
  };
});

vi.mock('@/lib/trpc', () => ({
  api: apiMock,
}));

vi.mock('@/lib/event', () => ({
  eventBus: {
    on: vi.fn(),
    off: vi.fn(),
  },
}));

import { AccessTokenMisuseBanner } from './AccessTokenMisuseBanner';

describe('AccessTokenMisuseBanner', () => {
  beforeEach(() => {
    apiMock.accessTokens.misuseIncidents.query.mockReset();
    apiMock.accessTokens.revoke.mutate.mockReset();
    apiMock.accessTokens.dismissMisuse.mutate.mockReset();
    window.confirm = vi.fn(() => true);
  });

  test('renders nothing when there are no incidents', async () => {
    apiMock.accessTokens.misuseIncidents.query.mockResolvedValue([]);
    const { container } = renderBkemo(<AccessTokenMisuseBanner />, { router: false });
    await waitFor(() => {
      expect(apiMock.accessTokens.misuseIncidents.query).toHaveBeenCalled();
    });
    expect(container.querySelector('.bkemo')?.childElementCount ?? -1).toBe(0);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
  });

  test('shows misuse copy and dismisses an incident', async () => {
    const user = userEvent.setup();
    apiMock.accessTokens.misuseIncidents.query
      .mockResolvedValueOnce([
        {
          id: 'inc-1',
          accessTokenId: 9,
          tokenName: 'Obsidian',
          expectedPlatform: 'obsidian',
          observedPlatform: 'api',
          requestCount: 3,
        },
      ])
      .mockResolvedValueOnce([]);
    apiMock.accessTokens.dismissMisuse.mutate.mockResolvedValue(undefined);

    renderBkemo(<AccessTokenMisuseBanner />, { router: false });

    expect(
      await screen.findByText(/Access token “Obsidian” is bound to Obsidian but was used from API \/ scripts \(3 times\)/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => {
      expect(apiMock.accessTokens.dismissMisuse.mutate).toHaveBeenCalledWith({ id: 'inc-1' });
    });
  });
});
