import { observer } from "mobx-react-lite";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import dayjs from "@/lib/dayjs";
import { api, streamApi } from "@/lib/trpc";
import { aiDebugLog, describeAiError, isAiDebugEnabled } from "@/lib/aiDebug";
import { RootStore } from "@/store";
import { BlinkoStore } from "@/store/blinkoStore";
import { MarkdownView } from "./MarkdownView";

type DailyActivity = { date: string; count: number };
type CharacterBucket = {
  bucket: "under-100" | "100-299" | "300-499" | "500-999" | "1000-plus";
  label: string;
  count: number;
};
type AnalyticsScope = "month" | "year" | "all";
type AIDiscoverKind = "default" | "value";
type AIDiscoverRange = "3m" | "1y" | "all";
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
  onYearChange,
  maxYear,
}: {
  activity: DailyActivity[];
  mode: "rolling" | "year";
  year: number;
  onYearChange?: (year: number) => void;
  maxYear?: number;
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
            {mode === "year" ? "Activity" : "Activity over the past 12 months"}
            {mode === "year" && onYearChange ? (
              <span className="bk-analytics-year-nav" aria-label="Activity year">
                <button
                  type="button"
                  aria-label="Previous year"
                  disabled={year <= 1970}
                  onClick={() => onYearChange(year - 1)}
                >
                  ‹
                </button>
                <span>{year}</span>
                <button
                  type="button"
                  aria-label="Next year"
                  disabled={year >= (maxYear ?? dayjs().year())}
                  onClick={() => onYearChange(year + 1)}
                >
                  ›
                </button>
              </span>
            ) : mode === "year" ? (
              ` in ${year}`
            ) : null}
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

function AIAnalyticsPanel({ blinko }: { blinko: BlinkoStore }) {
  const [kind, setKind] = useState<AIDiscoverKind>("default");
  const [range, setRange] = useState<AIDiscoverRange>("3m");
  const [loading, setLoading] = useState(false);
  const [followUpSending, setFollowUpSending] = useState(false);
  const [followUp, setFollowUp] = useState("");
  const [result, setResult] = useState<{
    content: string;
    noteIds: number[];
    noteCount: number;
    conversationId?: number;
    cappedAt?: number;
  } | null>(null);
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const run = async (nextKind = kind) => {
    setKind(nextKind);
    setLoading(true);
    setError(null);
    setFollowUp("");
    try {
      const data = await api.ai.discover.mutate({ kind: nextKind, range } as any) as any;
      setResult(data);
      setMessages([
        { role: "user", content: `Run ${nextKind} discovery for my notes.` },
        { role: "assistant", content: data.content },
      ]);
    } catch (cause: any) {
      console.error("[analytics-ai] discovery failed:", cause);
      setError(cause?.message || "AI discovery failed.");
      setResult(null);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    const content = messages.filter((m) => m.role === "assistant").map((m) => m.content).join("\n\n---\n\n");
    if (!content) return;
    await blinko.upsertNote.call({
      content: `# AI ${kind === "value" ? "Value" : "Default"} Discovery\n\n${content}`,
      references: result?.noteIds ?? [],
      showToast: true,
      refresh: true,
    } as any);
  };

  const sendFollowUp = async () => {
    const question = followUp.trim();
    if (!question || !result?.conversationId || followUpSending) return;
    setFollowUpSending(true);
    setError(null);
    setFollowUp("");
    const debug = isAiDebugEnabled();
    const t0 = Date.now();
    aiDebugLog("client:send", { scope: "analytics", conversationId: result.conversationId, question });
    setMessages((prev) => [...prev, { role: "user", content: question }, { role: "assistant", content: "" }]);
    try {
      const stream = await streamApi.ai.chat.mutate({
        conversationId: result.conversationId,
        question,
        scope: "analytics",
        withOnline: false,
        withRAG: false,
        ...(debug ? { debug: true } : {}),
      } as any);
      let assistantContent = "";
      for await (const event of stream as any) {
        if (event?.debug) aiDebugLog(String(event.debug.phase || "server"), event.debug, "server");
        if (event.delta) {
          assistantContent += event.delta;
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = { role: "assistant", content: assistantContent };
            return next;
          });
        }
        if (event.assistantMessage?.content) {
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = { role: "assistant", content: event.assistantMessage.content };
            return next;
          });
        }
      }
      aiDebugLog("client:done", { scope: "analytics", ms: Date.now() - t0, chars: assistantContent.length });
    } catch (cause: any) {
      const info = describeAiError(cause);
      aiDebugLog(info.aborted ? "client:aborted" : "client:error", { ...info, ms: Date.now() - t0 }, "error", info.message);
      console.error("[analytics-ai] follow-up failed:", cause);
      setMessages((prev) => prev.slice(0, -2));
      setFollowUp(question);
      setError(cause?.message || "Follow-up failed.");
    } finally {
      setFollowUpSending(false);
    }
  };

  return (
    <section className="bk-analytics-panel bk-ai-analytics-panel">
      <div className="bk-analytics-panel-heading">
        <div>
          <h2>AI analytics</h2>
          <p>Discover patterns across your bkemos with a reusable prompt pipeline.</p>
        </div>
        <div className="h-stack bk-ai-analytics-actions">
          <select value={range} onChange={(event) => setRange(event.currentTarget.value as AIDiscoverRange)} disabled={loading || followUpSending}>
            <option value="3m">Recent 3 months</option>
            <option value="1y">Recent year</option>
            <option value="all">All notes</option>
          </select>
          <button type="button" onClick={() => run("value")} disabled={loading || followUpSending}>
            Value discover
          </button>
          <button type="button" onClick={() => run("default")} disabled={loading || followUpSending}>
            Default discover
          </button>
        </div>
      </div>
      {error ? <div className="bk-analytics-error" role="alert">{error}</div> : null}
      {loading ? <div className="bk-ai-discovery-placeholder">Reading notes and thinking…</div> : null}
      {result ? (
        <div className="bk-ai-discovery-result">
          <div className="h-stack bk-ai-discovery-meta">
            <span>{kind === "value" ? "Value discovery" : "Default discovery"}</span>
            <span>{result.noteCount} notes{result.cappedAt && result.noteCount >= result.cappedAt ? ` (capped at ${result.cappedAt})` : ""}</span>
            <span className="spacer" />
            <button type="button" onClick={save}>Save as bkemo</button>
          </div>
          <div className="v-stack bk-ai-discovery-thread">
            {messages.map((message, index) => (
              <article key={`${message.role}-${index}`} className={message.role === "assistant" ? "bk-ai-message is-assistant" : "bk-ai-message is-user"}>
                <div className="bk-ai-message-role">{message.role === "assistant" ? "AI" : "You"}</div>
                {message.role === "assistant" ? (
                  <MarkdownView content={message.content || (followUpSending ? "Thinking..." : "")} />
                ) : (
                  <div className="bk-ai-user-content">{message.content}</div>
                )}
              </article>
            ))}
          </div>
          <div className="h-stack bk-ai-composer">
            <textarea
              value={followUp}
              onChange={(event) => setFollowUp(event.currentTarget.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") sendFollowUp();
              }}
              placeholder="Ask a follow-up about this discovery…"
              rows={2}
              disabled={followUpSending || !result.conversationId}
            />
            <button type="button" onClick={sendFollowUp} disabled={!followUp.trim() || followUpSending || !result.conversationId}>
              {followUpSending ? "Sending" : "Send"}
            </button>
          </div>
        </div>
      ) : !loading ? (
        <div className="bk-ai-discovery-placeholder">Choose a range, then run value or default discovery.</div>
      ) : null}
    </section>
  );
}

