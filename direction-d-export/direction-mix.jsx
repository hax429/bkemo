/* @jsx React.createElement */
// Direction D — Mix: Linear-style stream + Quartz-style review sidebar.
// Reuses Issue's stream + a Linear-skinned heatmap/stats/throwback panel.
// window.Mix = { Web, Mac, IOS }

const MX = {};

// Heatmap — Linear-skinned (mono labels, no serif anywhere)
function MXHeatmap({ compact }) {
  const data = window.BKEMO_DATA.heatmap;
  const cell = compact ? 10 : 12;
  const gap = 2;
  const cols = 12, rows = 7;
  const intensityColor = (v) => {
    if (v === 0) return "var(--bg-3)";
    const a = [0.22, 0.42, 0.65, 0.9][v - 1];
    return `color-mix(in srgb, var(--accent) ${a*100}%, var(--bg-3))`;
  };
  return (
    <div>
      <div className="h-stack" style={{
        fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".06em",
        color: "var(--fg-3)", textTransform: "uppercase",
      }}>
        <span style={{ flex: 1 }}>Last 12 weeks</span>
        <span>84 memos</span>
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, ${cell}px)`,
        gridTemplateRows: `repeat(${rows}, ${cell}px)`,
        gap, marginTop: 10, gridAutoFlow: "column",
      }}>
        {data.map((v, i) => (
          <div key={i} style={{
            width: cell, height: cell, borderRadius: 2,
            background: intensityColor(v),
          }} />
        ))}
      </div>
      <div className="h-stack" style={{
        marginTop: 10, fontFamily: "var(--font-mono)", fontSize: 10,
        color: "var(--fg-3)",
      }}>
        <span>Less</span>
        <div className="h-stack" style={{ gap: 2, margin: "0 10px" }}>
          {[0,1,2,3,4].map(v => (
            <div key={v} style={{ width: 9, height: 9, borderRadius: 2, background: intensityColor(v) }} />
          ))}
        </div>
        <span>More</span>
      </div>
    </div>
  );
}

function MXSparkline() {
  const pts = [3, 5, 4, 7, 6, 9, 8, 5, 7, 10, 8, 12, 9, 11];
  const max = Math.max(...pts);
  const w = 240, h = 36;
  const stepX = w / (pts.length - 1);
  const d = pts.map((p, i) => {
    const x = i * stepX;
    const y = h - (p / max) * (h - 2) - 1;
    return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
      <path d={d + ` L ${w} ${h} L 0 ${h} Z`} fill="var(--accent-soft)" />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  );
}

function MXReview({ compact }) {
  const tb = window.BKEMO_DATA.throwback;
  return (
    <div className="v-stack scroll" style={{
      width: 296, height: "100%", overflow: "auto",
      background: "var(--bg-2)", borderLeft: "1px solid var(--border)",
      padding: "16px 18px",
    }}>
      {/* date hero */}
      <div className="h-stack" style={{
        fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: ".04em",
        color: "var(--fg-3)",
      }}>
        <span style={{ flex: 1 }}>WED · MAY 28</span>
        <span style={{ color: "#3FCB7E" }}>● synced</span>
      </div>
      <h2 style={{
        fontFamily: "var(--font-body)", fontSize: 32, fontWeight: 600,
        margin: "4px 0 0", letterSpacing: "-0.02em", lineHeight: 1, color: "var(--fg)",
      }}>Today</h2>
      <div style={{
        marginTop: 6, fontSize: 12, color: "var(--fg-2)",
      }}>4 memos · streak 84d</div>

      <div style={{ height: 18 }} />

      {/* this week panel */}
      <div style={{
        background: "var(--bg)", border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)", padding: "12px 14px",
      }}>
        <div className="h-stack" style={{
          fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".04em",
          color: "var(--fg-3)", textTransform: "uppercase",
        }}>
          <span style={{ flex: 1 }}>This week</span>
          <span style={{ color: "var(--accent)" }}>+18%</span>
        </div>
        <div className="h-stack" style={{ alignItems: "baseline", marginTop: 4, gap: 6 }}>
          <span style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--fg)" }}>23</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-3)" }}>memos</span>
        </div>
        <div style={{ marginTop: 8 }}>
          <MXSparkline />
        </div>
      </div>

      <div style={{ height: 14 }} />

      {/* stat grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[
          { label: "tags",   value: "11" },
          { label: "streak", value: "84d" },
          { label: "daily ☉", value: "5/7" },
          { label: "drafts", value: "2" },
        ].map(s => (
          <div key={s.label} style={{
            background: "var(--bg)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)", padding: "10px 12px",
          }}>
            <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--fg)" }}>{s.value}</div>
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 10,
              color: "var(--fg-3)", marginTop: 2, letterSpacing: ".04em",
            }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ height: 18 }} />

      {/* heatmap */}
      <MXHeatmap compact={compact} />

      <div style={{ height: 18 }} />

      {/* top tags */}
      <div className="h-stack" style={{
        fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".04em",
        color: "var(--fg-3)", textTransform: "uppercase",
      }}>
        <span style={{ flex: 1 }}>Top tags · 7d</span>
      </div>
      <div className="v-stack" style={{ gap: 6, marginTop: 8 }}>
        {[
          { tag: "#ios", count: 11, w: 100 },
          { tag: "#tauri", count: 7, w: 64 },
          { tag: "#server", count: 5, w: 46 },
          { tag: "#daily", count: 4, w: 36 },
          { tag: "#idea", count: 3, w: 27 },
        ].map(t => (
          <div key={t.tag} className="h-stack" style={{ gap: 8, fontSize: 12 }}>
            <span style={{ width: 60, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>{t.tag}</span>
            <div style={{ flex: 1, height: 6, background: "var(--bg-3)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ width: `${t.w}%`, height: "100%", background: "var(--accent)", borderRadius: 2 }} />
            </div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-3)", width: 14, textAlign: "right" }}>{t.count}</span>
          </div>
        ))}
      </div>

      <div style={{ height: 18 }} />

      {/* throwback */}
      <div className="h-stack" style={{
        fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".04em",
        color: "var(--fg-3)", textTransform: "uppercase",
      }}>
        <span style={{ flex: 1 }}>On this day</span>
        <span>↻</span>
      </div>
      <div style={{
        marginTop: 8, background: "var(--bg)",
        border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
        padding: "12px 14px",
      }}>
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: 10,
          color: "var(--fg-3)", letterSpacing: ".04em",
        }}>{tb.id} · {tb.when.toUpperCase()}</div>
        <div style={{
          fontSize: 13, lineHeight: 1.5, color: "var(--fg)", marginTop: 6,
        }}>{tb.body}</div>
        <div className="h-stack gap-2" style={{
          marginTop: 8, fontFamily: "var(--font-mono)", fontSize: 11,
          color: "var(--accent)",
        }}>
          {tb.tags.map(t => <span key={t}>{t}</span>)}
        </div>
      </div>
    </div>
  );
}

// ───── ASSEMBLE ─────
// Mix is now Issue's stream (with the new Todos section + Stats nav item
// living in Issue's sidebar). The previous right-side review pane has been
// removed — Stats lives behind the nav item instead. Throwback gets appended
// at the tail of the feed (web/mac) and at the bottom of iOS scroll.

const { useState: mxUseState } = React;

function MixStream({ density }) {
  const { throwback } = window.BKEMO_DATA;
  return (
    <div className="v-stack" style={{ flex: 1, height: "100%", overflow: "hidden" }}>
      <Issue.Topbar />
      <div className="scroll" style={{ flex: 1, overflow: "auto" }}>
        <Issue.Feed density={density} embedded />
        {/* Throwback tail */}
        <div style={{ padding: "20px 16px 24px", background: "var(--bg)" }}>
          <div className="h-stack" style={{
            fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)",
            letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 10,
          }}>
            <span style={{ flex: 1 }}>On this day</span>
            <span style={{ cursor: "pointer" }}>↻ random</span>
          </div>
          <div style={{
            background: "var(--bg-2)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)", padding: "12px 14px", maxWidth: 700,
          }}>
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)", letterSpacing: ".06em",
            }}>{throwback.id} · {throwback.when.toUpperCase()}</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--fg)", marginTop: 6 }}>
              {throwback.body}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function renderRoute(route, density, settingsSection, onSection, onFilterChange) {
  if (route === "stats")    return <MixPages.Stats />;
  if (route === "calendar") return <MixCalendar />;
  if (route === "daily")    return <MixPagesB.DailyReviewV2 />;
  if (route === "random")   return <MixPages.Random />;
  if (route === "trash")    return <MixPages.Trash />;
  if (route === "settings") return <MixPages.Settings section={settingsSection} onSection={onSection} />;
  // Todo routes
  if (route === "inbox" || route === "today" || route === "tomorrow" ||
      route === "week" || route === "matrix") {
    return <MixPagesB.Todos filter={route} onFilter={onFilterChange} density={density} />;
  }
  return <MixStream density={density} />;
}

MX.Web = function MixWeb({ density = "regular", initialRoute = "home", initialSettingsSection = "appear" }) {
  const [route, setRoute] = mxUseState(initialRoute);
  const [settingsSection, setSettingsSection] = mxUseState(initialSettingsSection);
  return (
    <div className="surface dir-issue" style={{ display: "flex", height: "100%", width: "100%" }}>
      <MixSidebar
        tight={density === "compact"}
        activeRoute={route}
        onNav={(id) => {
          if (id.startsWith && id.startsWith("tag:")) { setRoute("home"); return; }
          setRoute(id);
        }}
      />
      {renderRoute(route, density, settingsSection, setSettingsSection, setRoute)}
    </div>
  );
};

MX.Mac = MX.Web;

// iOS: stream + throwback at bottom. No top stats strip (Stats lives in the
// sidebar / nav tab now).
MX.IOS = function MixIOS({ density = "regular" }) {
  const { memos, throwback } = window.BKEMO_DATA;
  const tagStyle = { color: "var(--accent)", fontFamily: "var(--font-mono)" };
  const groups = {};
  memos.forEach(m => { (groups[m.day] = groups[m.day] || []).push(m); });
  return (
    <div className="surface dir-issue" style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
      {/* topbar */}
      <div className="h-stack" style={{
        padding: "8px 14px", gap: 8, borderBottom: "1px solid var(--border)",
      }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--fg)" }}>Home</span>
        <span style={{ color: "var(--fg-3)" }}>·</span>
        <span style={{ color: "var(--fg-2)", fontSize: 13 }}>Stream</span>
        <span className="spacer" />
        <span style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 11 }}>⌘K</span>
      </div>
      {/* composer */}
      <div style={{ padding: "10px 14px", flexShrink: 0 }}>
        <div style={{
          background: "var(--bg-2)", border: "1px solid var(--border)",
          borderRadius: 6, padding: "10px 12px",
        }}>
          <div style={{ fontSize: 13, color: "var(--fg-3)" }}>New memo…</div>
          <div className="h-stack gap-2" style={{ marginTop: 8 }}>
            <span style={{ color: "var(--fg-3)", fontSize: 13 }}>＃</span>
            <span style={{ color: "var(--fg-3)", fontSize: 13 }}>📷</span>
            <span className="spacer" />
            <button style={{
              background: "var(--accent)", color: "#fff", border: "none",
              padding: "4px 12px", borderRadius: 4, fontSize: 12, fontWeight: 500,
            }}>Send</button>
          </div>
        </div>
      </div>
      {/* feed */}
      <div className="scroll" style={{ flex: 1, overflow: "auto" }}>
        {Object.entries(groups).map(([day, list]) => (
          <React.Fragment key={day}>
            <div className="h-stack gap-2" style={{
              padding: "0 14px", height: 26, background: "var(--bg-2)",
              borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)",
              color: "var(--fg-2)", fontSize: 11, fontWeight: 500,
            }}>
              <span>{day}</span>
              <span style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)" }}>{list.length}</span>
            </div>
            {list.map(m => (
              <div key={m.id} style={{
                padding: density === "compact" ? "9px 14px" : density === "comfy" ? "14px 14px" : "11px 14px",
                borderBottom: "1px solid var(--border)",
              }}>
                <div className="h-stack gap-2" style={{
                  fontSize: 11, color: "var(--fg-3)", fontFamily: "var(--font-mono)",
                }}>
                  <span>{m.id}</span>
                  <span>·</span>
                  <span>{m.hour}</span>
                  <span className="spacer" />
                  <span>{m.ts}</span>
                </div>
                <div style={{
                  fontSize: 13.5, lineHeight: 1.55, color: "var(--fg)", marginTop: 3,
                }}>{window.BKEMO_RENDER(m.body, tagStyle)}</div>
              </div>
            ))}
          </React.Fragment>
        ))}
        {/* throwback at the bottom */}
        <div style={{ padding: "16px 14px 18px" }}>
          <div className="h-stack" style={{
            fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)",
            letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 8,
          }}>
            <span style={{ flex: 1 }}>On this day</span>
            <span>↻</span>
          </div>
          <div style={{
            background: "var(--bg-2)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "12px",
          }}>
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)",
            }}>{throwback.id} · {throwback.when.toUpperCase()}</div>
            <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--fg)", marginTop: 4 }}>
              {throwback.body}
            </div>
          </div>
        </div>
      </div>
      {/* tabbar */}
      <div className="h-stack" style={{
        borderTop: "1px solid var(--border)", padding: "8px 18px",
        justifyContent: "space-between", background: "var(--bg-2)", flexShrink: 0,
      }}>
        {[{g:"✦",l:"Home",on:true},{g:"#",l:"Tags"},{g:"＋",l:"New"},{g:"☉",l:"Daily"},{g:"↻",l:"Random"}].map(t => (
          <div key={t.l} className="v-stack" style={{ alignItems: "center", gap: 2, color: t.on ? "var(--accent)" : "var(--fg-3)" }}>
            <span style={{ fontSize: 18 }}>{t.g}</span>
            <span style={{ fontSize: 10 }}>{t.l}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

window.Mix = MX;
