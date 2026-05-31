// Shared data — every memo is also potentially a task (note + todo are one record)
window.BKEMO_DATA = {
  user: { name: "Kevin", initials: "KH", handle: "@hax429" },

  // Sectioned nav for Mix sidebar. Stats/Calendar/Settings live in the
  // workspace dropdown (top-left), NOT in the sidebar nav.
  notesNav: [
    { id: "home",   icon: "✦", title: "Home",         count: 384, active: true },
    { id: "daily",  icon: "☉", title: "Daily review", count: 5 },
    { id: "random", icon: "↻", title: "Random",       count: null },
    { id: "trash",  icon: "⌫", title: "Trash",        count: 2 },
  ],
  todosNav: [
    { id: "inbox",    icon: "▤", title: "Inbox",     count: 4 },
    { id: "today",    icon: "●", title: "Today",     count: 3 },
    { id: "tomorrow", icon: "○", title: "Tomorrow",  count: 1 },
    { id: "week",     icon: "▦", title: "This week", count: 5 },
    { id: "matrix",   icon: "⊞", title: "Matrix",    count: null },
  ],
  // The workspace dropdown items
  workspaceMenu: [
    { id: "stats",    icon: "▩", title: "Stats",    kbd: "G S" },
    { id: "calendar", icon: "▤", title: "Calendar", kbd: "G C" },
    { id: "settings", icon: "⚙", title: "Settings", kbd: "⌘," },
  ],
  // Back-compat flat nav for Sidekick/Issue/Quartz (other directions)
  nav: [
    { id: "home",   icon: "✦", title: "Home",         count: 384, active: true },
    { id: "daily",  icon: "☉", title: "Daily review", count: 7 },
    { id: "random", icon: "↻", title: "Random",       count: null },
    { id: "trash",  icon: "⌫", title: "Trash",        count: 2 },
    { id: "stats",  icon: "▩", title: "Stats",        count: null },
  ],

  // Tags double as Projects. Same tree.
  tagTree: [
    { id: "ios",    title: "ios",    count: 41, expanded: true, children: [
      { id: "ios/bug",     title: "bug",     count: 8 },
      { id: "ios/tauri",   title: "tauri",   count: 14 },
      { id: "ios/ota",     title: "ota",     count: 4 },
    ]},
    { id: "server", title: "server", count: 23, children: [
      { id: "server/deploy", title: "deploy", count: 6 },
    ]},
    { id: "ai",     title: "ai",     count: 18, expanded: true, children: [
      { id: "ai/idea", title: "idea", count: 12 },
    ]},
    { id: "daily",  title: "daily",  count: 156 },
    { id: "read",   title: "read",   count: 28 },
    { id: "log",    title: "log",    count: 19 },
  ],

  // Memos. Any memo with task:true is also a todo. important/urgent power Eisenhower.
  // due values used: "today", "tomorrow", "this week", "next week", "no date".
  memos: [
    {
      id: "BK-190", ts: "8 min", hour: "23:52", day: "today",
      body: "Renew bk.hax429.me — expires June 12. Cloudflare account, autorenew is off. #server",
      task: true, done: false, due: "today", important: false, urgent: true,
    },
    {
      id: "BK-189", ts: "14 min", hour: "23:46", day: "today",
      body: "Reply to Will's TestFlight feedback on Phase 8 OTA — he flagged the manifest race condition. #ios #ota",
      task: true, done: false, due: "today", important: true, urgent: true,
    },
    {
      id: "BK-188", ts: "32 min", hour: "23:28", day: "today",
      body: "Write the OTA rollback doc. Keep N-1 bundle on disk, swap manifest atomically. #ios #tauri",
      task: true, done: false, due: "tomorrow", important: true, urgent: false,
    },
    {
      id: "BK-187", ts: "1 h", hour: "22:48", day: "today",
      body: "Look into pgvector instead of @mastra/rag for embeddings — fewer moving parts on prod. #ai #server",
      task: true, done: false, due: "this week", important: true, urgent: false,
    },
    {
      id: "BK-186", ts: "2 h", hour: "21:34", day: "today",
      body: "Try Linear's open-source eslint config. Might not be worth the diff. #idea",
      task: true, done: false, due: "no date", important: false, urgent: false,
    },
    {
      id: "BK-185", ts: "3 h", hour: "20:42", day: "today",
      body: "Move daily notes to a partitioned db table — 156 #daily memos is making the index hot. #server",
      task: true, done: false, due: "this week", important: true, urgent: false,
    },
    {
      id: "BK-184", ts: "12 min", hour: "23:48", day: "today",
      body: "Phase 8 OTA shipped to TestFlight. bundle://localhost via a Tauri protocol handler, AppData/app-bundle/{manifest.json, bundle-<ver>.zip}. Cold-launch with no network finally works. #ios #tauri #ota",
      pinned: true,
    },
    {
      id: "BK-183", ts: "1 h", hour: "22:34", day: "today",
      body: "Idea: AI-assisted note refile. Use the existing @mastra/rag pipeline — top-1 cosine sim above 0.78 → auto-tag suggestion on save. Cheap to ship. #ai #idea",
    },
    {
      id: "BK-182", ts: "3 h", hour: "20:11", day: "today",
      body: "Debounce the visualViewport resize handler at 60ms so the editor stops jumping when the keyboard suggestion bar collapses. #ios #bug",
      task: true, done: false, due: "today", important: true, urgent: true,
    },
    {
      id: "BK-181", ts: "5 h", hour: "18:02", day: "today",
      body: "Coffee → OTA design → fixed BK-181 → ate at the new ramen place on 23rd. Good day. #daily",
    },
    {
      id: "BK-180", ts: "yesterday", hour: "21:40", day: "yesterday",
      body: "Test iOS cold launch on cellular after the new VM migration. #ios #server #deploy",
      task: true, done: false, due: "tomorrow", important: true, urgent: false,
    },
    {
      id: "BK-179", ts: "yesterday", hour: "14:08", day: "yesterday",
      body: "Trim the unused passport strategies — single-tenant means I only need local + GitHub OAuth. Saved ~140kb in the server bundle. #server",
      task: true, done: true, important: false, urgent: false,
    },
    {
      id: "BK-178", ts: "yesterday", hour: "09:21", day: "yesterday",
      body: "Bundle id rename complete. me.hax429.bk live in App Store Connect. Sandbox push works. Production push tested. #ios",
    },
    {
      id: "BK-177", ts: "2 d", hour: "23:14", day: "2 d ago",
      body: "Reading: \"build for one user\". Notion's first six months ran on one designer's intuition. I should stop apologizing for bkemo being for me. #read #idea",
    },
    {
      id: "BK-176", ts: "2 d", hour: "20:55", day: "2 d ago",
      body: "What if I dropped comment threads in favor of replies-only? Would simplify the schema a lot. #idea",
    },
    {
      id: "BK-175", ts: "3 d", hour: "11:30", day: "3 d ago",
      body: "Update the tauri-plugin-blinko call sites — v2's `invoke` is now plugin-prefixed. #tauri",
      task: true, done: false, due: "this week", important: true, urgent: false,
    },
    {
      id: "BK-174", ts: "3 d", hour: "08:10", day: "3 d ago",
      body: "Backup: rsync to b2 nightly via cron. Encrypted at rest. ~$2/mo. Tested restore last weekend. #server",
    },
    {
      id: "BK-173", ts: "4 d", hour: "16:44", day: "4 d ago",
      body: "Vditor's `/` slash menu doesn't render on iOS WKWebView because of a `pointerdown` listener fight. Workaround: long-press. #ios #bug",
    },
  ],

  throwback: {
    id: "BK-068",
    when: "1 year ago · May 28, 2025",
    body: "Started writing the blinko fork. The plan: rip out everything that isn't for me. Aim for a one-screen app I open 30 times a day.",
    tags: ["#log"],
  },

  // 12 weeks × 7 days heatmap
  heatmap: (() => {
    const r = [];
    let seed = 7;
    for (let i = 0; i < 12 * 7; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      const v = (seed / 233280);
      const intensity = v < 0.18 ? 0 : v < 0.45 ? 1 : v < 0.78 ? 2 : v < 0.95 ? 3 : 4;
      r.push(intensity);
    }
    r[r.length - 1] = 4;
    r[r.length - 2] = 3;
    return r;
  })(),

  // Calendar — current month. May 2026.
  // activity[day-1] = 0..3 (intensity). hasTask[day-1] = boolean.
  calendar: {
    year: 2026, month: 4, // 0-indexed: 4 = May
    monthLabel: "May 2026",
    today: 28,
    // 31 days
    activity: [
      1,2,0,3,2,1,0,
      2,3,1,0,2,1,3,
      2,0,1,2,3,2,1,
      0,2,3,1,2,3,4,
      0,0,0,
    ],
    hasTask: [
      false,true,false,true,false,false,false,
      false,true,false,false,true,false,true,
      false,false,false,true,false,true,false,
      false,true,true,false,true,false,true,
      true,true,false, // tomorrow=29 has a task
    ],
    // first day of month is a Friday (index 5; Mon=0..Sun=6) in May 2026 — adjust grid offset
    firstDayOffset: 4, // 0 = Mon... let's say May 1 2026 is a Friday => offset 4
  },
};

