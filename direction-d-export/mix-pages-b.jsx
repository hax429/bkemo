/* @jsx React.createElement */
// Direction D — Todos page + Daily Review v2 (with task strips)
// window.MixPagesB = { Todos, DailyReviewV2 }

const MPB = {};

const TBmonoMeta = {
  fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".10em",
  color: "var(--fg-3)", textTransform: "uppercase",
};
const TBmonoCap = {
  fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-3)",
};
const TBcardBase = {
  background: "var(--bg-2)", border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
};
const TBbtnGhost = {
  background: "transparent", border: "1px solid var(--border-2)",
  color: "var(--fg-2)", padding: "4px 10px", borderRadius: "var(--radius)",
  fontSize: 12, cursor: "pointer", fontFamily: "inherit",
};
const TBbtnPrimary = {
  background: "var(--accent)", border: "none", color: "#fff",
  padding: "5px 12px", borderRadius: "var(--radius)",
  fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
};

// ─── Reused topbar from mix-pages.jsx (re-declared local to be safe) ───
function TBTopbar({ title, breadcrumb, right }) {
  return (
    <div className="h-stack" style={{
      height: 44, padding: "0 18px", borderBottom: "1px solid var(--border)",
      gap: 10, background: "var(--bg)", flexShrink: 0,
    }}>
      <span style={{ color: "var(--fg)", fontSize: 13, fontWeight: 500 }}>{title}</span>
      {breadcrumb && (
        <>
          <span style={{ color: "var(--fg-3)" }}>/</span>
          <span style={{ color: "var(--fg-2)", fontSize: 13 }}>{breadcrumb}</span>
        </>
      )}
      <span className="spacer" />
      {right}
    </div>
  );
}

// ─── Checkbox ───
function TodoCheck({ done, important, urgent, size = 14, onClick }) {
  // Border color signals importance/urgency. Filled = done.
  const border = done
    ? "var(--accent)"
    : (urgent && important) ? "var(--accent)"
    : "var(--fg-3)";
  return (
    <span
      onClick={onClick}
      style={{
        width: size, height: size, borderRadius: 3,
        border: `1.5px solid ${border}`,
        background: done ? "var(--accent)" : "transparent",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0, color: "#fff", fontSize: size - 4, lineHeight: 1,
        cursor: "pointer",
      }}
    >{done ? "✓" : ""}</span>
  );
}

// ─── Priority dots (important / urgent indicators) ───
function PriorityDots({ important, urgent }) {
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      <span title="Important" style={{
        width: 6, height: 6, borderRadius: 50,
        background: important ? "var(--accent)" : "transparent",
        border: important ? "none" : "1px solid var(--fg-3)",
        boxSizing: "border-box",
      }} />
      <span title="Urgent" style={{
        width: 6, height: 6, borderRadius: 50,
        background: urgent ? "#E8A35C" : "transparent",
        border: urgent ? "none" : "1px solid var(--fg-3)",
        boxSizing: "border-box",
      }} />
    </span>
  );
}

// ─── Task row ───
function TaskRow({ m, density = "regular" }) {
  const pad = density === "compact" ? "8px 14px" : "11px 14px";
  const tagStyle = { color: "var(--accent)", fontFamily: "var(--font-mono)" };
  return (
    <div
      style={{
        padding: pad,
        borderBottom: "1px solid var(--border)",
        display: "grid",
        gridTemplateColumns: "auto auto auto 1fr auto auto",
        gap: 12, alignItems: "start",
        background: "var(--bg)",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-2)"}
      onMouseLeave={(e) => e.currentTarget.style.background = "var(--bg)"}
    >
      <span style={{ paddingTop: 2 }}>
        <TodoCheck done={m.done} important={m.important} urgent={m.urgent} />
      </span>
      <span style={{ paddingTop: 4 }}>
        <PriorityDots important={m.important} urgent={m.urgent} />
      </span>
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-3)",
        paddingTop: 3, width: 52,
      }}>{m.id}</span>
      <div style={{
        fontSize: 13.5, lineHeight: 1.55,
        color: m.done ? "var(--fg-3)" : "var(--fg)",
        textDecoration: m.done ? "line-through" : "none",
      }}>
        {window.BKEMO_RENDER(m.body, tagStyle)}
      </div>
      <span style={{
        ...TBmonoCap, fontSize: 11, color: m.due === "today" ? "var(--accent)" : "var(--fg-3)",
        paddingTop: 3, width: 80, textAlign: "right",
      }}>
        {m.due && m.due !== "no date" ? m.due : ""}
      </span>
      <span style={{
        ...TBmonoCap, fontSize: 11, paddingTop: 3, width: 40, textAlign: "right",
      }}>{m.ts}</span>
    </div>
  );
}

