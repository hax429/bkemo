import { observer } from "mobx-react-lite";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import dayjs from "@/lib/dayjs";
import { api } from "@/lib/trpc";
import { RootStore } from "@/store";
import { BlinkoStore } from "@/store/blinkoStore";

type DailyActivity = { date: string; count: number };
type CharacterBucket = {
  bucket: "under-100" | "100-299" | "300-499" | "500-999" | "1000-plus";
  label: string;
  count: number;
};
type AnalyticsScope = "month" | "year" | "all";
type AnalyticsSummary = {
  noteCount: number;
  totalWords: number;
  maxDailyWords: number;
  activeDays: number;
  tagStats?: { tagName: string; count: number }[];
  characterStats: CharacterBucket[];
  averageCharacters: number;
  maxDailyDate: string | null;
};

const EMPTY_SUMMARY: AnalyticsSummary = {
  noteCount: 0,
  totalWords: 0,
  maxDailyWords: 0,
  activeDays: 0,
  tagStats: [],
  characterStats: [
    { bucket: "under-100", label: "< 100", count: 0 },
    { bucket: "100-299", label: "100–299", count: 0 },
    { bucket: "300-499", label: "300–499", count: 0 },
    { bucket: "500-999", label: "500–999", count: 0 },
    { bucket: "1000-plus", label: "1,000+", count: 0 },
  ],
  averageCharacters: 0,
  maxDailyDate: null,
};