// Helper: render a memo body with inline tag highlighting.
window.BKEMO_RENDER = function renderMemoBody(body, tagStyle) {
  const parts = [];
  const re = /(#[a-zA-Z0-9_\/-]+)/g;
  let last = 0, m, i = 0;
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) parts.push(body.slice(last, m.index));
    parts.push(React.createElement("span", { key: "t" + (i++), style: tagStyle }, m[0]));
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return parts;
};

// Helper: bucket tasks by Eisenhower quadrant.
window.BKEMO_QUADRANTS = function quadrants() {
  const tasks = window.BKEMO_DATA.memos.filter(m => m.task && !m.done);
  return {
    do:        tasks.filter(t => t.important && t.urgent),
    schedule:  tasks.filter(t => t.important && !t.urgent),
    delegate:  tasks.filter(t => !t.important && t.urgent),
    eliminate: tasks.filter(t => !t.important && !t.urgent),
  };
};

// ── Tag colors (used by calendar + future tag chips) ──
window.BKEMO_TAG_COLOR = function tagColor(tag) {
  const key = (tag || "").replace(/^#/, "").split("/")[0];
  const map = {
    ios:    "#5E6AD2", // indigo
    ai:     "#A45EE0", // purple
    server: "#5BD0A6", // green
    tauri:  "#5BB6D0", // cyan
    daily:  "#E0A85E", // amber
    read:   "#9B9690", // gray
    idea:   "#E07AA8", // pink
    bug:    "#E06868", // red
    log:    "#A8855E", // brown
    deploy: "#5BD08B", // green2
    ota:    "#7A9AD0", // muted blue
  };
  return map[key] || "#7A8AA8";
};

// ── Calendar events. Distributed across May 2026 plus a few neighbor days.
//    Each event: { day, month?, hour, title, tag, kind: 'memo'|'task', done? }
window.BKEMO_CALENDAR_EVENTS = [
  // late-April trailing
  { day: 28, month: 3, hour: "15:02", title: "Old VM cert renewal", tag: "server", kind: "task", done: true },
  { day: 29, month: 3, hour: "22:11", title: "Phase 7 retro",       tag: "log",    kind: "memo" },
  { day: 30, month: 3, hour: "08:14", title: "AM walk · clear head", tag: "daily",  kind: "memo" },

  // May 1
  { day: 1, hour: "10:14", title: "Tauri build flags experiment",  tag: "tauri",  kind: "memo" },
  { day: 1, hour: "14:30", title: "Renew Apple dev cert",          tag: "ios",    kind: "task", done: true },
  { day: 1, hour: "21:48", title: "Coffee + Notion playbook",      tag: "read",   kind: "memo" },
  // May 2
  { day: 2, hour: "09:22", title: "Ramen, 23rd St.",                tag: "daily",  kind: "memo" },
  // May 4
  { day: 4, hour: "09:11", title: "Replies-only schema sketch",     tag: "idea",   kind: "memo" },
  { day: 4, hour: "11:30", title: "Audit Vditor plugin list",       tag: "ios",    kind: "task", done: true },
  { day: 4, hour: "16:42", title: "WKWebView pointerdown fight",    tag: "bug",    kind: "memo" },
  { day: 4, hour: "20:55", title: "Daily",                          tag: "daily",  kind: "memo" },
  // May 5
  { day: 5, hour: "08:42", title: "Nightly rsync verified",         tag: "server", kind: "memo" },
  { day: 5, hour: "19:08", title: "Reading 'Build for one user'",   tag: "read",   kind: "memo" },
  // May 7
  { day: 7, hour: "10:12", title: "Migrate VM to Hetzner",          tag: "server", kind: "task", done: true },
  { day: 7, hour: "15:50", title: "VoiceOver pass for memo cards",  tag: "ios",    kind: "task", done: true },
  { day: 7, hour: "22:08", title: "Daily",                          tag: "daily",  kind: "memo" },
  // May 9
  { day: 9, hour: "11:34", title: "Test voyage-3-lite embeddings",  tag: "ai",     kind: "task", done: true },
  // May 12
  { day: 12, hour: "09:21", title: "Bundle id rename complete",     tag: "ios",    kind: "memo" },
  { day: 12, hour: "12:42", title: "AP cert sandbox push works",    tag: "ios",    kind: "memo" },
  { day: 12, hour: "17:18", title: "Refile threshold A/B notes",    tag: "ai",     kind: "memo" },
  { day: 12, hour: "20:05", title: "Daily",                         tag: "daily",  kind: "memo" },
  // May 14
  { day: 14, hour: "10:55", title: "Vditor / slash menu workaround", tag: "bug",   kind: "memo" },
  { day: 14, hour: "21:30", title: "Daily",                         tag: "daily",  kind: "memo" },
  // May 18
  { day: 18, hour: "09:48", title: "iOS 17 visualViewport regression", tag: "ios", kind: "memo" },
  { day: 18, hour: "14:30", title: "Linear eng principles read",    tag: "read",   kind: "memo" },
  { day: 18, hour: "22:14", title: "Daily",                         tag: "daily",  kind: "memo" },
  // May 19
  { day: 19, hour: "08:08", title: "Prisma migrate dry-run",        tag: "server", kind: "memo" },
  { day: 19, hour: "10:30", title: "Tauri v2 invoke migration",     tag: "tauri",  kind: "task", done: true },
  { day: 19, hour: "13:18", title: "Refactor BlinkoCard masonry",   tag: "ios",    kind: "memo" },
  { day: 19, hour: "16:42", title: "Memo grouping idea",            tag: "idea",   kind: "memo" },
  { day: 19, hour: "22:50", title: "Daily",                         tag: "daily",  kind: "memo" },
  // May 21
  { day: 21, hour: "09:12", title: "Test cellular cold launch",     tag: "ios",    kind: "task", done: true },
  { day: 21, hour: "11:40", title: "Drop comment threads idea",     tag: "idea",   kind: "memo" },
  { day: 21, hour: "15:05", title: "systemd unit hardening",        tag: "server", kind: "memo" },
  { day: 21, hour: "21:18", title: "Daily",                         tag: "daily",  kind: "memo" },
  // May 22
  { day: 22, hour: "19:40", title: "Backup audit",                   tag: "server", kind: "task", done: true },
  // May 24
  { day: 24, hour: "08:55", title: "Sunday quiet",                   tag: "daily",  kind: "memo" },
  // May 25
  { day: 25, hour: "09:30", title: "Phase 8 design start",           tag: "ota",    kind: "memo" },
  { day: 25, hour: "22:11", title: "Daily",                          tag: "daily",  kind: "memo" },
  // May 26
  { day: 26, hour: "10:14", title: "OTA bundle pipeline draft",      tag: "ota",    kind: "memo" },
  { day: 26, hour: "14:45", title: "Manifest atomic swap notes",     tag: "tauri",  kind: "memo" },
  // May 27
  { day: 27, hour: "08:10", title: "rsync b2 nightly tested",        tag: "server", kind: "memo" },
  { day: 27, hour: "11:30", title: "Update tauri-plugin-blinko sites", tag: "tauri", kind: "task", done: false },
  { day: 27, hour: "15:12", title: "Build-for-one-user reread",      tag: "read",   kind: "memo" },
  { day: 27, hour: "22:01", title: "Daily",                          tag: "daily",  kind: "memo" },
  // May 28 — today (heavy day)
  { day: 28, hour: "09:21", title: "Bundle id rename complete",      tag: "ios",    kind: "memo" },
  { day: 28, hour: "14:08", title: "Trim passport strategies",       tag: "server", kind: "task", done: true },
  { day: 28, hour: "18:02", title: "Coffee → OTA → BK-181 → ramen",   tag: "daily",  kind: "memo" },
  { day: 28, hour: "20:11", title: "Debounce viewport resize 60ms",  tag: "bug",    kind: "task", done: false },
  { day: 28, hour: "20:42", title: "Move daily notes to partition",  tag: "server", kind: "task", done: false },
  { day: 28, hour: "21:34", title: "Reply to Will TestFlight",       tag: "ios",    kind: "task", done: false },
  { day: 28, hour: "22:34", title: "AI-assist refile idea",          tag: "ai",     kind: "memo" },
  { day: 28, hour: "23:46", title: "Renew bk.hax429.me",             tag: "server", kind: "task", done: false },
  { day: 28, hour: "23:48", title: "Phase 8 OTA shipped to TestFlight", tag: "ota", kind: "memo" },
  // May 29 — tomorrow (tasks only)
  { day: 29, hour: "—",     title: "Write OTA rollback doc",          tag: "tauri",  kind: "task", done: false },
  { day: 29, hour: "—",     title: "Test iOS cold launch on cellular", tag: "ios",   kind: "task", done: false },
];