// ─── Filter tab strip ───
function FilterTabs({ active, onSelect }) {
  const tabs = [
    { id: "inbox",    label: "Inbox",     count: 4 },
    { id: "today",    label: "Today",     count: 3 },
    { id: "tomorrow", label: "Tomorrow",  count: 1 },
    { id: "week",     label: "This week", count: 5 },
    { id: "matrix",   label: "Matrix",    count: null },
  ];
  return (
    <div className="h-stack" style={{
      height: 40, padding: "0 14px",
      borderBottom: "1px solid var(--border)",
      background: "var(--bg)", flexShrink: 0, gap: 0,
    }}>
      {tabs.map(t => (
        <div
          key={t.id}
          onClick={() => onSelect && onSelect(t.id)}
          style={{
            padding: "0 14px",
            height: "100%",
            display: "flex", alignItems: "center", gap: 6,
            color: active === t.id ? "var(--fg)" : "var(--fg-2)",
            borderBottom: active === t.id ? "2px solid var(--accent)" : "2px solid transparent",
            marginBottom: -1,
            cursor: "pointer", fontSize: 13, fontWeight: 500,
            transition: "color 0.1s",
          }}
        >
          <span>{t.label}</span>
          {t.count != null && (
            <span style={{
              ...TBmonoCap, fontSize: 10,
              color: active === t.id ? "var(--accent)" : "var(--fg-3)",
              padding: "1px 6px", borderRadius: 100,
              background: active === t.id ? "var(--accent-soft)" : "transparent",
            }}>{t.count}</span>
          )}
        </div>
      ))}
      <span className="spacer" />
      <span style={{ ...TBmonoCap, fontSize: 11 }}>sort · due date  ▾</span>
    </div>
  );
}

