const NEON_API_BASE = 'https://console.neon.tech/api/v2';
const CU_SECONDS_PER_HOUR = 3600;

type NeonMetric = {
  metric_name?: string;
  value?: number;
};

type NeonConsumption = {
  timeframe_start?: string;
  metrics?: NeonMetric[];
};

type NeonConsumptionResponse = {
  projects?: Array<{
    periods?: Array<{
      consumption?: NeonConsumption[];
    }>;
  }>;
};

export type NeonCuUsage = {
  configured: true;
  projectId: string;
  month: string;
  throughDate: string;
  elapsedDays: number;
  daysInMonth: number;
  usedCuHours: number;
  averageCuHoursPerDay: number;
  estimatedCuHours: number | null;
  daily: Array<{ date: string; cuHours: number }>;
  fetchedAt: string;
};

export type NeonCuUsageUnavailable = {
  configured: false;
  missing: string[];
};

type NeonCuUsageOptions = {
  apiKey?: string;
  orgId?: string;
  projectId?: string;
  now?: Date;
  fetcher?: typeof fetch;
};

function utcDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day));
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function roundCuHours(value: number) {
  return Math.round(value * 1000) / 1000;
}

export function summarizeNeonCuUsage(
  response: NeonConsumptionResponse,
  projectId: string,
  now = new Date(),
): NeonCuUsage {
  const year = now.getUTCFullYear();
  const monthIndex = now.getUTCMonth();
  const monthStart = utcDate(year, monthIndex, 1);
  const todayStart = utcDate(year, monthIndex, now.getUTCDate());
  const nextMonthStart = utcDate(year, monthIndex + 1, 1);
  const elapsedDays = Math.max(0, Math.round((todayStart.getTime() - monthStart.getTime()) / 86_400_000));
  const daysInMonth = Math.round((nextMonthStart.getTime() - monthStart.getTime()) / 86_400_000);
  const dailySeconds = new Map<string, number>();

  for (const project of response.projects ?? []) {
    for (const period of project.periods ?? []) {
      for (const item of period.consumption ?? []) {
        const date = item.timeframe_start?.slice(0, 10);
        if (!date || date < isoDate(monthStart) || date >= isoDate(todayStart)) continue;
        const seconds = item.metrics?.find((metric) => metric.metric_name === 'compute_unit_seconds')?.value;
        if (typeof seconds === 'number' && Number.isFinite(seconds)) {
          dailySeconds.set(date, (dailySeconds.get(date) ?? 0) + seconds);
        }
      }
    }
  }

  const daily = Array.from({ length: elapsedDays }, (_, index) => {
    const date = isoDate(utcDate(year, monthIndex, index + 1));
    return { date, cuHours: roundCuHours((dailySeconds.get(date) ?? 0) / CU_SECONDS_PER_HOUR) };
  });
  const usedCuHours = roundCuHours(
    Array.from(dailySeconds.values()).reduce((sum, seconds) => sum + seconds, 0) / CU_SECONDS_PER_HOUR,
  );
  const averageCuHoursPerDay = elapsedDays ? roundCuHours(usedCuHours / elapsedDays) : 0;

  return {
    configured: true,
    projectId,
    month: isoDate(monthStart).slice(0, 7),
    throughDate: isoDate(todayStart),
    elapsedDays,
    daysInMonth,
    usedCuHours,
    averageCuHoursPerDay,
    estimatedCuHours: elapsedDays ? roundCuHours((usedCuHours / elapsedDays) * daysInMonth) : null,
    daily,
    fetchedAt: now.toISOString(),
  };
}

export async function fetchNeonCuUsage(options: NeonCuUsageOptions = {}): Promise<NeonCuUsage | NeonCuUsageUnavailable> {
  const apiKey = options.apiKey ?? process.env.NEON_API_KEY;
  const orgId = options.orgId ?? process.env.NEON_ORG_ID;
  const projectId = options.projectId ?? process.env.NEON_PROJECT_ID;
  const missing = [
    !apiKey && 'NEON_API_KEY',
    !orgId && 'NEON_ORG_ID',
    !projectId && 'NEON_PROJECT_ID',
  ].filter(Boolean) as string[];
  if (missing.length) return { configured: false, missing };

  const now = options.now ?? new Date();
  const monthStart = utcDate(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const todayStart = utcDate(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (monthStart.getTime() === todayStart.getTime()) {
    return summarizeNeonCuUsage({ projects: [] }, projectId!, now);
  }

  const query = new URLSearchParams({
    org_id: orgId!,
    project_ids: projectId!,
    from: monthStart.toISOString(),
    to: todayStart.toISOString(),
    granularity: 'daily',
    metrics: 'compute_unit_seconds',
    limit: '1',
  });
  const response = await (options.fetcher ?? fetch)(`${NEON_API_BASE}/consumption_history/v2/projects?${query}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const detail = body ? `: ${body.slice(0, 240)}` : '';
    throw new Error(`Neon usage API returned ${response.status}${detail}`);
  }

  return summarizeNeonCuUsage(await response.json() as NeonConsumptionResponse, projectId!, now);
}