export const Analytics = observer(function Analytics() {
  const blinko = RootStore.Get(BlinkoStore);
  const currentYear = dayjs().year();
  const [scope, setScope] = useState<AnalyticsScope>("all");
  const [selectedMonth, setSelectedMonth] = useState(dayjs().format("YYYY-MM"));
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [activityYear, setActivityYear] = useState(currentYear);
  const [activity, setActivity] = useState<DailyActivity[]>([]);
  const [summary, setSummary] = useState<AnalyticsSummary>(EMPTY_SUMMARY);
  const [distribution, setDistribution] = useState<AnalyticsSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Keep heatmap year aligned when switching month/year scopes.
    if (scope === "month") setActivityYear(dayjs(selectedMonth).year());
    if (scope === "year") setActivityYear(selectedYear);
  }, [scope, selectedMonth, selectedYear]);

  useEffect(() => {
    let cancelled = false;
    api.analytics.dailyNoteCount
      .mutate({
        utcOffsetMinutes: -new Date().getTimezoneOffset(),
        mode: "year",
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
  }, [activityYear, blinko.updateTicker]);

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

  useEffect(() => {
    // Tag / character distributions always default to all-time, independent of the toolbar.
    let cancelled = false;
    api.analytics.monthlyStats
      .mutate({
        month: `${currentYear}-01`,
        utcOffsetMinutes: -new Date().getTimezoneOffset(),
        period: "all",
      })
      .then((data) => {
        if (!cancelled) setDistribution(data);
      })
      .catch((cause) => {
        console.error("[analytics] distribution load failed:", cause);
      });
    return () => {
      cancelled = true;
    };
  }, [currentYear, blinko.updateTicker]);

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
  const updateMonth = (value: string) =>
    setSelectedMonth(value || dayjs().format("YYYY-MM"));
  const updateYear = (value: string) => {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 1970 && parsed <= currentYear) {
      setSelectedYear(parsed);
    }
  };
  const bumpActivityYear = (nextYear: number) => {
    const clamped = Math.min(currentYear, Math.max(1970, nextYear));
    setActivityYear(clamped);
    if (scope === "year") setSelectedYear(clamped);
    if (scope === "month") {
      setSelectedMonth(dayjs(selectedMonth).year(clamped).format("YYYY-MM"));
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
          mode="year"
          year={activityYear}
          maxYear={currentYear}
          onYearChange={bumpActivityYear}
        />

        <div className="bk-analytics-distributions">
          <TagDistribution
            tags={distribution.tagStats ?? []}
            periodDescription="across all time"
          />
          <CharacterDistribution
            buckets={distribution.characterStats}
            total={distribution.noteCount}
            average={distribution.averageCharacters}
            periodDescription="across all time"
          />
        </div>

        <AIAnalyticsPanel blinko={blinko} />

        <div className="bk-analytics-timezone">
          Dates use your local timezone.
        </div>
      </div>
    </div>
  );
});
