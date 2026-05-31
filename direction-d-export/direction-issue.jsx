/* @jsx React.createElement */
// Direction B — Issue (Linear-dense, dark) — short-memo stream
// window.Issue = { Web, Mac, IOS }

const IS = {};

function ISTodoCheck({ done, size = 12 }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: 3,
      border: `1.5px solid ${done ? "var(--accent)" : "var(--fg-3)"}`,
      background: done ? "var(--accent)" : "transparent",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0, color: "var(--bg)", fontSize: size - 4, lineHeight: 1,
    }}>{done ? "✓" : ""}</span>
  );
}

function ISTagTree({ tight, activeRoute, onNav }) {
  const { tagTree, nav, memos } = window.BKEMO_DATA;
  const todos = memos.filter(m => m.task && !m.done);
  const rowPad = tight ? "3px 8px" : "4px 8px";
  const isActive = (n) => activeRoute != null ? activeRoute === n.id : !!n.active;
  const Row = ({ icon, title, count, active, indent, dim, onClick }) => (
    <div onClick={onClick} className="h-stack gap-2" style={{
      padding: rowPad, paddingLeft: 10 + (indent || 0),
      borderRadius: "var(--radius)",
      background: active ? "var(--hover)" : "transparent",
      color: dim ? "var(--fg-2)" : (active ? "var(--fg)" : "var(--fg-2)"),
      fontSize: 13, cursor: onClick ? "pointer" : "default",
      borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
      paddingLeft: 8 + (indent || 0),
    }}>
      {icon !== undefined && <span style={{ width: 14, fontSize: 12, color: active ? "var(--accent)" : "var(--fg-3)" }}>{icon}</span>}
      <span style={{ flex: 1 }}>{title}</span>
      {count != null && <span style={{ color: "var(--fg-3)", fontSize: 11, fontFamily: "var(--font-mono)" }}>{count}</span>}
    </div>
  );

  return (
    <div className="v-stack scroll" style={{
      width: 224, background: "var(--bg-2)", borderRight: "1px solid var(--border)",
      padding: "10px 6px", gap: 1, height: "100%", overflow: "auto",
    }}>
      <div className="h-stack gap-2" style={{ padding: "6px 8px 12px" }}>
        <div className="avatar" style={{ width: 20, height: 20, borderRadius: 5, fontSize: 10 }}>{window.BKEMO_DATA.user.initials}</div>
        <div style={{ fontWeight: 600, fontSize: 13, color: "var(--fg)" }}>bkemo</div>
        <span style={{ color: "var(--fg-3)", fontSize: 11 }}>▾</span>
        <span className="spacer" />
        <span style={{
          color: "var(--fg-3)", fontSize: 11, padding: "2px 6px",
          borderRadius: 3, border: "1px solid var(--border-2)", fontFamily: "var(--font-mono)",
        }}>⌘N</span>
      </div>

      {nav.map(n => (
        <Row key={n.id} icon={n.icon} title={n.title} count={n.count} active={isActive(n)} onClick={() => onNav && onNav(n.id)} />
      ))}

      {/* Todos section */}
      <div style={{ height: 14 }} />
      <div className="h-stack" style={{
        padding: "4px 10px", color: "var(--fg-3)", fontSize: 11,
        letterSpacing: ".02em", fontWeight: 500,
      }}>
        <span style={{ flex: 1 }}>TODOS</span>
        <span style={{ fontFamily: "var(--font-mono)" }}>{todos.length}</span>
      </div>
      {todos.slice(0, 4).map(m => (
        <div key={m.id} className="h-stack gap-2" style={{
          padding: "5px 10px", borderRadius: "var(--radius)",
          alignItems: "flex-start",
        }}>
          <ISTodoCheck done={m.done} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 12, color: "var(--fg)", lineHeight: 1.3,
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
            }}>{m.body.replace(/#[a-zA-Z0-9_\/-]+/g, "").replace(/\s+/g," ").trim()}</div>
            <div style={{
              fontSize: 10, color: "var(--fg-3)", fontFamily: "var(--font-mono)",
              marginTop: 2,
            }}>{m.id} {m.due ? "· " + m.due : ""}</div>
          </div>
        </div>
      ))}

      <div style={{ height: 14 }} />
      <div className="h-stack" style={{
        padding: "4px 10px", color: "var(--fg-3)", fontSize: 11,
        letterSpacing: ".02em", fontWeight: 500,
      }}>
        <span style={{ flex: 1 }}>TAGS</span>
        <span>＋</span>
      </div>

      {tagTree.map(t => (
        <React.Fragment key={t.id}>
          <div className="h-stack gap-2" style={{ padding: rowPad, borderRadius: "var(--radius)", fontSize: 13 }}>
            <span style={{ width: 10, fontSize: 9, color: "var(--fg-3)" }}>{t.expanded ? "▾" : "▸"}</span>
            <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>#{t.title}</span>
            <span className="spacer" />
            <span style={{ color: "var(--fg-3)", fontSize: 11, fontFamily: "var(--font-mono)" }}>{t.count}</span>
          </div>
          {t.expanded && t.children?.map(c => (
            <div key={c.id} className="h-stack gap-2" style={{
              padding: rowPad, paddingLeft: 30, color: "var(--fg-2)", fontSize: 12,
            }}>
              <span style={{ color: "var(--accent)", opacity: .75, fontFamily: "var(--font-mono)" }}>#{c.title}</span>
              <span className="spacer" />
              <span style={{ color: "var(--fg-3)", fontSize: 11, fontFamily: "var(--font-mono)" }}>{c.count}</span>
            </div>
          ))}
        </React.Fragment>
      ))}

      <div style={{ marginTop: "auto", padding: "10px 8px", borderTop: "1px solid var(--border)" }}>
        <div className="h-stack gap-2" style={{ fontSize: 12, color: "var(--fg-3)" }}>
          <span style={{ width: 6, height: 6, borderRadius: 50, background: "#3FCB7E" }} />
          <span>Synced · 2 pending</span>
        </div>
      </div>
    </div>
  );
}

