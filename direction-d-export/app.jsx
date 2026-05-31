/* @jsx React.createElement */
// bkemo — Direction D (Mix) only.
// Interactive Mix.Web at the top, then each page state as its own artboard.

const { useState, useEffect } = React;

// ─── Browser chrome wrapper ───
function BrowserChrome({ width, height, url, children, dark }) {
  const barBg = dark ? "#202124" : "#E8E6DF";
  const tabBg = dark ? "#35363A" : "#F6F4EF";
  const text = dark ? "#E8EAED" : "#3C3A35";
  const urlBg = dark ? "#282A2D" : "#F6F4EF";
  const border = dark ? "#3A3C40" : "#D7D4CE";
  return (
    <div style={{
      width, height, borderRadius: 12, overflow: "hidden",
      boxShadow: "0 0 0 1px rgba(0,0,0,0.10), 0 24px 60px rgba(0,0,0,0.18)",
      display: "flex", flexDirection: "column",
      fontFamily: 'system-ui, -apple-system, sans-serif', background: "#fff",
    }}>
      <div style={{ background: barBg, padding: "10px 12px 0", borderBottom: `1px solid ${border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 12, height: 12, borderRadius: 50, background: "#ff5f57" }} />
          <span style={{ width: 12, height: 12, borderRadius: 50, background: "#febc2e" }} />
          <span style={{ width: 12, height: 12, borderRadius: 50, background: "#28c840" }} />
          <div style={{
            marginLeft: 8, padding: "6px 14px", background: tabBg, color: text,
            fontSize: 12, borderRadius: "8px 8px 0 0", display: "flex", alignItems: "center", gap: 6,
          }}>
            <span style={{ width: 12, height: 12, borderRadius: 50, background: "var(--accent)" }} />
            <span>bkemo · {url.split("/").pop() || "home"}</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px 8px" }}>
          <span style={{ color: text, opacity: 0.6, fontSize: 16 }}>←</span>
          <span style={{ color: text, opacity: 0.6, fontSize: 16 }}>→</span>
          <span style={{ color: text, opacity: 0.6, fontSize: 14 }}>↻</span>
          <div style={{
            flex: 1, background: urlBg, color: text, fontSize: 12,
            padding: "5px 12px", borderRadius: 14, display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ opacity: 0.6 }}>🔒</span>
            <span>{url}</span>
          </div>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>{children}</div>
    </div>
  );
}

// ─── Tweak defaults ───
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#5E6AD2",
  "density": "regular"
}/*EDITMODE-END*/;
const ACCENT_OPTIONS = [
  "#5E6AD2", "#D97757", "#1F8A5B", "#E2497F", "#0F62FE", "#222222",
];

// ─── App ───
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  useEffect(() => {
    document.documentElement.style.setProperty("--accent", t.accent);
  }, [t.accent]);

  return (
    <DesignCanvas>
      <DCSection
        id="intro"
        title="bkemo · Direction D (Mix)"
        subtitle="Linear-dense memo stream. Every memo is a note and a task. Sidebar: Notes · Todos · Projects. Stats, Calendar and Settings live behind the bkemo ▾ workspace dropdown at the top-left of the sidebar. Click the workspace name in the artboard below to open it."
      >
        <DCArtboard id="brief" label="What's in here" width={1240} height={300}>
          <Brief />
        </DCArtboard>
      </DCSection>

      <DCSection
        id="d-live"
        title="Live · click anywhere in the sidebar"
        subtitle="Fully interactive: nav clicks swap the page, workspace dropdown opens Stats / Calendar / Settings, Todos has filter tabs, Matrix is drag-aware."
      >
        <DCArtboard id="live-web" label="Web · interactive" width={1240} height={820}>
          <BrowserChrome width={1240} height={820} url="bk.hax429.me/home" dark>
            <Mix.Web density={t.density} />
          </BrowserChrome>
        </DCArtboard>
      </DCSection>

      <DCSection
        id="d-notes"
        title="Notes"
        subtitle="Home (stream), Daily review, Random, Trash."
      >
        <DCArtboard id="p-home" label="Home · stream" width={1240} height={800}>
          <BrowserChrome width={1240} height={800} url="bk.hax429.me/home" dark>
            <Mix.Web density={t.density} initialRoute="home" />
          </BrowserChrome>
        </DCArtboard>
        <DCArtboard id="p-daily" label="Daily review (tasks + on-this-day)" width={1240} height={820}>
          <BrowserChrome width={1240} height={820} url="bk.hax429.me/daily" dark>
            <Mix.Web density={t.density} initialRoute="daily" />
          </BrowserChrome>
        </DCArtboard>
        <DCArtboard id="p-random" label="Random · re-roll" width={1240} height={800}>
          <BrowserChrome width={1240} height={800} url="bk.hax429.me/random" dark>
            <Mix.Web density={t.density} initialRoute="random" />
          </BrowserChrome>
        </DCArtboard>
        <DCArtboard id="p-trash" label="Trash · retention" width={1240} height={800}>
          <BrowserChrome width={1240} height={800} url="bk.hax429.me/trash" dark>
            <Mix.Web density={t.density} initialRoute="trash" />
          </BrowserChrome>
        </DCArtboard>
      </DCSection>

      <DCSection
        id="d-todos"
        title="Todos"
        subtitle="Inbox / Today / Tomorrow / This week · plus Eisenhower Matrix view. Tasks render with importance + urgency dots."
      >
        <DCArtboard id="p-inbox" label="Todos · Inbox" width={1240} height={820}>
          <BrowserChrome width={1240} height={820} url="bk.hax429.me/todos/inbox" dark>
            <Mix.Web density={t.density} initialRoute="inbox" />
          </BrowserChrome>
        </DCArtboard>
        <DCArtboard id="p-today" label="Todos · Today" width={1240} height={820}>
          <BrowserChrome width={1240} height={820} url="bk.hax429.me/todos/today" dark>
            <Mix.Web density={t.density} initialRoute="today" />
          </BrowserChrome>
        </DCArtboard>
        <DCArtboard id="p-matrix" label="Todos · Eisenhower Matrix" width={1240} height={860}>
          <BrowserChrome width={1240} height={860} url="bk.hax429.me/todos/matrix" dark>
            <Mix.Web density={t.density} initialRoute="matrix" />
          </BrowserChrome>
        </DCArtboard>
      </DCSection>

      <DCSection
        id="d-workspace"
        title="Workspace menu · Stats / Calendar / Settings"
        subtitle="These three live behind the bkemo ▾ dropdown in the sidebar — not as sidebar nav items. Each opens a full page."
      >
        <DCArtboard id="p-stats" label="Stats · 12-week heatmap + charts" width={1240} height={840}>
          <BrowserChrome width={1240} height={840} url="bk.hax429.me/stats" dark>
            <Mix.Web density={t.density} initialRoute="stats" />
          </BrowserChrome>
        </DCArtboard>
        <DCArtboard id="p-calendar" label="Calendar · May 2026 (memos + tasks by day)" width={1240} height={880}>
          <BrowserChrome width={1240} height={880} url="bk.hax429.me/calendar" dark>
            <Mix.Web density={t.density} initialRoute="calendar" />
          </BrowserChrome>
        </DCArtboard>
        <DCArtboard id="p-settings-appear" label="Settings · Appearance" width={1240} height={840}>
          <BrowserChrome width={1240} height={840} url="bk.hax429.me/settings/appearance" dark>
            <Mix.Web density={t.density} initialRoute="settings" initialSettingsSection="appear" />
          </BrowserChrome>
        </DCArtboard>
        <DCArtboard id="p-settings-ai" label="Settings · AI providers" width={1240} height={840}>
          <BrowserChrome width={1240} height={840} url="bk.hax429.me/settings/ai" dark>
            <Mix.Web density={t.density} initialRoute="settings" initialSettingsSection="ai" />
          </BrowserChrome>
        </DCArtboard>
      </DCSection>

      <Tweaks t={t} setTweak={setTweak} />
    </DesignCanvas>
  );
}

function Brief() {
  return (
    <div style={{
      width: "100%", height: "100%", padding: "26px 36px", background: "#0B0C10",
      color: "#E8EAED", fontFamily: "Inter, system-ui, sans-serif",
      display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16,
    }}>
      <BriefCard label="Soul" body="Every memo is a note AND a task. Same record. Triage by giving it a due date, importance or urgency." />
      <BriefCard label="Sidebar" body="Notes · Todos · Projects. Three sections, kept simple. Stats, Calendar and Settings live in the workspace dropdown." />
      <BriefCard label="Todos" body="Inbox, Today, Tomorrow, This week, Matrix. Eisenhower 2×2 grid sorts by Important × Urgent." />
      <BriefCard label="Calendar" body="Full month grid. Memos + tasks plotted on the day created, color-coded per project (tag)." />
    </div>
  );
}

function BriefCard({ label, body }) {
  return (
    <div style={{
      background: "#10131A", border: "1px solid #23252A",
      borderRadius: 8, padding: "16px 18px",
    }}>
      <div style={{
        fontFamily: "JetBrains Mono, monospace", fontSize: 10,
        letterSpacing: ".12em", color: "#8A8F98", textTransform: "uppercase",
      }}>{label}</div>
      <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.55, color: "#E8EAED" }}>{body}</div>
    </div>
  );
}

function Tweaks({ t, setTweak }) {
  return (
    <TweaksPanel>
      <TweakSection label="Theme" />
      <TweakColor label="Accent" value={t.accent} options={ACCENT_OPTIONS}
                  onChange={v => setTweak("accent", v)} />
      <TweakSection label="Feed" />
      <TweakRadio  label="Density" value={t.density}
                   options={["compact", "regular", "comfy"]}
                   onChange={v => setTweak("density", v)} />
    </TweaksPanel>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
