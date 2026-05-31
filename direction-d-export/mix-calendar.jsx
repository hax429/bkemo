/* @jsx React.createElement */
// Direction D — full Calendar page (Fantastical-style month grid)
// window.MixCalendar = function CalendarPage

const calMono = {
  fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".08em",
  color: "var(--fg-3)", textTransform: "uppercase",
};

const calBtnGhost = {
  background: "transparent", border: "1px solid var(--border-2)",
  color: "var(--fg-2)", padding: "4px 10px", borderRadius: "var(--radius)",
  fontSize: 12, cursor: "pointer", fontFamily: "inherit",
};
const calBtnPrimary = {
  background: "var(--accent)", border: "none", color: "#fff",
  padding: "4px 12px", borderRadius: "var(--radius)",
  fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
};

function buildCalendarMatrix(year, month, todayDay) {
  // Returns 6×7 cells, each { day, month, isCurrent, isToday }
  const first = new Date(year, month, 1);
  // Sunday-first calendar (matches user's Fantastical screenshot)
  const offset = first.getDay(); // 0=Sun..6=Sat
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();

  const cells = [];
  // leading days from prev month
  for (let i = offset - 1; i >= 0; i--) {
    cells.push({
      day: daysInPrev - i,
      month: month - 1,
      isCurrent: false,
      isToday: false,
    });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      day: d, month: month, isCurrent: true,
      isToday: d === todayDay,
    });
  }
  while (cells.length < 42) {
    const d = cells.length - offset - daysInMonth + 1;
    cells.push({
      day: d, month: month + 1, isCurrent: false, isToday: false,
    });
  }
  return cells; // 42 cells
}

function CalEvent({ e, compact }) {
  const c = window.BKEMO_TAG_COLOR("#" + e.tag);
  const bg = `color-mix(in srgb, ${c} 22%, var(--bg-2))`;
  const fg = `color-mix(in srgb, ${c} 35%, var(--fg))`;
  const dim = e.done;
  return (
    <div
      title={`${e.title} · #${e.tag} · ${e.hour}`}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: compact ? "1px 5px" : "2px 6px",
        background: bg,
        borderLeft: `2px solid ${c}`,
        borderRadius: 3,
        fontSize: 11, lineHeight: 1.2,
        color: dim ? "var(--fg-3)" : "var(--fg)",
        textDecoration: dim ? "line-through" : "none",
        whiteSpace: "nowrap", overflow: "hidden",
        cursor: "pointer",
      }}
    >
      {/* memo dot or task check */}
      {e.kind === "task" ? (
        <span style={{
          width: 9, height: 9, borderRadius: 2,
          border: `1.5px solid ${c}`,
          background: dim ? c : "transparent",
          flexShrink: 0,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          color: "#fff", fontSize: 7, lineHeight: 1,
        }}>{dim ? "✓" : ""}</span>
      ) : (
        <span style={{
          width: 6, height: 6, borderRadius: 50,
          background: c, flexShrink: 0,
        }} />
      )}
      <span style={{
        flex: 1, minWidth: 0,
        overflow: "hidden", textOverflow: "ellipsis",
      }}>{e.title}</span>
      {e.hour && e.hour !== "—" && (
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 9,
          color: "var(--fg-3)", flexShrink: 0,
        }}>{e.hour}</span>
      )}
    </div>
  );
}

function CalDayCell({ cell, events, totalH }) {
  const subdued = !cell.isCurrent;
  const MAX = 5;
  const visible = events.slice(0, MAX);
  const overflow = Math.max(0, events.length - MAX);
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        background: cell.isToday ? "color-mix(in srgb, var(--accent) 4%, var(--bg))" : "var(--bg)",
        padding: 4, minHeight: totalH,
        display: "flex", flexDirection: "column", gap: 2,
        opacity: subdued ? 0.45 : 1,
        position: "relative",
        cursor: "pointer",
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) => {
        if (cell.isCurrent) e.currentTarget.style.background = "color-mix(in srgb, var(--accent) 3%, var(--bg-2))";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = cell.isToday
          ? "color-mix(in srgb, var(--accent) 4%, var(--bg))"
          : "var(--bg)";
      }}
    >
      {/* day number */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "flex-start",
        marginBottom: 2,
      }}>
        {cell.isToday ? (
          <span style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 22, height: 22, borderRadius: 50,
            background: "var(--accent)", color: "#fff",
            fontSize: 12, fontWeight: 600,
          }}>{cell.day}</span>
        ) : (
          <span style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 22, height: 22,
            fontSize: 12, color: subdued ? "var(--fg-3)" : "var(--fg-2)",
            fontWeight: 500,
          }}>{cell.day === 1 ? `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][cell.month]} 1` : cell.day}</span>
        )}
      </div>
      {/* events */}
      {visible.map((e, i) => <CalEvent key={i} e={e} />)}
      {overflow > 0 && (
        <div style={{
          padding: "1px 6px", fontSize: 10,
          color: "var(--fg-2)", fontFamily: "var(--font-mono)",
          cursor: "pointer",
        }}>+{overflow} more</div>
      )}
    </div>
  );
}