function ISTopbar() {
  return (
    <div className="h-stack" style={{
      height: 44, padding: "0 14px", borderBottom: "1px solid var(--border)",
      gap: 10, background: "var(--bg)",
    }}>
      <div className="h-stack gap-2" style={{ color: "var(--fg)", fontSize: 13, fontWeight: 500 }}>
        <span>✦</span><span>Home</span>
      </div>
      <span style={{ color: "var(--fg-3)" }}>/</span>
      <span style={{ color: "var(--fg-2)", fontSize: 13 }}>Stream</span>
      <span className="spacer" />
      <div className="h-stack gap-2" style={{
        padding: "4px 10px", border: "1px solid var(--border-2)",
        borderRadius: "var(--radius)", color: "var(--fg-3)", fontSize: 12, background: "var(--bg-2)",
      }}>
        <span>⌕</span><span>Find memos…</span>
        <span style={{ marginLeft: 28, fontFamily: "var(--font-mono)", fontSize: 11 }}>⌘K</span>
      </div>
      <button style={btnGhostIS}>Filter</button>
      <button style={btnGhostIS}>Sort</button>
    </div>
  );
}
const btnGhostIS = {
  background: "transparent", border: "1px solid var(--border-2)",
  color: "var(--fg-2)", padding: "4px 10px", borderRadius: "var(--radius)", fontSize: 12,
};

function ISComposer() {
  return (
    <div style={{
      background: "var(--bg-2)", border: "1px solid var(--border)",
      borderRadius: "var(--radius)", padding: "10px 12px", marginBottom: 14,
    }}>
      <div style={{ fontSize: 13, color: "var(--fg-3)", lineHeight: 1.5 }}>
        New memo · <span style={{ color: "var(--accent)" }}>#tag</span> to file, <span style={{ fontFamily: "var(--font-mono)" }}>⌘↵</span> to send
      </div>
      <div className="h-stack gap-3" style={{ marginTop: 10 }}>
        <span style={{ color: "var(--fg-3)", fontSize: 13, fontFamily: "var(--font-mono)" }}>＃  📷  🔗  ✦</span>
        <span className="spacer" />
        <span style={{ color: "var(--fg-3)", fontSize: 11, fontFamily: "var(--font-mono)" }}>0/280</span>
        <button style={{
          background: "var(--accent)", border: "none", color: "#fff",
          padding: "4px 12px", borderRadius: "var(--radius)", fontSize: 12, fontWeight: 500,
        }}>Send</button>
      </div>
    </div>
  );
}

