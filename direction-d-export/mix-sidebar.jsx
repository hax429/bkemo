/* @jsx React.createElement */
// Direction D — Mix sidebar v3.
// Workspace dropdown (Stats / Calendar / Settings) replaces the in-sidebar
// Stats section. Sidebar now has only: Notes · Todos · Projects.
// window.MixSidebar = function

const { useState: msUseState, useEffect: msUseEffect } = React;

const msMonoLbl = {
  fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".10em",
  color: "var(--fg-3)", textTransform: "uppercase", fontWeight: 500,
};

function MSNavRow({ icon, title, count, active, onClick }) {
  return (
    <div
      onClick={onClick}
      title={title}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "5px 8px", borderRadius: "var(--radius)",
        background: active ? "var(--hover)" : "transparent",
        color: active ? "var(--fg)" : "var(--fg-2)",
        fontSize: 13, cursor: onClick ? "pointer" : "default",
        borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
        paddingLeft: 8,
        transition: "background 0.1s",
        userSelect: "none",
      }}
      onMouseEnter={(e) => {
        if (!active && onClick) e.currentTarget.style.background = "var(--hover)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{
        width: 16, fontSize: 12, textAlign: "center",
        color: active ? "var(--accent)" : "var(--fg-3)",
        flexShrink: 0,
      }}>{icon}</span>
      <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
      {count != null && (
        <span style={{
          color: "var(--fg-3)", fontSize: 11,
          fontFamily: "var(--font-mono)", flexShrink: 0,
        }}>{count}</span>
      )}
    </div>
  );
}

function MSSection({ label, action }) {
  return (
    <div style={{
      ...msMonoLbl, padding: "10px 12px 6px",
      display: "flex", alignItems: "center", gap: 6,
    }}>
      <span style={{ flex: 1 }}>{label}</span>
      {action}
    </div>
  );
}

// ── Workspace dropdown ──
function WorkspaceDropdown({ activeRoute, onNav, onClose }) {
  const D = window.BKEMO_DATA;
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: 50, left: 8, right: 8,
        zIndex: 30,
        background: "var(--bg)",
        border: "1px solid var(--border-2)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.02)",
        padding: 4,
        animation: "msDropdown 120ms ease-out",
      }}
    >
      {/* workspace header inside menu */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 10px 10px 10px",
        borderBottom: "1px solid var(--border)",
        marginBottom: 4,
      }}>
        <div className="avatar" style={{ width: 28, height: 28, borderRadius: 6, fontSize: 12 }}>{D.user.initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>bkemo</div>
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 10,
            color: "var(--fg-3)", letterSpacing: ".04em",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>bk.hax429.me · {D.user.handle}</div>
        </div>
        <span style={{ color: "var(--fg-3)", fontSize: 11 }}>▴</span>
      </div>

      {/* primary items */}
      {D.workspaceMenu.map(item => (
        <div
          key={item.id}
          onClick={() => { onNav(item.id); onClose(); }}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "7px 10px", borderRadius: 4,
            background: activeRoute === item.id ? "var(--hover)" : "transparent",
            color: activeRoute === item.id ? "var(--fg)" : "var(--fg-2)",
            fontSize: 13, cursor: "pointer",
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover)"}
          onMouseLeave={(e) => e.currentTarget.style.background = activeRoute === item.id ? "var(--hover)" : "transparent"}
        >
          <span style={{
            width: 16, textAlign: "center", fontSize: 13,
            color: activeRoute === item.id ? "var(--accent)" : "var(--fg-3)",
          }}>{item.icon}</span>
          <span style={{ flex: 1 }}>{item.title}</span>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 10,
            color: "var(--fg-3)", letterSpacing: ".06em",
          }}>{item.kbd}</span>
        </div>
      ))}

      <div style={{ height: 1, background: "var(--border)", margin: "6px 0" }} />

      {/* secondary items */}
      {[
        { i: "↗", t: "Open bk.hax429.me",     k: "" },
        { i: "⌥", t: "What's new",            k: "" },
        { i: "?", t: "Keyboard shortcuts",    k: "?" },
      ].map((s, idx) => (
        <div
          key={idx}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "6px 10px", borderRadius: 4,
            color: "var(--fg-2)", fontSize: 13, cursor: "pointer",
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover)"}
          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
        >
          <span style={{ width: 16, textAlign: "center", fontSize: 12, color: "var(--fg-3)" }}>{s.i}</span>
          <span style={{ flex: 1 }}>{s.t}</span>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 10,
            color: "var(--fg-3)",
          }}>{s.k}</span>
        </div>
      ))}

      <div style={{ height: 1, background: "var(--border)", margin: "6px 0" }} />

      <div
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "6px 10px", borderRadius: 4,
          color: "var(--fg-2)", fontSize: 13, cursor: "pointer",
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover)"}
        onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
      >
        <span style={{ width: 16, textAlign: "center", fontSize: 12, color: "var(--fg-3)" }}>↩</span>
        <span style={{ flex: 1 }}>Sign out</span>
      </div>
    </div>
  );
}

