import { describe, expect, test } from "vitest";
import {
  buildWeeklyKnowledgeMarkdown,
  previousCompletedWeek,
  weeklyKnowledgeFilename,
  type WeeklyKnowledgeNote,
} from "../../../lib/weeklyKnowledgeMarkdown";

function note(
  overrides: Partial<WeeklyKnowledgeNote> = {},
): WeeklyKnowledgeNote {
  return {
    portableId: "11111111-1111-4111-8111-111111111111",
    type: 0,
    content: "# First memo\nBody text",
    isArchived: false,
    isTop: false,
    isImportant: true,
    isUrgent: false,
    createdAt: new Date("2026-07-21T14:00:00.000Z"),
    updatedAt: new Date("2026-07-22T14:00:00.000Z"),
    dueDate: null,
    completedAt: null,
    tags: ["work"],
    attachments: [{ name: "plan.pdf", type: "application/pdf", size: "42" }],
    ...overrides,
  };
}

describe("weekly knowledge Markdown", () => {
  test("uses the previous completed New York week", () => {
    const range = previousCompletedWeek(new Date("2026-08-01T12:00:00.000Z"));
    expect(range.start.toISOString()).toBe("2026-07-20T04:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-07-27T04:00:00.000Z");
    expect(weeklyKnowledgeFilename(range)).toBe(
      "bkemo_week_2026_07_20_to_2026_07_27.md",
    );
  });

  test("preserves daylight saving boundaries", () => {
    const range = previousCompletedWeek(new Date("2026-03-09T12:00:00.000Z"));
    expect(range.start.toISOString()).toBe("2026-03-02T05:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });

  test("emits deterministic document and note metadata without account data", () => {
    const range = previousCompletedWeek(new Date("2026-08-01T12:00:00.000Z"));
    const later = note({
      portableId: "22222222-2222-4222-8222-222222222222",
      content: "- [ ] Later task",
      type: 2,
      createdAt: new Date("2026-07-22T14:00:00.000Z"),
    });
    const markdown = buildWeeklyKnowledgeMarkdown(
      range,
      [later, note()],
      new Date("2026-08-01T12:30:00.000Z"),
    );
    expect(markdown).toContain('schema: "bkemo_weekly_knowledge_v1"');
    expect(markdown).toContain('owner_scope: "configured_superadmin"');
    expect(markdown).toContain("note_count: 2");
    expect(markdown).toContain(
      'source: "bkemo://note/11111111-1111-4111-8111-111111111111"',
    );
    expect(markdown).toContain(
      'attachments: [{"name":"plan.pdf","type":"application/pdf","size":"42"}]',
    );
    expect(markdown.indexOf("## First memo")).toBeLessThan(
      markdown.indexOf("## Later task"),
    );
    expect(markdown).not.toMatch(/account_id|sharePassword|sourceId/);
  });
});