function ISMemoRow({ m, density }) {
  const pad = density === "compact" ? "8px 14px" : density === "comfy" ? "16px 14px" : "12px 14px";
  const tagStyle = { color: "var(--accent)", fontFamily: "var(--font-mono)" };
  return (
    <div style={{
      padding: pad, borderBottom: "1px solid var(--border)",
      display: "grid",
      gridTemplateColumns: m.task ? "auto auto auto 1fr auto auto" : "auto auto 1fr auto auto",
      columnGap: 12, alignItems: "start",
    }}>
      {m.task && (
        <span style={{ paddingTop: 4 }}><ISTodoCheck done={m.done} /></span>
      )}
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-3)",
        paddingTop: 3, letterSpacing: 0,
      }}>{m.id}</span>
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-3)",
        paddingTop: 3, width: 38,
      }}>{m.hour}</span>
      <div style={{
        fontSize: 13.5, lineHeight: density === "compact" ? 1.5 : 1.65,
        color: m.done ? "var(--fg-3)" : "var(--fg)",
        textDecoration: m.done ? "line-through" : "none",
      }}>
        {window.BKEMO_RENDER(m.body, tagStyle)}
      </div>
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-3)",
        paddingTop: 3, width: 46, textAlign: "right",
      }}>{m.ts}</span>
      <div className="avatar" style={{ width: 18, height: 18, fontSize: 9, marginTop: 1 }}>
        {window.BKEMO_DATA.user.initials}
      </div>
    </div>
  );
}

function ISFeed({ density }) {
  const { memos } = window.BKEMO_DATA;
  const groups = {};
  memos.forEach(m => { (groups[m.day] = groups[m.day] || []).push(m); });
  return (
    <div className="scroll" style={{ flex: 1, overflow: "auto" }}>
      <div style={{ padding: "16px 16px 0" }}>
        <ISComposer />
      </div>
      {Object.entries(groups).map(([day, list]) => (
        <React.Fragment key={day}>
          <div className="h-stack gap-2" style={{
            padding: "0 14px", height: 30, background: "var(--bg-2)",
            borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)",
            color: "var(--fg-2)", fontSize: 12, fontWeight: 500,
          }}>
            <span style={{ fontSize: 10, color: "var(--fg-3)" }}>▾</span>
            <span>{day}</span>
            <span style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{list.length}</span>
          </div>
          {list.map(m => <ISMemoRow key={m.id} m={m} density={density} />)}
        </React.Fragment>
      ))}
    </div>
  );
}

IS.Web = function IssueWeb({ density = "regular" }) {
  return (
    <div className="surface dir-issue" style={{ display: "flex", height: "100%", width: "100%" }}>
      <ISTagTree tight={density === "compact"} />
      <div className="v-stack" style={{ flex: 1, height: "100%", overflow: "hidden" }}>
        <ISTopbar />
        <ISFeed density={density} />
      </div>
    </div>
  );
};
IS.Mac = IS.Web;

IS.IOS = function IssueIOS({ density = "regular" }) {
  const { memos } = window.BKEMO_DATA;
  const tagStyle = { color: "var(--accent)", fontFamily: "var(--font-mono)" };
  const groups = {};
  memos.forEach(m => { (groups[m.day] = groups[m.day] || []).push(m); });
  return (
    <div className="surface dir-issue" style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
      {/* topbar */}
      <div className="h-stack" style={{ padding: "8px 14px", gap: 8, borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--fg)" }}>Home</span>
        <span style={{ color: "var(--fg-3)" }}>/</span>
        <span style={{ color: "var(--fg-2)", fontSize: 13 }}>Stream</span>
        <span className="spacer" />
        <span style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 11 }}>⌘K</span>
      </div>
      {/* composer */}
      <div style={{ padding: "10px 14px" }}>
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
                  {m.task && <ISTodoCheck done={m.done} size={11} />}
                  <span>{m.id}</span>
                  <span>·</span>
                  <span>{m.hour}</span>
                  <span className="spacer" />
                  <span>{m.ts}</span>
                </div>
                <div style={{
                  fontSize: 13.5, lineHeight: 1.55,
                  color: m.done ? "var(--fg-3)" : "var(--fg)",
                  textDecoration: m.done ? "line-through" : "none",
                  marginTop: 3,
                }}>{window.BKEMO_RENDER(m.body, tagStyle)}</div>
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
      {/* tabbar */}
      <div className="h-stack" style={{
        borderTop: "1px solid var(--border)", padding: "8px 18px",
        justifyContent: "space-between", background: "var(--bg-2)",
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

window.Issue = IS;
Object.assign(IS, { TagTree: ISTagTree, Topbar: ISTopbar, Feed: ISFeed, TodoCheck: ISTodoCheck });