// ── Sidebar ──
window.MixSidebar = function MixSidebar({ activeRoute, onNav, tight }) {
  const D = window.BKEMO_DATA;
  const [menuOpen, setMenuOpen] = msUseState(false);

  // Click-away to close
  msUseEffect(() => {
    if (!menuOpen) return;
    const onDoc = () => setMenuOpen(false);
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [menuOpen]);

  return (
    <div style={{
      width: 248, height: "100%", flexShrink: 0,
      position: "relative", // anchor for dropdown
      background: "var(--bg-2)",
      borderRight: "1px solid var(--border)",
    }}>
      <style>{`
        @keyframes msDropdown {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div
        className="v-stack scroll"
        style={{
          height: "100%", overflow: "auto",
          padding: "10px 6px 8px", gap: 1,
          display: "flex", flexDirection: "column",
        }}
      >
        {/* workspace trigger */}
        <div
          onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "6px 10px",
            margin: "0 2px 10px",
            borderRadius: "var(--radius)",
            background: menuOpen ? "var(--hover)" : "transparent",
            cursor: "pointer",
            transition: "background 0.1s",
          }}
          onMouseEnter={(e) => { if (!menuOpen) e.currentTarget.style.background = "var(--hover)"; }}
          onMouseLeave={(e) => { if (!menuOpen) e.currentTarget.style.background = "transparent"; }}
        >
          <div className="avatar" style={{ width: 22, height: 22, borderRadius: 5, fontSize: 11 }}>{D.user.initials}</div>
          <div style={{ fontWeight: 600, fontSize: 13, color: "var(--fg)", flex: 1 }}>bkemo</div>
          <span style={{
            color: menuOpen ? "var(--accent)" : "var(--fg-3)",
            fontSize: 11, transition: "transform 0.1s",
            transform: menuOpen ? "rotate(180deg)" : "rotate(0deg)",
            display: "inline-block",
          }}>▾</span>
        </div>

        {/* search */}
        <div style={{
          margin: "0 6px 8px", padding: "5px 10px",
          background: "var(--bg)", border: "1px solid var(--border-2)",
          borderRadius: "var(--radius)",
          display: "flex", alignItems: "center", gap: 8,
          color: "var(--fg-3)", fontSize: 12, cursor: "pointer",
        }}>
          <span>⌕</span>
          <span style={{ flex: 1 }}>Search…</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>⌘K</span>
        </div>

        {/* new memo */}
        <div style={{
          margin: "0 6px 14px", padding: "6px 10px",
          background: "var(--accent-soft)",
          border: "1px solid color-mix(in srgb, var(--accent) 40%, transparent)",
          borderRadius: "var(--radius)",
          display: "flex", alignItems: "center", gap: 8,
          color: "var(--accent)", fontSize: 13, cursor: "pointer",
          fontWeight: 500,
        }}>
          <span>＋</span>
          <span style={{ flex: 1 }}>New memo</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>⌘N</span>
        </div>

        {/* NOTES */}
        <MSSection label="Notes" />
        {D.notesNav.map(n => (
          <MSNavRow
            key={n.id}
            icon={n.icon} title={n.title} count={n.count}
            active={activeRoute === n.id}
            onClick={() => onNav && onNav(n.id)}
          />
        ))}

        {/* TODOS */}
        <MSSection label="Todos" />
        {D.todosNav.map(n => (
          <MSNavRow
            key={n.id}
            icon={n.icon} title={n.title} count={n.count}
            active={activeRoute === n.id || (activeRoute === "todos" && n.id === "inbox")}
            onClick={() => onNav && onNav(n.id)}
          />
        ))}

        {/* PROJECTS (tag tree) */}
        <MSSection label="Projects (tags)" action={<span style={{ fontSize: 12, color: "var(--fg-3)", cursor: "pointer" }}>＋</span>} />
        {D.tagTree.map(t => (
          <React.Fragment key={t.id}>
            <div
              onClick={() => onNav && onNav("tag:" + t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "4px 8px", borderRadius: "var(--radius)",
                fontSize: 13, cursor: "pointer",
                borderLeft: "2px solid transparent", paddingLeft: 8,
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
            >
              <span style={{ width: 10, fontSize: 9, color: "var(--fg-3)" }}>{t.expanded ? "▾" : "▸"}</span>
              <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", flex: 1 }}>#{t.title}</span>
              <span style={{
                color: "var(--fg-3)", fontSize: 11, fontFamily: "var(--font-mono)",
              }}>{t.count}</span>
            </div>
            {t.expanded && t.children?.map(c => (
              <div
                key={c.id}
                onClick={() => onNav && onNav("tag:" + c.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "3px 8px 3px 30px",
                  fontSize: 12, cursor: "pointer",
                  borderRadius: "var(--radius)",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <span style={{ color: "var(--accent)", opacity: .75, fontFamily: "var(--font-mono)", flex: 1 }}>#{c.title}</span>
                <span style={{
                  color: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)",
                }}>{c.count}</span>
              </div>
            ))}
          </React.Fragment>
        ))}

        <div style={{ flex: 1 }} />

        {/* footer */}
        <div style={{
          padding: "10px 12px 4px",
          borderTop: "1px solid var(--border)",
          display: "flex", alignItems: "center", gap: 8,
          fontSize: 12, color: "var(--fg-3)",
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 50, background: "#3FCB7E" }} />
          <span>Synced · 2 pending</span>
        </div>
      </div>

      {/* Workspace dropdown — anchored absolute INSIDE the sidebar */}
      {menuOpen && (
        <WorkspaceDropdown
          activeRoute={activeRoute}
          onNav={(id) => onNav && onNav(id)}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
};
