import { describe, expect, test, vi } from 'vitest';
import { fetchNeonCuUsage, summarizeNeonCuUsage } from '../../../lib/neonCuUsage';

describe('Neon CU usage', () => {
  test('fills missing days and projects the completed-day trend across the UTC month', () => {
    const result = summarizeNeonCuUsage({
      projects: [{
        periods: [{
          consumption: [
            {
              timeframe_start: '2026-07-01T00:00:00Z',
              metrics: [{ metric_name: 'compute_unit_seconds', value: 900 }],
            },
            {
              timeframe_start: '2026-07-02T00:00:00Z',
              metrics: [{ metric_name: 'compute_unit_seconds', value: 1800 }],
            },
          ],
        }],
      }],
    }, 'project-id', new Date('2026-07-04T13:00:00Z'));

    expect(result.daily).toEqual([
      { date: '2026-07-01', cuHours: 0.25 },
      { date: '2026-07-02', cuHours: 0.5 },
      { date: '2026-07-03', cuHours: 0 },
    ]);
    expect(result.usedCuHours).toBe(0.75);
    expect(result.averageCuHoursPerDay).toBe(0.25);
    expect(result.estimatedCuHours).toBe(7.75);
    expect(result.daysInMonth).toBe(31);
  });

  test('reports missing server configuration without making a request', async () => {
    const fetcher = vi.fn();
    const result = await fetchNeonCuUsage({
      apiKey: '',
      orgId: '',
      projectId: '',
      fetcher,
    });

    expect(result).toEqual({
      configured: false,
      missing: ['NEON_API_KEY', 'NEON_ORG_ID', 'NEON_PROJECT_ID'],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('requests only completed days for the configured project', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ projects: [] }), { status: 200 }));
    await fetchNeonCuUsage({
      apiKey: 'secret',
      orgId: 'org-id',
      projectId: 'project-id',
      now: new Date('2026-07-27T05:30:00Z'),
      fetcher: fetcher as typeof fetch,
    });

    const [rawUrl, init] = fetcher.mock.calls[0]!;
    const url = new URL(String(rawUrl));
    expect(url.searchParams.get('from')).toBe('2026-07-01T00:00:00.000Z');
    expect(url.searchParams.get('to')).toBe('2026-07-27T00:00:00.000Z');
    expect(url.searchParams.get('project_ids')).toBe('project-id');
    expect(url.searchParams.get('metrics')).toBe('compute_unit_seconds');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret' });
  });
});
