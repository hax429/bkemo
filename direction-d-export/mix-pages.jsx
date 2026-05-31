/* @jsx React.createElement */
// Direction D — page screens for Mix.
// Exposes window.MixPages = { Stats, DailyReview, Random, Trash, Settings }

const MP = {};

// ─────────── Shared bits ───────────
const monoMeta = {
  fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".06em",
  color: "var(--fg-3)", textTransform: "uppercase",
};
const monoCap = {
  fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-3)",
};
const cardBase = {
  background: "var(--bg-2)", border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
};
const btnGhost = {
  background: "transparent", border: "1px solid var(--border-2)",
  color: "var(--fg-2)", padding: "4px 10px", borderRadius: "var(--radius)",
  fontSize: 12, cursor: "pointer", fontFamily: "inherit",
};
const btnPrimary = {
  background: "var(--accent)", border: "none", color: "#fff",
  padding: "5px 12px", borderRadius: "var(--radius)",
  fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
};
const btnDanger = {
  background: "transparent", border: "1px solid #5C2A2A",
  color: "#E0696B", padding: "4px 10px", borderRadius: "var(--radius)",
  fontSize: 12, cursor: "pointer", fontFamily: "inherit",
};

function MPTopbar({ title, breadcrumb, right }) {
  return (
    <div className="h-stack" style={{
      height: 44, padding: "0 18px", borderBottom: "1px solid var(--border)",
      gap: 10, background: "var(--bg)", flexShrink: 0,
    }}>
      <div className="h-stack gap-2" style={{ color: "var(--fg)", fontSize: 13, fontWeight: 500 }}>
        <span>{title}</span>
      </div>
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

// ─────────── STATS ───────────
function StatHeatmap({ cell = 14 }) {
  const data = window.BKEMO_DATA.heatmap;
  const cols = 12, rows = 7;
  const intensityColor = (v) => {
    if (v === 0) return "var(--bg-3)";
    const a = [0.22, 0.45, 0.68, 0.92][v - 1];
    return `color-mix(in srgb, var(--accent) ${a*100}%, var(--bg-3))`;
  };
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${cols}, ${cell}px)`,
      gridTemplateRows: `repeat(${rows}, ${cell}px)`,
      gap: 3, gridAutoFlow: "column",
    }}>
      {data.map((v, i) => (
        <div key={i} style={{
          width: cell, height: cell, borderRadius: 2, background: intensityColor(v),
        }} />
      ))}
    </div>
  );
}

function StatSparkline({ pts, h = 48, fill = true }) {
  const max = Math.max(...pts);
  const w = 400;
  const stepX = w / (pts.length - 1);
  const d = pts.map((p, i) => {
    const x = i * stepX;
    const y = h - (p / max) * (h - 2) - 1;
    return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
      {fill && <path d={d + ` L ${w} ${h} L 0 ${h} Z`} fill="var(--accent-soft)" />}
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function StatBars({ data, height = 80, mono = true }) {
  // data: [{label, value}]
  const max = Math.max(...data.map(d => d.value));
  const w = 600, barW = w / data.length;
  return (
    <svg viewBox={`0 0 ${w} ${height + 22}`} width="100%" height={height + 22} preserveAspectRatio="none">
      {data.map((d, i) => {
        const h = (d.value / max) * height;
        return (
          <g key={i}>
            <rect
              x={i * barW + 2} y={height - h}
              width={barW - 4} height={h}
              fill={i === data.length - 1 ? "var(--accent)" : "var(--accent-soft)"}
              rx="1"
            />
            <text
              x={i * barW + barW / 2} y={height + 14}
              textAnchor="middle"
              fontSize="9"
              fill="var(--fg-3)"
              fontFamily={mono ? "var(--font-mono)" : "var(--font-body)"}
              letterSpacing=".06em"
            >{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

MP.Stats = function StatsPage() {
  return (
    <div className="v-stack" style={{ flex: 1, height: "100%", overflow: "hidden" }}>
      <MPTopbar
        title="Stats"
        breadcrumb="Last 12 weeks"
        right={
          <>
            <button style={btnGhost}>30d</button>
            <button style={{ ...btnGhost, background: "var(--bg-2)", color: "var(--fg)" }}>12w</button>
            <button style={btnGhost}>1y</button>
            <button style={btnGhost}>All</button>
          </>
        }
      />
      <div className="scroll" style={{ flex: 1, overflow: "auto", padding: "24px 28px 40px" }}>
        {/* HERO */}
        <div className="h-stack gap-6" style={{ alignItems: "stretch" }}>
          {/* Big number */}
          <div style={{ flex: 1 }}>
            <div style={monoMeta}>TOTAL MEMOS · ALL TIME</div>
            <div className="h-stack" style={{ alignItems: "baseline", gap: 10, marginTop: 4 }}>
              <span style={{ fontSize: 64, fontWeight: 600, letterSpacing: "-0.03em", color: "var(--fg)", lineHeight: 1 }}>847</span>
              <span style={{ ...monoCap, color: "var(--accent)" }}>+18 this week</span>
            </div>
            <div style={{ marginTop: 18 }}>
              <StatSparkline pts={[5,7,4,8,12,9,6,11,8,15,12,18,14,21,18,23,17,24,21]} />
            </div>
          </div>
          {/* small stats */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, width: 380 }}>
            {[
              { label: "Current streak", value: "84d", sub: "since Mar 5, 2026" },
              { label: "Longest streak", value: "127d", sub: "ended Jan 18, 2025" },
              { label: "Avg length",     value: "187", sub: "characters / memo" },
              { label: "Tags used",      value: "32",  sub: "11 active this week" },
            ].map(s => (
              <div key={s.label} style={{ ...cardBase, padding: "12px 14px" }}>
                <div style={{ ...monoMeta, textTransform: "none", letterSpacing: ".04em" }}>{s.label}</div>
                <div style={{ fontSize: 24, fontWeight: 600, color: "var(--fg)", letterSpacing: "-0.02em", marginTop: 4 }}>{s.value}</div>
                <div style={{ ...monoCap, fontSize: 10, marginTop: 2 }}>{s.sub}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ height: 28 }} />

        {/* HEATMAP */}
        <div style={{ ...cardBase, padding: "18px 20px" }}>
          <div className="h-stack" style={monoMeta}>
            <span style={{ flex: 1 }}>Activity · 12 weeks</span>
            <span style={{ color: "var(--fg-2)" }}>84 memos · 11 inactive days</span>
          </div>
          <div style={{ marginTop: 14 }}>
            <StatHeatmap cell={16} />
          </div>
          <div className="h-stack" style={{ marginTop: 12, ...monoCap, fontSize: 10 }}>
            <span>Less</span>
            <div className="h-stack" style={{ gap: 3, margin: "0 8px" }}>
              {[0,1,2,3,4].map(v => {
                const a = v === 0 ? 0 : [0.22,0.45,0.68,0.92][v-1];
                return <div key={v} style={{ width: 10, height: 10, borderRadius: 2,
                  background: v === 0 ? "var(--bg-3)" : `color-mix(in srgb, var(--accent) ${a*100}%, var(--bg-3))` }} />;
              })}
            </div>
            <span>More</span>
          </div>
        </div>

        <div style={{ height: 18 }} />

        {/* Two-up grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          {/* hour of day */}
          <div style={{ ...cardBase, padding: "18px 20px" }}>
            <div style={monoMeta}>By hour of day · last 30d</div>
            <div style={{ marginTop: 12 }}>
              <StatBars data={[
                { label: "0", value: 3 }, { label: "", value: 2 }, { label: "", value: 1 }, { label: "3", value: 0 },
                { label: "", value: 0 }, { label: "", value: 1 }, { label: "6", value: 2 }, { label: "", value: 4 },
                { label: "", value: 7 }, { label: "9", value: 11 }, { label: "", value: 9 }, { label: "", value: 6 },
                { label: "12", value: 14 }, { label: "", value: 8 }, { label: "", value: 5 }, { label: "15", value: 9 },
                { label: "", value: 7 }, { label: "", value: 11 }, { label: "18", value: 15 }, { label: "", value: 18 },
                { label: "", value: 22 }, { label: "21", value: 19 }, { label: "", value: 12 }, { label: "23", value: 7 },
              ]} height={90} />
            </div>
            <div style={{ ...monoCap, fontSize: 10, marginTop: 6 }}>Peak: 20:00 — 22:00 · 36% of all memos</div>
          </div>
          {/* by day of week */}
          <div style={{ ...cardBase, padding: "18px 20px" }}>
            <div style={monoMeta}>By day of week · last 30d</div>
            <div style={{ marginTop: 12 }}>
              <StatBars data={[
                { label: "MON", value: 22 }, { label: "TUE", value: 18 }, { label: "WED", value: 25 },
                { label: "THU", value: 19 }, { label: "FRI", value: 16 }, { label: "SAT", value: 9 }, { label: "SUN", value: 11 },
              ]} height={90} />
            </div>
            <div style={{ ...monoCap, fontSize: 10, marginTop: 6 }}>Heaviest day: Wednesday · lightest: Saturday</div>
          </div>
        </div>

        <div style={{ height: 18 }} />

        {/* Top tags */}
        <div style={{ ...cardBase, padding: "18px 20px" }}>
          <div style={monoMeta}>Top tags · last 30d</div>
          <div className="v-stack" style={{ gap: 8, marginTop: 12 }}>
            {[
              { tag: "#ios",    count: 41, w: 100 },
              { tag: "#daily",  count: 28, w: 68 },
              { tag: "#server", count: 23, w: 56 },
              { tag: "#tauri",  count: 14, w: 34 },
              { tag: "#ai",     count: 18, w: 44 },
              { tag: "#idea",   count: 12, w: 29 },
              { tag: "#bug",    count: 8,  w: 20 },
              { tag: "#read",   count: 6,  w: 15 },
            ].map(t => (
              <div key={t.tag} className="h-stack gap-3" style={{ fontSize: 12 }}>
                <span style={{ width: 80, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>{t.tag}</span>
                <div style={{ flex: 1, height: 8, background: "var(--bg-3)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: `${t.w}%`, height: "100%", background: "var(--accent)", borderRadius: 2 }} />
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-3)", width: 30, textAlign: "right" }}>{t.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─────────── DAILY REVIEW ───────────
MP.DailyReview = function DailyReview() {
  const { throwback } = window.BKEMO_DATA;
  const items = [
    { yearsAgo: 1, when: "May 28, 2025", body: "Started writing the blinko fork. The plan: rip out everything that isn't for me. Aim for a one-screen app I open 30 times a day.", tags: ["#log"], id: "BK-068" },
    { yearsAgo: 2, when: "May 28, 2024", body: "iPad split view broke after the iOS 17 update — the visualViewport API stopped firing on rotation. Filed FB14392021.", tags: ["#ios", "#bug"], id: "BK-014" },
    { yearsAgo: 3, when: "May 28, 2023", body: "Coffee at the place on Bedford. The barista recommended a book about how Notion got its first 100 users. Got distracted, didn't read it.", tags: ["#daily"], id: "BK-002" },
  ];
  return (
    <div className="v-stack" style={{ flex: 1, height: "100%", overflow: "hidden" }}>
      <MPTopbar
        title="Daily review"
        breadcrumb="On this day · May 28"
        right={
          <>
            <button style={btnGhost}>↻ shuffle</button>
            <button style={btnGhost}>⤓ skip today</button>
            <button style={btnPrimary}>Done · ⌘↵</button>
          </>
        }
      />
      <div className="scroll" style={{ flex: 1, overflow: "auto", padding: "24px 28px 40px", background: "var(--bg)" }}>
        <div style={{ maxWidth: 740, margin: "0 auto" }}>
          {/* hero */}
          <div style={monoMeta}>3 PAST MEMOS · 0 REVIEWED · ~4 MIN</div>
          <h1 style={{
            fontSize: 38, fontWeight: 600, letterSpacing: "-0.02em",
            margin: "6px 0 4px", color: "var(--fg)", lineHeight: 1.05,
          }}>What you wrote on May 28, in previous years.</h1>
          <div style={{ color: "var(--fg-2)", fontSize: 14, marginTop: 8 }}>
            Pulled from your archive — one card per year. Reflect, edit, or move on. Streak: <span style={{ color: "var(--accent)" }}>84 days</span>.
          </div>

          <div style={{ height: 28 }} />

          {/* year tabs */}
          <div className="h-stack gap-2" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
            {[1,2,3].map(y => (
              <div key={y} style={{
                padding: "6px 12px",
                background: y === 1 ? "var(--accent-soft)" : "transparent",
                border: y === 1 ? "1px solid var(--accent)" : "1px solid var(--border-2)",
                borderRadius: "var(--radius)",
                fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: ".04em",
                color: y === 1 ? "var(--accent)" : "var(--fg-2)",
              }}>{y} {y === 1 ? "year" : "years"} ago</div>
            ))}
            <span className="spacer" />
            <span style={{ ...monoCap }}>swipe ← / → to navigate</span>
          </div>

          <div style={{ height: 18 }} />

          {/* current item — big card */}
          {items.map((it, i) => (
            <div key={it.id} style={{
              ...cardBase, padding: "22px 24px", marginBottom: 16,
              borderLeft: i === 0 ? "2px solid var(--accent)" : "1px solid var(--border)",
              opacity: i === 0 ? 1 : 0.6,
            }}>
              <div className="h-stack" style={{ ...monoMeta, marginBottom: 8 }}>
                <span style={{ flex: 1 }}>{it.id} · {it.when.toUpperCase()} · {it.yearsAgo} {it.yearsAgo === 1 ? "year" : "years"} ago</span>
                <span>{["☉ daily", "✦ note"][i % 2]}</span>
              </div>
              <div style={{
                fontSize: i === 0 ? 18 : 15, lineHeight: 1.6, color: "var(--fg)",
                fontFamily: "var(--font-body)",
              }}>{it.body}</div>
              <div className="h-stack gap-2" style={{ marginTop: 10, ...monoCap, color: "var(--accent)" }}>
                {it.tags.map(t => <span key={t}>{t}</span>)}
              </div>
              {i === 0 && (
                <div className="h-stack gap-2" style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
                  <button style={btnGhost}>✎ Reflect</button>
                  <button style={btnGhost}>↳ Reply to past me</button>
                  <button style={btnGhost}>⊕ Pin</button>
                  <span className="spacer" />
                  <button style={btnDanger}>Archive</button>
                </div>
              )}
            </div>
          ))}

          <div style={{ height: 10 }} />

          {/* reflection composer */}
          <div style={{ ...cardBase, padding: "16px 20px", border: "1px dashed var(--border-2)", background: "var(--bg)" }}>
            <div style={monoMeta}>NEW MEMO · REPLY TO PAST ME</div>
            <div style={{
              marginTop: 8, fontSize: 15, color: "var(--fg-3)", minHeight: 60, lineHeight: 1.5,
            }}>One year in. The fork is real. Cold-launch offline works tomorrow.</div>
            <div className="h-stack gap-3" style={{ marginTop: 8 }}>
              <span style={monoCap}>＃ 📷 🔗</span>
              <span className="spacer" />
              <span style={{ ...monoCap }}>74 / 280</span>
              <button style={btnPrimary}>Send ⌘↵</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─────────── RANDOM ───────────
MP.Random = function RandomPage() {
  const m = {
    id: "BK-052",
    when: "Sep 14, 2024 · 23:11",
    body: "Refactored the BlinkoCard masonry to use react-virtuoso for the long views. From 14fps scroll on a 4-year-old phone to a steady 58fps. Should have done this last year. #ios #server",
    tags: ["#ios", "#server"],
  };
  return (
    <div className="v-stack" style={{ flex: 1, height: "100%", overflow: "hidden" }}>
      <MPTopbar
        title="Random"
        breadcrumb="1 of 384"
        right={
          <>
            <button style={btnGhost}>Filter · any tag</button>
            <button style={btnGhost}>Range · all time</button>
            <button style={btnPrimary}>↻ Re-roll · R</button>
          </>
        }
      />
      <div className="scroll" style={{ flex: 1, overflow: "auto", padding: "28px 28px 40px" }}>
        <div style={{ maxWidth: 700, margin: "0 auto" }}>
          <div style={monoMeta}>FOR WHEN YOU'RE STUCK · PRESS R FOR ANOTHER</div>
          <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em", margin: "6px 0 24px" }}>
            A random memo from your archive.
          </h1>

          {/* filter chips */}
          <div className="h-stack gap-2" style={{ flexWrap: "wrap" }}>
            {[
              { l: "any tag", on: true },
              { l: "only #ios", on: false },
              { l: "only #idea", on: false },
              { l: "any year", on: true },
              { l: "2025 only", on: false },
              { l: "excl. #daily", on: false },
              { l: "include tasks", on: false },
            ].map(c => (
              <span key={c.l} style={{
                padding: "4px 10px", borderRadius: 100,
                border: c.on ? "1px solid var(--accent)" : "1px solid var(--border-2)",
                background: c.on ? "var(--accent-soft)" : "transparent",
                color: c.on ? "var(--accent)" : "var(--fg-2)",
                fontSize: 12, fontFamily: "var(--font-mono)",
              }}>{c.l}</span>
            ))}
          </div>

          <div style={{ height: 24 }} />

          {/* big card */}
          <div style={{
            ...cardBase, padding: "32px 32px", borderLeft: "3px solid var(--accent)",
          }}>
            <div className="h-stack" style={{ ...monoMeta }}>
              <span>{m.id}</span>
              <span style={{ margin: "0 10px" }}>·</span>
              <span>{m.when.toUpperCase()}</span>
              <span className="spacer" />
              <span>1.7 YEARS AGO</span>
            </div>
            <div style={{
              fontSize: 22, lineHeight: 1.55, color: "var(--fg)", marginTop: 16,
              fontFamily: "var(--font-body)",
            }}>
              {window.BKEMO_RENDER(m.body, { color: "var(--accent)", fontFamily: "var(--font-mono)" })}
            </div>
            <div className="h-stack gap-3" style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--border)" }}>
              <button style={btnGhost}>↳ Reply</button>
              <button style={btnGhost}>⊕ Pin</button>
              <button style={btnGhost}>↗ Share</button>
              <span className="spacer" />
              <button style={btnPrimary}>↻ Re-roll · R</button>
            </div>
          </div>

          <div style={{ height: 28 }} />

          {/* mini history of recent re-rolls */}
          <div style={monoMeta}>RECENT RE-ROLLS</div>
          <div className="v-stack" style={{ marginTop: 10, gap: 1 }}>
            {[
              { id: "BK-119", when: "Dec 2024", excerpt: "Wrote the first Tauri shell. Embarrassingly slow." },
              { id: "BK-087", when: "Oct 2024", excerpt: "Vditor's table plugin doesn't escape pipes inside cells…" },
              { id: "BK-031", when: "Jul 2024", excerpt: "Renamed all the Blinko endpoints. The migration script is hideous but it worked." },
            ].map(r => (
              <div key={r.id} className="h-stack gap-3" style={{
                padding: "10px 14px", borderBottom: "1px solid var(--border)", fontSize: 13,
              }}>
                <span style={{ ...monoCap, fontSize: 11, width: 56 }}>{r.id}</span>
                <span style={{ ...monoCap, fontSize: 11, width: 80 }}>{r.when}</span>
                <span style={{ flex: 1, color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.excerpt}</span>
                <span style={{ ...monoCap, fontSize: 10, color: "var(--fg-3)" }}>↗</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─────────── TRASH ───────────
MP.Trash = function TrashPage() {
  const trash = [
    { id: "BK-172", body: "TIL: postgres' jsonb @? operator does jsonpath existence. Useful for the tag query. #server",   when: "5 d ago",  expires: "in 25 d" },
    { id: "BK-169", body: "Draft: replies UI sketch. Probably not shipping. #idea",                                          when: "1 w ago",  expires: "in 23 d" },
    { id: "BK-164", body: "Test memo for the import script. Delete me.",                                                     when: "2 w ago",  expires: "in 16 d" },
    { id: "BK-158", body: "(empty)",                                                                                          when: "3 w ago",  expires: "in 9 d" },
    { id: "BK-141", body: "Old Anthropic key — rotated. ###REDACTED###",                                                      when: "5 w ago",  expires: "TOMORROW" },
  ];
  return (
    <div className="v-stack" style={{ flex: 1, height: "100%", overflow: "hidden" }}>
      <MPTopbar
        title="Trash"
        breadcrumb="5 memos · auto-purge in ≤ 30 days"
        right={
          <>
            <button style={btnGhost}>Restore all</button>
            <button style={btnDanger}>Empty trash</button>
          </>
        }
      />
      <div className="scroll" style={{ flex: 1, overflow: "auto", padding: "20px 28px 40px" }}>
        {/* retention card */}
        <div style={{ ...cardBase, padding: "14px 18px", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: "var(--fg)", fontWeight: 500 }}>Auto-purge after 30 days</div>
            <div style={{ ...monoCap, fontSize: 11, marginTop: 2 }}>Once a memo expires, it's gone for good. Configure in Settings → Storage.</div>
          </div>
          <div className="h-stack gap-2">
            <button style={btnGhost}>7d</button>
            <button style={{ ...btnGhost, background: "var(--bg-3)", color: "var(--fg)", borderColor: "var(--accent)" }}>30d</button>
            <button style={btnGhost}>90d</button>
            <button style={btnGhost}>Never</button>
          </div>
        </div>

        <div style={{ height: 18 }} />

        {/* bulk actions */}
        <div className="h-stack gap-3" style={{ ...monoMeta, padding: "0 4px 10px" }}>
          <input type="checkbox" style={{ accentColor: "var(--accent)" }} />
          <span>2 SELECTED</span>
          <span style={{ flex: 1 }} />
          <span style={{ color: "var(--accent)", cursor: "pointer" }}>↺ RESTORE</span>
          <span style={{ color: "#E0696B", cursor: "pointer" }}>⌫ DELETE FOREVER</span>
        </div>

        {/* table */}
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
          {/* header */}
          <div className="h-stack" style={{
            padding: "8px 14px", background: "var(--bg-2)", borderBottom: "1px solid var(--border)",
            ...monoMeta, gap: 12,
          }}>
            <span style={{ width: 20 }} />
            <span style={{ width: 60 }}>ID</span>
            <span style={{ flex: 1 }}>BODY</span>
            <span style={{ width: 80, textAlign: "right" }}>DELETED</span>
            <span style={{ width: 100, textAlign: "right" }}>EXPIRES</span>
            <span style={{ width: 100, textAlign: "right" }}>ACTIONS</span>
          </div>
          {trash.map(r => {
            const expiringSoon = r.expires.includes("TOMORROW") || r.expires.includes("9 d") || r.expires.includes("16 d");
            return (
              <div key={r.id} className="h-stack" style={{
                padding: "10px 14px", borderBottom: "1px solid var(--border)",
                fontSize: 13, gap: 12, color: "var(--fg)",
              }}>
                <input type="checkbox" style={{ accentColor: "var(--accent)", flexShrink: 0 }} />
                <span style={{ ...monoCap, width: 60 }}>{r.id}</span>
                <span style={{
                  flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  color: "var(--fg-2)", textDecoration: "line-through",
                }}>{r.body}</span>
                <span style={{ ...monoCap, fontSize: 11, width: 80, textAlign: "right" }}>{r.when}</span>
                <span style={{
                  ...monoCap, fontSize: 11, width: 100, textAlign: "right",
                  color: r.expires.includes("TOMORROW") ? "#E0696B" : (expiringSoon ? "#E8A35C" : "var(--fg-3)"),
                }}>{r.expires}</span>
                <div className="h-stack gap-2" style={{ width: 100, justifyContent: "flex-end" }}>
                  <span style={{ ...monoCap, fontSize: 11, color: "var(--accent)", cursor: "pointer" }}>↺</span>
                  <span style={{ ...monoCap, fontSize: 11, color: "#E0696B", cursor: "pointer" }}>⌫</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ─────────── SETTINGS ───────────
// Pulled from bkemo/blinko's actual sections (settings.tsx).
// We surface the single-tenant subset (no SSO/user-list).
const SETTINGS_SECTIONS = [
  { key: "basic",     title: "Basic",          icon: "⚙",  group: "you" },
  { key: "appear",    title: "Appearance",     icon: "◐",  group: "you" },
  { key: "hotkeys",   title: "Hotkeys",        icon: "⌘",  group: "you" },
  { key: "editor",    title: "Editor",         icon: "✎",  group: "you" },
  { key: "ai",        title: "AI",             icon: "✦",  group: "system" },
  { key: "storage",   title: "Storage",        icon: "▦",  group: "system" },
  { key: "sync",      title: "Sync · OTA",     icon: "↻",  group: "system" },
  { key: "tasks",     title: "Scheduled jobs", icon: "☉",  group: "system" },
  { key: "proxy",     title: "HTTP proxy",     icon: "⌖",  group: "system" },
  { key: "plugins",   title: "Plugins",        icon: "⌥",  group: "data" },
  { key: "import",    title: "Import",         icon: "⇣",  group: "data" },
  { key: "export",    title: "Export",         icon: "⇡",  group: "data" },
  { key: "about",     title: "About",          icon: "ⓘ",  group: "data" },
];

function SettingsNav({ active, onSelect }) {
  const groups = [
    { id: "you",    label: "You" },
    { id: "system", label: "System" },
    { id: "data",   label: "Data" },
  ];
  return (
    <div className="v-stack scroll" style={{
      width: 220, borderRight: "1px solid var(--border)", padding: "16px 8px",
      gap: 1, overflow: "auto", background: "var(--bg)", flexShrink: 0,
    }}>
      <div className="h-stack" style={{
        margin: "2px 8px 14px", padding: "5px 10px",
        border: "1px solid var(--border-2)", borderRadius: "var(--radius)",
        color: "var(--fg-3)", fontSize: 12, gap: 6, background: "var(--bg-2)",
      }}>
        <span>⌕</span><span>Search settings…</span>
        <span className="spacer" />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>⌘.</span>
      </div>
      {groups.map(g => (
        <React.Fragment key={g.id}>
          <div style={{ ...monoMeta, padding: "10px 12px 6px" }}>{g.label}</div>
          {SETTINGS_SECTIONS.filter(s => s.group === g.id).map(s => (
            <div key={s.key} onClick={() => onSelect && onSelect(s.key)} className="h-stack gap-2" style={{
              padding: "6px 10px", borderRadius: "var(--radius)",
              background: active === s.key ? "var(--hover)" : "transparent",
              color: active === s.key ? "var(--fg)" : "var(--fg-2)",
              borderLeft: active === s.key ? "2px solid var(--accent)" : "2px solid transparent",
              paddingLeft: 8, fontSize: 13, cursor: "pointer",
            }}>
              <span style={{ width: 14, color: active === s.key ? "var(--accent)" : "var(--fg-3)" }}>{s.icon}</span>
              <span>{s.title}</span>
            </div>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}

function SettingRow({ title, sub, control }) {
  return (
    <div className="h-stack" style={{
      padding: "16px 0", borderBottom: "1px solid var(--border)",
      gap: 24, alignItems: "flex-start",
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, color: "var(--fg)", fontWeight: 500 }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: "var(--fg-2)", marginTop: 4, lineHeight: 1.5 }}>{sub}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{control}</div>
    </div>
  );
}

function Segmented({ options, active }) {
  return (
    <div className="h-stack" style={{
      background: "var(--bg-2)", border: "1px solid var(--border-2)",
      borderRadius: "var(--radius)", padding: 2, gap: 2,
    }}>
      {options.map(o => (
        <span key={o} style={{
          padding: "4px 12px", borderRadius: 4,
          background: o === active ? "var(--bg-3)" : "transparent",
          color: o === active ? "var(--fg)" : "var(--fg-2)",
          fontSize: 12, fontFamily: "var(--font-body)", cursor: "pointer",
        }}>{o}</span>
      ))}
    </div>
  );
}

function Swatches({ active }) {
  const colors = ["#5E6AD2", "#D97757", "#1F8A5B", "#E2497F", "#0F62FE", "#222222"];
  return (
    <div className="h-stack" style={{ gap: 8 }}>
      {colors.map(c => (
        <span key={c} style={{
          width: 26, height: 26, borderRadius: 50, background: c,
          border: c === active ? "2px solid var(--fg)" : "2px solid transparent",
          outline: c === active ? "2px solid var(--accent)" : "none",
          outlineOffset: -4,
          cursor: "pointer",
        }} />
      ))}
    </div>
  );
}

function Toggle({ on }) {
  return (
    <div style={{
      width: 36, height: 20, background: on ? "var(--accent)" : "var(--bg-3)",
      borderRadius: 12, padding: 2, position: "relative", cursor: "pointer",
      transition: "background 0.15s",
    }}>
      <div style={{
        width: 16, height: 16, background: "#fff", borderRadius: 50,
        marginLeft: on ? 16 : 0, transition: "margin 0.15s",
      }} />
    </div>
  );
}

// ── settings · Appearance (the most visual) ──
function SettingAppearance() {
  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 24, fontWeight: 600, color: "var(--fg)", letterSpacing: "-0.02em", margin: 0 }}>Appearance</h2>
        <div style={{ color: "var(--fg-2)", fontSize: 13, marginTop: 4 }}>Theme, accent and density — these match the Tweaks panel.</div>
      </div>

      <SettingRow
        title="Theme"
        sub="Light or dark surface. System follows your OS preference."
        control={<Segmented options={["Light", "Dark", "System"]} active="Dark" />}
      />
      <SettingRow
        title="Accent color"
        sub="Used for #tags, status orbs, sparklines and the focus ring."
        control={<Swatches active="#5E6AD2" />}
      />
      <SettingRow
        title="Density"
        sub="How tightly the memo stream packs."
        control={<Segmented options={["Compact", "Regular", "Comfy"]} active="Regular" />}
      />
      <SettingRow
        title="Display font"
        sub="Falls back to system stack if unavailable."
        control={
          <select style={{
            background: "var(--bg-2)", color: "var(--fg)", border: "1px solid var(--border-2)",
            borderRadius: "var(--radius)", padding: "5px 28px 5px 10px", fontSize: 12, fontFamily: "inherit",
          }}>
            <option>Inter</option><option>SF Pro</option><option>System</option>
          </select>
        }
      />
      <SettingRow
        title="Reduce motion"
        sub="Disable transitions on memo open / sidebar collapse."
        control={<Toggle on={false} />}
      />
      <SettingRow
        title="Show ID prefix (BK-###)"
        sub="Linear-style identifiers in the stream and trash."
        control={<Toggle on={true} />}
      />
      <SettingRow
        title="Language"
        sub="i18n via i18next — same catalogues as upstream Blinko."
        control={
          <select style={{
            background: "var(--bg-2)", color: "var(--fg)", border: "1px solid var(--border-2)",
            borderRadius: "var(--radius)", padding: "5px 28px 5px 10px", fontSize: 12, fontFamily: "inherit",
          }}>
            <option>English</option><option>简体中文</option><option>日本語</option><option>Deutsch</option>
          </select>
        }
      />
    </div>
  );
}

// ── settings · AI ──
function SettingAI() {
  const providers = [
    { name: "Anthropic",  model: "claude-sonnet-4-5", on: true,  key: "sk-ant-•••••3kY" },
    { name: "OpenAI",     model: "gpt-4o-mini",        on: false, key: "" },
    { name: "Google",     model: "gemini-2.0-flash",   on: false, key: "" },
    { name: "Ollama",     model: "llama3.1:8b · local", on: true, key: "—" },
    { name: "Azure",      model: "—",                  on: false, key: "" },
  ];
  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 24, fontWeight: 600, color: "var(--fg)", letterSpacing: "-0.02em", margin: 0 }}>AI</h2>
        <div style={{ color: "var(--fg-2)", fontSize: 13, marginTop: 4 }}>Providers, embeddings, and the @mastra/rag refile threshold.</div>
      </div>

      {/* providers card */}
      <div style={{ ...cardBase, padding: "8px 0", marginBottom: 22 }}>
        <div className="h-stack" style={{ padding: "12px 16px 8px", ...monoMeta }}>
          <span style={{ flex: 1 }}>Providers</span>
          <span style={{ color: "var(--accent)", cursor: "pointer", textTransform: "none", letterSpacing: 0 }}>＋ Add</span>
        </div>
        {providers.map(p => (
          <div key={p.name} className="h-stack" style={{
            padding: "10px 16px", borderTop: "1px solid var(--border)",
            gap: 14, fontSize: 13,
          }}>
            <Toggle on={p.on} />
            <span style={{ width: 90, color: "var(--fg)", fontWeight: 500 }}>{p.name}</span>
            <span style={{ flex: 1, color: "var(--fg-2)", fontFamily: "var(--font-mono)", fontSize: 12 }}>{p.model}</span>
            <span style={{ ...monoCap, fontSize: 11 }}>{p.key || <span style={{ color: "var(--fg-3)" }}>no key</span>}</span>
            <span style={{ ...monoCap, fontSize: 11, color: "var(--fg-3)", cursor: "pointer" }}>···</span>
          </div>
        ))}
      </div>

      <SettingRow
        title="Default chat model"
        sub="Used by the @ai command in the composer."
        control={
          <select style={{
            background: "var(--bg-2)", color: "var(--fg)", border: "1px solid var(--border-2)",
            borderRadius: "var(--radius)", padding: "5px 28px 5px 10px", fontSize: 12, fontFamily: "inherit",
          }}>
            <option>claude-sonnet-4-5 (Anthropic)</option>
            <option>gpt-4o-mini (OpenAI)</option>
            <option>llama3.1:8b (Ollama)</option>
          </select>
        }
      />
      <SettingRow
        title="Embedding model"
        sub="Powers semantic search and AI-assisted refile."
        control={
          <select style={{
            background: "var(--bg-2)", color: "var(--fg)", border: "1px solid var(--border-2)",
            borderRadius: "var(--radius)", padding: "5px 28px 5px 10px", fontSize: 12, fontFamily: "inherit",
          }}>
            <option>text-embedding-3-small</option>
            <option>nomic-embed-text (Ollama)</option>
            <option>voyage-3-lite</option>
          </select>
        }
      />
      <SettingRow
        title="AI-assisted refile"
        sub="When saving a Blinko, suggest a tag if top-1 cosine similarity exceeds the threshold."
        control={
          <div className="v-stack" style={{ alignItems: "flex-end", gap: 4, width: 240 }}>
            <div style={{ ...monoCap, fontSize: 11 }}>threshold · 0.78</div>
            <div style={{
              width: "100%", height: 4, background: "var(--bg-3)", borderRadius: 2, position: "relative",
            }}>
              <div style={{ position: "absolute", left: 0, top: 0, width: "78%", height: 4, background: "var(--accent)", borderRadius: 2 }} />
              <div style={{ position: "absolute", left: "78%", top: -4, width: 12, height: 12, background: "#fff", border: "2px solid var(--accent)", borderRadius: 50 }} />
            </div>
          </div>
        }
      />
      <SettingRow
        title="Daily summary"
        sub="Generate a one-paragraph summary at the end of each day for Daily review."
        control={<Toggle on={true} />}
      />
      <SettingRow
        title="HTTP proxy for AI"
        sub="Route AI requests through the proxy configured in Settings → HTTP proxy."
        control={<Toggle on={false} />}
      />
    </div>
  );
}

MP.Settings = function SettingsPage({ section = "appear", onSection }) {
  return (
    <div className="v-stack" style={{ flex: 1, height: "100%", overflow: "hidden" }}>
      <MPTopbar
        title="Settings"
        breadcrumb={SETTINGS_SECTIONS.find(s => s.key === section)?.title || "—"}
        right={
          <>
            <button style={btnGhost}>Reset</button>
            <button style={btnPrimary}>Save · ⌘S</button>
          </>
        }
      />
      <div className="h-stack" style={{ flex: 1, overflow: "hidden" }}>
        <SettingsNav active={section} onSelect={onSection} />
        <div className="scroll" style={{ flex: 1, overflow: "auto", padding: "28px 36px 48px" }}>
          <div style={{ maxWidth: 760 }}>
            {section === "ai" ? <SettingAI /> : <SettingAppearance />}
          </div>
        </div>
      </div>
    </div>
  );
};

window.MixPages = MP;
