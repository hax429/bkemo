export const WEEKLY_KNOWLEDGE_TIMEZONE = "America/New_York";
export const WEEKLY_KNOWLEDGE_SCHEMA = "bkemo_weekly_knowledge_v1";
export const WEEKLY_KNOWLEDGE_EXCLUDE_TAG = "exclude_from_ai";

export type WeeklyKnowledgeRange = {
  start: Date;
  end: Date;
  startDate: string;
  endDate: string;
  timezone: string;
};

export type WeeklyKnowledgeNote = {
  portableId: string;
  type: number;
  content: string;
  isArchived: boolean;
  isTop: boolean;
  isImportant: boolean;
  isUrgent: boolean;
  createdAt: Date;
  updatedAt: Date;
  dueDate: Date | null;
  completedAt: Date | null;
  tags: string[];
  attachments: Array<{ name: string; type: string; size: string }>;
};

type CivilDate = { year: number; month: number; day: number };

function zonedParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function timezoneOffsetAt(date: Date, timezone: string): number {
  const parts = zonedParts(date, timezone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return representedAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function zonedMidnightToUtc(civil: CivilDate, timezone: string): Date {
  const target = Date.UTC(civil.year, civil.month - 1, civil.day, 0, 0, 0);
  let instant = target;
  for (let index = 0; index < 4; index += 1) {
    instant = target - timezoneOffsetAt(new Date(instant), timezone);
  }
  return new Date(instant);
}

function addCivilDays(civil: CivilDate, days: number): CivilDate {
  const date = new Date(
    Date.UTC(civil.year, civil.month - 1, civil.day + days),
  );
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function formatCivilDate(civil: CivilDate): string {
  return `${civil.year.toString().padStart(4, "0")}_${civil.month.toString().padStart(2, "0")}_${civil.day.toString().padStart(2, "0")}`;
}

export function previousCompletedWeek(
  now = new Date(),
  timezone = WEEKLY_KNOWLEDGE_TIMEZONE,
): WeeklyKnowledgeRange {
  const local = zonedParts(now, timezone);
  const today = { year: local.year, month: local.month, day: local.day };
  const weekday = new Date(
    Date.UTC(today.year, today.month - 1, today.day),
  ).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  const currentMonday = addCivilDays(today, -daysSinceMonday);
  const previousMonday = addCivilDays(currentMonday, -7);
  return {
    start: zonedMidnightToUtc(previousMonday, timezone),
    end: zonedMidnightToUtc(currentMonday, timezone),
    startDate: formatCivilDate(previousMonday),
    endDate: formatCivilDate(currentMonday),
    timezone,
  };
}

function yamlValue(value: unknown): string {
  return JSON.stringify(value);
}

function noteType(type: number): string {
  if (type === 1) return "note";
  if (type === 2) return "task";
  return "memo";
}

function noteStatus(note: WeeklyKnowledgeNote): string {
  if (note.type !== 2) return note.isArchived ? "archived" : "active";
  if (note.completedAt) return "completed";
  return note.isArchived ? "archived" : "open";
}

function noteTitle(note: WeeklyKnowledgeNote): string {
  const first = note.content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !/^```/.test(line));
  const cleaned = first
    ?.replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+(?:\[[ xX]\]\s*)?/, "")
    .replace(/^>\s*/, "")
    .trim();
  return (cleaned || `Untitled memo ${note.portableId.slice(0, 8)}`).slice(
    0,
    140,
  );
}

function noteSection(note: WeeklyKnowledgeNote): string {
  const fields: Array<[string, unknown]> = [
    ["source", `bkemo://note/${note.portableId}`],
    ["portable_id", note.portableId],
    ["type", noteType(note.type)],
    ["status", noteStatus(note)],
    ["created_at", note.createdAt.toISOString()],
    ["updated_at", note.updatedAt.toISOString()],
    ["due_date", note.dueDate?.toISOString() ?? null],
    ["completed_at", note.completedAt?.toISOString() ?? null],
    ["important", note.isImportant],
    ["urgent", note.isUrgent],
    ["pinned", note.isTop],
    ["archived", note.isArchived],
    ["tags", note.tags],
    ["attachments", note.attachments],
  ];
  const metadata = fields
    .map(([key, value]) => `${key}: ${yamlValue(value)}`)
    .join("\n");
  const content = note.content.trim() || "_Empty note_";
  return `## ${noteTitle(note)}\n\n${metadata}\n\n### Content\n\n${content}`;
}

export function weeklyKnowledgeFilename(range: WeeklyKnowledgeRange): string {
  return `bkemo_week_${range.startDate}_to_${range.endDate}.md`;
}

export function buildWeeklyKnowledgeMarkdown(
  range: WeeklyKnowledgeRange,
  notes: WeeklyKnowledgeNote[],
  generatedAt = new Date(),
): string {
  const ordered = [...notes].sort((left, right) => {
    const byCreated = left.createdAt.getTime() - right.createdAt.getTime();
    return byCreated || left.portableId.localeCompare(right.portableId);
  });
  const frontmatter: Array<[string, unknown]> = [
    ["schema", WEEKLY_KNOWLEDGE_SCHEMA],
    ["source", "bkemo"],
    ["owner_scope", "configured_superadmin"],
    ["week_start", range.startDate.replaceAll("_", "-")],
    ["week_end_exclusive", range.endDate.replaceAll("_", "-")],
    ["timezone", range.timezone],
    ["generated_at", generatedAt.toISOString()],
    ["note_count", ordered.length],
  ];
  const header = frontmatter
    .map(([key, value]) => `${key}: ${yamlValue(value)}`)
    .join("\n");
  const body = ordered.map(noteSection).join("\n\n---\n\n");
  return `---\n${header}\n---\n\n# Weekly bkemo knowledge export\n\n${body}\n`;
}