const ROLLING_HEATMAP_WEEKS = 53;
const BUCKET_OPACITY = [0.34, 0.52, 0.68, 0.82, 1];

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function pointOnCircle(cx: number, cy: number, radius: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

function radialBarPath(
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
) {
  const outerStart = pointOnCircle(120, 120, outerRadius, startAngle);
  const outerEnd = pointOnCircle(120, 120, outerRadius, endAngle);
  const innerEnd = pointOnCircle(120, 120, innerRadius, endAngle);
  const innerStart = pointOnCircle(120, 120, innerRadius, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="bk-analytics-metric">
      <div className="bk-analytics-label">{label}</div>
      <div className="bk-analytics-metric-value">{value}</div>
      <div className="bk-analytics-detail">{detail}</div>
    </div>
  );
}

function ActivityHeatmap({
  activity,
  mode,
  year,
}: {
  activity: DailyActivity[];
  mode: "rolling" | "year";
  year: number;
}) {
  const { cells, monthLabels, max, weekCount } = useMemo(() => {
    const counts = new Map(activity.map((item) => [item.date, item.count]));
    const start =
      mode === "year"
        ? dayjs(`${year}-01-01`).startOf("week")
        : dayjs()
            .startOf("week")
            .subtract(ROLLING_HEATMAP_WEEKS - 1, "week");
    const weekCount =
      mode === "year"
        ? dayjs(`${year}-12-31`).endOf("week").diff(start, "week") + 1
        : ROLLING_HEATMAP_WEEKS;
    const cells = Array.from({ length: weekCount * 7 }, (_, index) => {
      const date = start.add(index, "day");
      const isOutsideYear = mode === "year" && date.year() !== year;
      return {
        date,
        count: isOutsideYear ? 0 : (counts.get(date.format("YYYY-MM-DD")) ?? 0),
        isOutsideRange: isOutsideYear,
      };
    });
    const labels = Array.from({ length: weekCount }, (_, week) => {
      const current = start.add(week, "week");
      const previous = week === 0 ? null : start.add(week - 1, "week");
      return (mode !== "year" || current.year() === year) &&
        (previous == null || current.month() !== previous.month())
        ? current.format("MMM")
        : "";
    });
    return {
      cells,
      monthLabels: labels,
      max: Math.max(1, ...cells.map((cell) => cell.count)),
      weekCount,
    };
  }, [activity, mode, year]);

  const intensity = (value: number) => {
    if (value === 0) return "var(--bg-3)";
    const level = Math.max(1, Math.ceil((value / max) * 4));
    return `color-mix(in srgb, var(--accent) ${[22, 42, 66, 92][level - 1]}%, var(--bg-3))`;
  };

  return (
    <section className="bk-analytics-panel bk-analytics-heat-panel">
      <div className="bk-analytics-panel-heading">
        <div>
          <h2>
            {mode === "year"
              ? `Activity in ${year}`
              : "Activity over the past 12 months"}
          </h2>
          <p>Daily memo creation</p>
        </div>
        <div
          className="bk-analytics-legend"
          aria-label="Activity intensity legend"
        >
          <span>Less</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <i
              key={level}
              style={{
                background: intensity(level === 0 ? 0 : (max * level) / 4),
              }}
            />
          ))}
          <span>More</span>
        </div>
      </div>

      <div className="bk-analytics-heat-scroll">
        <div className="bk-analytics-heat-content">
          <div
            className="bk-analytics-months"
            aria-hidden="true"
            style={{ "--analytics-weeks": weekCount } as CSSProperties}
          >
            {monthLabels.map((label, index) => (
              <span key={index}>{label}</span>
            ))}
          </div>
          <div className="bk-analytics-heat-body">
            <div className="bk-analytics-days" aria-hidden="true">
              <span>Mon</span>
              <span>Wed</span>
              <span>Fri</span>
            </div>
            <div
              className="bk-analytics-heat-grid"
              style={{ "--analytics-weeks": weekCount } as CSSProperties}
            >
              {cells.map(({ date, count, isOutsideRange }) => (
                <div
                  key={date.format("YYYY-MM-DD")}
                  className={`bk-analytics-heat-cell${isOutsideRange ? " is-outside-range" : ""}`}
                  style={{ background: isOutsideRange ? "transparent" : intensity(count) }}
                  title={`${date.format("MMM D, YYYY")} · ${count} ${count === 1 ? "memo" : "memos"}`}
                  aria-label={`${date.format("MMMM D, YYYY")}: ${count} ${count === 1 ? "memo" : "memos"}`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function TagDistribution({
  tags,
  periodDescription,
}: {
  tags: NonNullable<AnalyticsSummary["tagStats"]>;
  periodDescription: string;
}) {
  const max = Math.max(1, ...tags.map((tag) => tag.count));
  const total = tags.reduce((sum, tag) => sum + tag.count, 0);

  return (
    <section className="bk-analytics-panel">
      <div className="bk-analytics-panel-heading">
        <div>
          <h2>Tag distribution</h2>
          <p>Most used tags {periodDescription}</p>
        </div>
      </div>
      <div className="bk-analytics-tag-list">
        {tags.length === 0 ? (
          <div className="bk-analytics-empty">
            No tagged memos {periodDescription}.
          </div>
        ) : (
          tags.map((tag) => (
            <div className="bk-analytics-tag-row" key={tag.tagName}>
              <span className="bk-analytics-tag-name">#{tag.tagName}</span>
              <div className="bk-analytics-tag-track">
                <i style={{ width: `${(tag.count / max) * 100}%` }} />
              </div>
              <span className="bk-analytics-tag-count">{tag.count}</span>
              <span className="bk-analytics-tag-percent">
                {Math.round((tag.count / total) * 100)}%
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function CharacterDistribution({
  buckets,
  total,
  average,
  periodDescription,
}: {
  buckets: CharacterBucket[];
  total: number;
  average: number;
  periodDescription: string;
}) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));

  return (
    <section className="bk-analytics-panel">
      <div className="bk-analytics-panel-heading">
        <div>
          <h2>Character distribution</h2>
          <p>Memo length {periodDescription}</p>
        </div>
      </div>
      <div className="bk-analytics-character-layout">
        <svg
          className="bk-analytics-polar"
          viewBox="0 0 240 240"
          role="img"
          aria-label="Radial chart of memo character lengths"
        >
          {[52, 72, 92, 112].map((radius) => (
            <circle
              key={radius}
              cx="120"
              cy="120"
              r={radius}
              fill="none"
              stroke="var(--border)"
              strokeWidth="1"
            />
          ))}
          {buckets.map((bucket, index) => {
            const startAngle = index * 72 + 5;
            const endAngle = (index + 1) * 72 - 5;
            const outerRadius = 48 + (bucket.count / max) * 64;
            return (
              <path
                key={bucket.bucket}
                d={radialBarPath(34, outerRadius, startAngle, endAngle)}
                fill="var(--accent)"
                fillOpacity={BUCKET_OPACITY[index]}
              >
                <title>
                  {bucket.label} characters · {bucket.count} memos
                </title>
              </path>
            );
          })}
          <circle
            cx="120"
            cy="120"
            r="28"
            fill="var(--bg-2)"
            stroke="var(--border-2)"
          />
          <text
            x="120"
            y="117"
            textAnchor="middle"
            fill="var(--fg)"
            fontSize="18"
            fontWeight="600"
          >
            {total}
          </text>
          <text
            x="120"
            y="133"
            textAnchor="middle"
            fill="var(--fg-3)"
            fontSize="8"
            fontFamily="var(--font-mono)"
          >
            MEMOS
          </text>
        </svg>
        <div className="bk-analytics-bucket-list">
          {buckets.map((bucket, index) => (
            <div className="bk-analytics-bucket-row" key={bucket.bucket}>
              <i style={{ opacity: BUCKET_OPACITY[index] }} />
              <span>{bucket.label} chars</span>
              <strong>{bucket.count}</strong>
              <em>
                {total > 0 ? Math.round((bucket.count / total) * 100) : 0}%
              </em>
            </div>
          ))}
          <div className="bk-analytics-average">
            Average <strong>{formatNumber(average)}</strong> characters
          </div>
        </div>
      </div>
    </section>
  );
}

export const Analytics = observer(function Analytics() {
  const blinko = RootStore.Get(BlinkoStore);
  const currentYear = dayjs().year();
  const [scope, setScope] = useState<AnalyticsScope>("month");
  const [selectedMonth, setSelectedMonth] = useState(dayjs().format("YYYY-MM"));
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [activity, setActivity] = useState<DailyActivity[]>([]);
  const [summary, setSummary] = useState<AnalyticsSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const activityYear =
      scope === "month" ? dayjs(selectedMonth).year() : selectedYear;
    api.analytics.dailyNoteCount
      .mutate({
        utcOffsetMinutes: -new Date().getTimezoneOffset(),
        mode: scope === "all" ? "rolling" : "year",
        year: activityYear,
      })
      .then((data) => {
        if (!cancelled) setActivity(data);
      })
      .catch((cause) => {
        console.error("[analytics] activity load failed:", cause);
        if (!cancelled) setError("Activity could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [scope, selectedMonth, selectedYear, blinko.updateTicker]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.analytics.monthlyStats
      .mutate({
        month:
          scope === "month"
            ? selectedMonth
            : `${scope === "year" ? selectedYear : currentYear}-01`,
        utcOffsetMinutes: -new Date().getTimezoneOffset(),
        period: scope,
      })
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((cause) => {
        console.error("[analytics] monthly load failed:", cause);
        if (!cancelled)
          setError("Analytics could not be loaded. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, selectedMonth, selectedYear, currentYear, blinko.updateTicker]);

  const periodYear =
    scope === "month" ? dayjs(selectedMonth).year() : selectedYear;
  const monthDays = dayjs(selectedMonth).daysInMonth();
  const yearDays = dayjs(`${periodYear}-12-31`).diff(
    dayjs(`${periodYear}-01-01`),
    "day",
  ) + 1;
  const availableDays = scope === "month" ? monthDays : yearDays;
  const activePercent =
    availableDays > 0
      ? Math.round((summary.activeDays / availableDays) * 100)
      : 0;
  const longestDay = summary.maxDailyDate
    ? dayjs(summary.maxDailyDate).format(
        scope === "all" ? "MMM D, YYYY" : "MMM D",
      )
    : "No activity";
  const periodLabel =
    scope === "month"
      ? dayjs(selectedMonth).format("MMMM YYYY")
      : scope === "year"
        ? String(selectedYear)
        : "All active memos";
  const periodDescription =
    scope === "month"
      ? "this month"
      : scope === "year"
        ? `in ${selectedYear}`
        : "across all time";
  const activityYear =
    scope === "month" ? dayjs(selectedMonth).year() : selectedYear;
  const updateMonth = (value: string) =>
    setSelectedMonth(value || dayjs().format("YYYY-MM"));
  const updateYear = (value: string) => {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 1970 && parsed <= currentYear) {
      setSelectedYear(parsed);
    }
  };

  return (
    <div
      className="v-stack bk-analytics"
      style={{ flex: 1, height: "100%", overflow: "hidden" }}
    >
      <header className="bk-analytics-header">
        <span className="bk-analytics-header-icon" aria-hidden="true">
          ▥
        </span>
        <span>Analytics</span>
      </header>

      <div className="bk-scroll bk-analytics-scroll">
        <div className="bk-analytics-toolbar">
          <div className="bk-analytics-scope" aria-label="Analytics period">
            {(["month", "year", "all"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={scope === option}
                onClick={() => setScope(option)}
              >
                {option === "all" ? "All time" : option}
              </button>
            ))}
          </div>
          {scope === "month" ? (
            <>
              <label htmlFor="analytics-month">Month</label>
              <input
                id="analytics-month"
                type="month"
                value={selectedMonth}
                max={dayjs().format("YYYY-MM")}
                onInput={(event) => updateMonth(event.currentTarget.value)}
                onChange={(event) => updateMonth(event.currentTarget.value)}
              />
            </>
          ) : null}
          {scope === "year" ? (
            <>
              <label htmlFor="analytics-year">Year</label>
              <input
                id="analytics-year"
                className="bk-analytics-year-input"
                type="number"
                value={selectedYear}
                min="1970"
                max={currentYear}
                inputMode="numeric"
                onChange={(event) => updateYear(event.currentTarget.value)}
              />
            </>
          ) : null}
          {loading ? (
            <span className="bk-analytics-loading">Updating…</span>
          ) : null}
        </div>

        {error ? (
          <div className="bk-analytics-error" role="alert">
            {error}
          </div>
        ) : null}

        <div className="bk-analytics-metrics">
          <Metric
            label="Memos"
            value={formatNumber(summary.noteCount)}
            detail={periodLabel}
          />
          <Metric
            label="Characters"
            value={formatNumber(summary.totalWords)}
            detail={`${formatNumber(summary.averageCharacters)} average`}
          />
          <Metric
            label="Longest day"
            value={formatNumber(summary.maxDailyWords)}
            detail={longestDay}
          />
          <Metric
            label="Active days"
            value={formatNumber(summary.activeDays)}
            detail={
              scope === "all"
                ? "Across your history"
                : `${activePercent}% of the ${scope}`
            }
          />
        </div>

        <ActivityHeatmap
          activity={activity}
          mode={scope === "all" ? "rolling" : "year"}
          year={activityYear}
        />

        <div className="bk-analytics-distributions">
          <TagDistribution
            tags={summary.tagStats ?? []}
            periodDescription={periodDescription}
          />
          <CharacterDistribution
            buckets={summary.characterStats}
            total={summary.noteCount}
            average={summary.averageCharacters}
            periodDescription={periodDescription}
          />
        </div>

        <div className="bk-analytics-timezone">
          Dates use your local timezone.
        </div>
      </div>
    </div>
  );
});