// ─── Eisenhower Matrix view ───
function QuadrantHeader({ icon, label, sub, tone, count }) {
  const c = tone || "var(--fg-3)";
  return (
    <div style={{
      padding: "12px 16px", borderBottom: "1px solid var(--border)",
      background: "var(--bg-2)",
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <span style={{
        width: 24, height: 24, borderRadius: 5,
        background: `color-mix(in srgb, ${c} 18%, var(--bg-3))`,
        color: c,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 14, fontWeight: 600,
      }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)", letterSpacing: "-0.01em" }}>{label}</div>
        <div style={{ ...TBmonoMeta, fontSize: 9, marginTop: 2 }}>{sub}</div>
      </div>
      <span style={{
        ...TBmonoCap, fontSize: 11, color: c, fontWeight: 600,
      }}>{count}</span>
    </div>
  );
}

function MatrixTaskCard({ m }) {
  const tagStyle = { color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: 11 };
  return (
    <div
      style={{
        padding: "10px 12px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg)",
        cursor: "grab",
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-2)"}
      onMouseLeave={(e) => e.currentTarget.style.background = "var(--bg)"}
    >
      <div className="h-stack" style={{
        ...TBmonoMeta, fontSize: 9, marginBottom: 4,
      }}>
        <span>{m.id}</span>
        <span style={{ margin: "0 6px" }}>·</span>
        <span style={{
          color: m.due === "today" ? "var(--accent)" :
                 m.due === "tomorrow" ? "#E8A35C" : "var(--fg-3)",
        }}>{m.due ? m.due.toUpperCase() : "NO DATE"}</span>
        <span className="spacer" />
        <span style={{ cursor: "grab", color: "var(--fg-3)" }}>⋮⋮</span>
      </div>
      <div className="h-stack gap-2" style={{ alignItems: "flex-start" }}>
        <span style={{ paddingTop: 2 }}>
          <TodoCheck done={m.done} important={m.important} urgent={m.urgent} size={13} />
        </span>
        <div style={{
          fontSize: 13, lineHeight: 1.5, color: "var(--fg)", flex: 1,
        }}>{window.BKEMO_RENDER(m.body, tagStyle)}</div>
      </div>
    </div>
  );
}

function Quadrant({ icon, label, sub, tone, tasks, emptyHint }) {
  return (
    <div style={{
      ...TBcardBase, padding: 0, overflow: "hidden",
      display: "flex", flexDirection: "column",
      minHeight: 0,
    }}>
      <QuadrantHeader icon={icon} label={label} sub={sub} tone={tone} count={tasks.length} />
      <div className="scroll" style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        {tasks.length === 0 ? (
          <div style={{
            ...TBmonoCap, padding: 24, textAlign: "center",
            color: "var(--fg-3)",
          }}>{emptyHint}</div>
        ) : tasks.map(t => <MatrixTaskCard key={t.id} m={t} />)}
      </div>
    </div>
  );
}

function MatrixView() {
  const q = window.BKEMO_QUADRANTS();
  return (
    <div style={{ flex: 1, overflow: "hidden", padding: 18, background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      {/* axis labels */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "180px 1fr 1fr",
        gridTemplateRows: "auto 1fr 1fr",
        gap: 14, flex: 1, minHeight: 0,
      }}>
        {/* corner */}
        <div />
        <div style={{ ...TBmonoMeta, fontSize: 11, letterSpacing: ".14em", textAlign: "center" }}>URGENT</div>
        <div style={{ ...TBmonoMeta, fontSize: 11, letterSpacing: ".14em", textAlign: "center" }}>NOT URGENT</div>
        {/* row 1 label */}
        <div style={{
          ...TBmonoMeta, fontSize: 11, letterSpacing: ".14em",
          writingMode: "vertical-rl", transform: "rotate(180deg)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>IMPORTANT</div>
        <Quadrant
          icon="▣" label="Do now" sub="Crises · deadlines"
          tone="var(--accent)"
          tasks={q.do}
          emptyHint="Nothing on fire."
        />
        <Quadrant
          icon="◫" label="Schedule" sub="Strategy · prevention"
          tone="#5BD0C8"
          tasks={q.schedule}
          emptyHint="Plan something."
        />
        {/* row 2 label */}
        <div style={{
          ...TBmonoMeta, fontSize: 11, letterSpacing: ".14em",
          writingMode: "vertical-rl", transform: "rotate(180deg)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>NOT IMPORTANT</div>
        <Quadrant
          icon="◰" label="Delegate" sub="Interruptions · errands"
          tone="#E8A35C"
          tasks={q.delegate}
          emptyHint="No errands waiting."
        />
        <Quadrant
          icon="◱" label="Eliminate" sub="Time-wasters · trivia"
          tone="#9B6B6B"
          tasks={q.eliminate}
          emptyHint="Inbox zero on this one."
        />
      </div>
    </div>
  );
}

// ─── Composer for tasks (with importance/urgency toggles) ───
function TaskComposer({ filter }) {
  const ctxHint = filter === "today" ? "Will be due today."
                : filter === "tomorrow" ? "Will be due tomorrow."
                : filter === "week" ? "Will be due this week."
                : "Goes to your inbox.";
  return (
    <div style={{
      ...TBcardBase, padding: "12px 14px", marginBottom: 14,
    }}>
      <div style={{ fontSize: 14, color: "var(--fg-3)", lineHeight: 1.5 }}>
        New memo · <span style={{ color: "var(--accent)" }}>#tag</span> to project, <span style={{ fontFamily: "var(--font-mono)" }}>!</span> important, <span style={{ fontFamily: "var(--font-mono)" }}>^</span> urgent, <span style={{ fontFamily: "var(--font-mono)" }}>⌘↵</span> send.
      </div>
      <div className="h-stack gap-3" style={{ marginTop: 10 }}>
        <span style={{ ...TBmonoCap, fontSize: 11 }}>＃  📷  🔗</span>
        <span style={{
          ...TBmonoCap, fontSize: 11,
          color: "var(--accent)", display: "flex", alignItems: "center", gap: 4,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: 50, background: "var(--accent)",
          }} /> IMPORTANT
        </span>
        <span style={{
          ...TBmonoCap, fontSize: 11,
          color: "#E8A35C", display: "flex", alignItems: "center", gap: 4,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: 50, background: "#E8A35C",
          }} /> URGENT
        </span>
        <span className="spacer" />
        <span style={{ ...TBmonoCap, fontSize: 11 }}>{ctxHint}</span>
        <button style={TBbtnPrimary}>Send</button>
      </div>
    </div>
  );
}

// ─── TODOS PAGE (top-level) ───
MPB.Todos = function TodosPage({ filter = "inbox", onFilter, density }) {
  const tasks = window.BKEMO_DATA.memos.filter(m => m.task && !m.done);
  const done  = window.BKEMO_DATA.memos.filter(m => m.task && m.done);

  // filter
  const filtered = filter === "inbox" ? tasks.filter(t => !t.due || t.due === "no date" || t.due === "this week" || t.due === "next week")
                : filter === "today"    ? tasks.filter(t => t.due === "today")
                : filter === "tomorrow" ? tasks.filter(t => t.due === "tomorrow")
                : filter === "week"     ? tasks.filter(t => t.due === "today" || t.due === "tomorrow" || t.due === "this week")
                : tasks; // matrix shows all

  const summary = {
    inbox: { label: "Inbox", sub: tasks.length + " open · " + done.length + " done" },
    today: { label: "Today", sub: filtered.length + " due today" },
    tomorrow: { label: "Tomorrow", sub: filtered.length + " due tomorrow" },
    week: { label: "This week", sub: filtered.length + " due in 7 days" },
    matrix: { label: "Matrix", sub: "Important × Urgent" },
  }[filter] || { label: "Todos", sub: tasks.length };

  return (
    <div className="v-stack" style={{ flex: 1, height: "100%", overflow: "hidden" }}>
      <TBTopbar
        title="Todos"
        breadcrumb={summary.label}
        right={
          <>
            <button style={TBbtnGhost}>＋ task · ⌘↵</button>
            <button style={TBbtnGhost}>Show done</button>
            <button style={TBbtnGhost}>···</button>
          </>
        }
      />
      <FilterTabs active={filter} onSelect={onFilter} />

      {filter === "matrix" ? (
        <MatrixView />
      ) : (
        <div className="scroll" style={{ flex: 1, overflow: "auto" }}>
          <div style={{ padding: "20px 18px 0", maxWidth: 980, margin: "0 auto" }}>
            {/* hero */}
            <div style={TBmonoMeta}>{summary.sub.toUpperCase()}</div>
            <h1 style={{
              fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em",
              margin: "4px 0 16px", color: "var(--fg)", lineHeight: 1.05,
            }}>{summary.label}</h1>
            <TaskComposer filter={filter} />
            {filtered.length === 0 ? (
              <div style={{
                ...TBmonoCap, padding: 30, textAlign: "center",
                color: "var(--fg-3)",
                border: "1px dashed var(--border-2)",
                borderRadius: "var(--radius-lg)",
              }}>Nothing in this lane.</div>
            ) : (
              <div style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)", overflow: "hidden",
              }}>
                {filtered.map(m => <TaskRow key={m.id} m={m} density={density} />)}
              </div>
            )}

            {/* done section (collapsed) */}
            {done.length > 0 && (
              <div style={{ marginTop: 24, marginBottom: 32 }}>
                <div className="h-stack" style={{ ...TBmonoMeta, marginBottom: 10 }}>
                  <span style={{ flex: 1 }}>Done · last 7 days</span>
                  <span style={{ color: "var(--fg-3)" }}>▾ show {done.length}</span>
                </div>
                <div style={{
                  border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
                  overflow: "hidden", opacity: 0.7,
                }}>
                  {done.map(m => <TaskRow key={m.id} m={m} density={density} />)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── DAILY REVIEW v2 — tasks today/tomorrow on top, throwbacks below ───
MPB.DailyReviewV2 = function DailyReviewV2() {
  const allTasks = window.BKEMO_DATA.memos.filter(m => m.task && !m.done);
  const todayTasks = allTasks.filter(t => t.due === "today");
  const tomorrowTasks = allTasks.filter(t => t.due === "tomorrow");

  const items = [
    { yearsAgo: 1, when: "May 28, 2025", body: "Started writing the blinko fork. The plan: rip out everything that isn't for me. Aim for a one-screen app I open 30 times a day.", tags: ["#log"], id: "BK-068" },
    { yearsAgo: 2, when: "May 28, 2024", body: "iPad split view broke after the iOS 17 update — the visualViewport API stopped firing on rotation. Filed FB14392021.", tags: ["#ios", "#bug"], id: "BK-014" },
  ];

  const tagStyle = { color: "var(--accent)", fontFamily: "var(--font-mono)" };
  return (
    <div className="v-stack" style={{ flex: 1, height: "100%", overflow: "hidden" }}>
      <TBTopbar
        title="Daily review"
        breadcrumb="May 28 · 2026"
        right={
          <>
            <button style={TBbtnGhost}>↻ shuffle</button>
            <button style={TBbtnPrimary}>Done · ⌘↵</button>
          </>
        }
      />
      <div className="scroll" style={{ flex: 1, overflow: "auto", padding: "24px 28px 40px", background: "var(--bg)" }}>
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          {/* Hero */}
          <div style={TBmonoMeta}>{todayTasks.length} TASKS TODAY · {tomorrowTasks.length} TOMORROW · 2 PAST MEMOS · STREAK 84D</div>
          <h1 style={{
            fontSize: 36, fontWeight: 600, letterSpacing: "-0.02em",
            margin: "6px 0 6px", color: "var(--fg)", lineHeight: 1.05,
          }}>Plan today, write about yesterday.</h1>
          <div style={{ color: "var(--fg-2)", fontSize: 14, marginTop: 6, maxWidth: 620 }}>
            Triage tasks first — they're due. Then look at what you wrote on May 28 in previous years.
          </div>

          <div style={{ height: 28 }} />

          {/* Today + Tomorrow side-by-side */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14,
          }}>
            <TaskStrip
              label="Today"
              accent="var(--accent)"
              tasks={todayTasks}
              tagStyle={tagStyle}
              emptyHint="Nothing due today."
            />
            <TaskStrip
              label="Tomorrow"
              accent="#E8A35C"
              tasks={tomorrowTasks}
              tagStyle={tagStyle}
              emptyHint="Tomorrow is clear."
            />
          </div>

          <div style={{ height: 36 }} />

          {/* On this day */}
          <div style={TBmonoMeta}>ON THIS DAY · MAY 28 · {items.length} ENTRIES</div>
          <h2 style={{
            fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em",
            margin: "4px 0 14px", color: "var(--fg)",
          }}>What you wrote on May 28, in previous years.</h2>

          {items.map((it, i) => (
            <div key={it.id} style={{
              ...TBcardBase, padding: "20px 22px", marginBottom: 12,
              borderLeft: i === 0 ? "2px solid var(--accent)" : "1px solid var(--border)",
            }}>
              <div className="h-stack" style={{ ...TBmonoMeta, marginBottom: 8 }}>
                <span style={{ flex: 1 }}>{it.id} · {it.when.toUpperCase()} · {it.yearsAgo}{it.yearsAgo === 1 ? " YEAR" : " YEARS"} AGO</span>
                <span>{it.tags[0]}</span>
              </div>
              <div style={{
                fontSize: i === 0 ? 16 : 14, lineHeight: 1.6, color: "var(--fg)",
              }}>{it.body}</div>
              {i === 0 && (
                <div className="h-stack gap-2" style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                  <button style={TBbtnGhost}>✎ Reflect</button>
                  <button style={TBbtnGhost}>↳ Reply to past me</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

function TaskStrip({ label, accent, tasks, tagStyle, emptyHint }) {
  return (
    <div style={{
      ...TBcardBase, padding: 0, overflow: "hidden",
      borderTop: `2px solid ${accent}`,
    }}>
      <div className="h-stack" style={{
        padding: "10px 14px 8px",
        ...TBmonoMeta, fontSize: 11, letterSpacing: ".10em",
      }}>
        <span style={{ flex: 1, color: accent }}>{label.toUpperCase()}</span>
        <span>{tasks.length} TASK{tasks.length === 1 ? "" : "S"}</span>
      </div>
      {tasks.length === 0 ? (
        <div style={{
          padding: 20, textAlign: "center",
          ...TBmonoCap, fontSize: 11,
        }}>{emptyHint}</div>
      ) : tasks.map(m => (
        <div key={m.id} style={{
          padding: "10px 14px", borderTop: "1px solid var(--border)",
          display: "grid", gridTemplateColumns: "auto auto 1fr", gap: 10,
          alignItems: "start", background: "var(--bg)",
        }}>
          <span style={{ paddingTop: 2 }}>
            <TodoCheck done={m.done} important={m.important} urgent={m.urgent} size={13} />
          </span>
          <span style={{ paddingTop: 4 }}>
            <PriorityDots important={m.important} urgent={m.urgent} />
          </span>
          <div>
            <div style={{ ...TBmonoMeta, fontSize: 9, marginBottom: 2 }}>{m.id}</div>
            <div style={{
              fontSize: 13, lineHeight: 1.5, color: "var(--fg)",
            }}>{window.BKEMO_RENDER(m.body, tagStyle)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

window.MixPagesB = MPB;