window.MixCalendar = function CalendarPage() {
  const { calendar } = window.BKEMO_DATA;
  const events = window.BKEMO_CALENDAR_EVENTS;
  const cells = buildCalendarMatrix(calendar.year, calendar.month, calendar.today);

  // index events by day+month
  const byKey = {};
  events.forEach(e => {
    const m = e.month != null ? e.month : calendar.month;
    const key = `${m}-${e.day}`;
    (byKey[key] = byKey[key] || []).push(e);
  });
  // sort each bucket by hour
  Object.values(byKey).forEach(arr => arr.sort((a, b) => (a.hour || "").localeCompare(b.hour || "")));

  // pull legend tags actually used
  const usedTags = [...new Set(events.map(e => e.tag))];

  return (
    <div className="v-stack" style={{ flex: 1, height: "100%", overflow: "hidden", background: "var(--bg)" }}>
      {/* topbar */}
      <div className="h-stack" style={{
        height: 44, padding: "0 18px", borderBottom: "1px solid var(--border)",
        gap: 12, background: "var(--bg)", flexShrink: 0,
      }}>
        <span style={{ color: "var(--fg)", fontSize: 13, fontWeight: 600 }}>Calendar</span>
        <span style={{ color: "var(--fg-3)" }}>/</span>
        <span style={{ color: "var(--fg-2)", fontSize: 13, fontFamily: "var(--font-body)" }}>{calendar.monthLabel}</span>
        <span className="spacer" />

        {/* view switcher */}
        <div className="h-stack" style={{
          background: "var(--bg-2)", border: "1px solid var(--border-2)",
          borderRadius: "var(--radius)", padding: 2, gap: 2,
        }}>
          {["Day", "Week", "Month"].map(v => (
            <span key={v} style={{
              padding: "4px 10px", borderRadius: 4,
              background: v === "Month" ? "var(--bg-3)" : "transparent",
              color: v === "Month" ? "var(--fg)" : "var(--fg-2)",
              fontSize: 12, cursor: "pointer",
            }}>{v}</span>
          ))}
        </div>

        {/* month nav */}
        <div className="h-stack gap-1">
          <span style={{ ...calBtnGhost, padding: "4px 8px" }}>‹</span>
          <button style={calBtnPrimary}>Today</button>
          <span style={{ ...calBtnGhost, padding: "4px 8px" }}>›</span>
        </div>

        <button style={{ ...calBtnGhost, padding: "4px 10px" }}>＋ New memo</button>
      </div>

      {/* day-of-week header */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-2)",
        flexShrink: 0,
      }}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
          <div key={d} style={{
            padding: "8px 10px",
            ...calMono, fontSize: 10,
            borderLeft: i > 0 ? "1px solid var(--border)" : "none",
          }}>{d}</div>
        ))}
      </div>

      {/* month grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
        gridTemplateRows: "repeat(6, 1fr)",
        flex: 1, minHeight: 0,
        background: "var(--bg)",
      }}>
        {cells.map((cell, i) => {
          const events = byKey[`${cell.month}-${cell.day}`] || [];
          return <CalDayCell key={i} cell={cell} events={events} totalH={110} />;
        })}
      </div>

      {/* footer / legend */}
      <div className="h-stack" style={{
        padding: "10px 18px", borderTop: "1px solid var(--border)",
        background: "var(--bg-2)", flexShrink: 0, gap: 14,
        flexWrap: "wrap",
      }}>
        <span style={{ ...calMono, fontSize: 10, color: "var(--fg-3)" }}>PROJECTS</span>
        {usedTags.map(t => {
          const c = window.BKEMO_TAG_COLOR("#" + t);
          return (
            <span key={t} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              fontSize: 12, color: "var(--fg-2)",
            }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: c, flexShrink: 0 }} />
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--fg-2)" }}>#{t}</span>
            </span>
          );
        })}
        <span className="spacer" />
        <span style={{ ...calMono, fontSize: 10, color: "var(--fg-3)" }}>
          {events.length} ENTRIES · {events.filter(e => e.kind === "task").length} TASKS · {events.filter(e => e.kind === "memo").length} MEMOS
        </span>
      </div>
    </div>
  );
};
