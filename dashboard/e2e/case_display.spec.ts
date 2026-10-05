import { expect, test } from "@playwright/test";

import { ACTOR_STORAGE_KEY, DEFAULT_ACTOR_NAME, sanitizeActorName } from "../lib/actorName";
import { VERDICT_HELP, VERDICT_ORDER, eventSentence, statusLabel, verdictLabel } from "../lib/caseDisplay";

const ev = (type: string, data: Record<string, unknown> = {}, actor = "Priya") => ({
  id: "evt-2",
  time: "2026-10-04T10:00:00.000Z",
  actor,
  type,
  data,
});

test.describe("caseDisplay: labels", () => {
  test("status labels", () => {
    expect(statusLabel("open")).toBe("Open");
    expect(statusLabel("investigating")).toBe("Investigating");
    expect(statusLabel("resolved")).toBe("Resolved");
    expect(statusLabel("on_hold")).toBe("On hold");
    expect(statusLabel(undefined)).toBe("Unknown");
    expect(statusLabel(5)).toBe("Unknown");
  });

  test("verdict labels", () => {
    expect(verdictLabel("true_positive")).toBe("True positive");
    expect(verdictLabel("false_positive")).toBe("False positive");
    expect(verdictLabel("benign_activity")).toBe("Benign activity");
    expect(verdictLabel("undetermined")).toBe("Undetermined");
    expect(verdictLabel("something_else")).toBe("Something else");
    expect(verdictLabel(null)).toBe("Unknown");
  });

  test("every verdict has one short help sentence and no em dash", () => {
    expect([...VERDICT_ORDER]).toEqual(["true_positive", "false_positive", "benign_activity", "undetermined"]);
    for (const v of VERDICT_ORDER) {
      const help = VERDICT_HELP[v];
      expect(help, v).toBeTruthy();
      expect(help.length, v).toBeLessThanOrEqual(80);
      expect(help.endsWith("."), v).toBe(true);
      expect(help).not.toContain("—");
    }
  });
});

test.describe("eventSentence", () => {
  test("created", () => {
    expect(eventSentence(ev("created", {}))).toBe("Case opened");
  });

  test("status changes", () => {
    expect(eventSentence(ev("status_changed", { from: "open", to: "investigating" }))).toBe(
      "Priya changed the status from Open to Investigating",
    );
    expect(eventSentence(ev("status_changed", { from: "investigating", to: "open" }, "Analyst"))).toBe(
      "Analyst changed the status from Investigating to Open",
    );
  });

  test("assignment: assigned, unassigned and reassigned", () => {
    expect(eventSentence(ev("assignee_changed", { from: null, to: "Analyst 1" }))).toBe("Priya assigned this to Analyst 1");
    expect(eventSentence(ev("assignee_changed", { from: "Analyst 1", to: null }))).toBe("Priya unassigned this");
    expect(eventSentence(ev("assignee_changed", { from: "Analyst 1", to: "Analyst 2" }))).toBe(
      "Priya reassigned this from Analyst 1 to Analyst 2",
    );
  });

  test("notes, resolution and reopening", () => {
    expect(eventSentence(ev("note_added", { text: "looked at it" }))).toBe("Priya added a note");
    expect(eventSentence(ev("resolved", { verdict: "false_positive", note: "x" }))).toBe(
      "Priya resolved this as false positive",
    );
    expect(eventSentence(ev("resolved", { verdict: "true_positive", note: null }))).toBe(
      "Priya resolved this as true positive",
    );
    expect(eventSentence(ev("reopened", {}))).toBe("Priya reopened this case");
  });

  test("the actor name is used as plain text", () => {
    expect(eventSentence(ev("note_added", {}, "<b>Mallory</b>"))).toBe("<b>Mallory</b> added a note");
  });

  test("unknown or malformed events never throw", () => {
    const odd: unknown[] = [
      ev("something_new", {}),
      ev("status_changed", {}),
      ev("status_changed", { from: "open" }),
      ev("assignee_changed", {}),
      ev("assignee_changed", { from: null, to: null }),
      ev("resolved", {}),
      { type: "note_added" },
      { actor: "A" },
      { actor: 5, type: 7, data: "x" },
      { type: "status_changed", actor: "A", data: null },
      {},
      null,
      undefined,
      "text",
      42,
      [],
    ];
    for (const e of odd) {
      let sentence = "";
      expect(() => {
        sentence = eventSentence(e);
      }).not.toThrow();
      expect(typeof sentence).toBe("string");
      expect(sentence.length).toBeGreaterThan(0);
    }
    expect(eventSentence(ev("something_new", {}))).toBe("Priya updated this case");
    expect(eventSentence(ev("status_changed", {}))).toBe("Priya updated this case");
    expect(eventSentence(ev("assignee_changed", { from: null, to: null }))).toBe("Priya updated this case");
    expect(eventSentence(ev("resolved", {}))).toBe("Priya resolved this");
    expect(eventSentence({ type: "note_added" })).toBe("Someone added a note");
    expect(eventSentence(null)).toBe("Someone updated this case");
  });
});

test.describe("sanitizeActorName", () => {
  const table: [string, unknown, string][] = [
    ["empty", "", "Analyst"],
    ["whitespace only", "   \t\n ", "Analyst"],
    ["only control characters", "\u0000\u0001\u0007\u001f\u007f\u0085", "Analyst"],
    ["not a string", undefined, "Analyst"],
    ["null", null, "Analyst"],
    ["number", 42, "Analyst"],
    ["normal name", "Priya", "Priya"],
    ["trims", "  Priya N  ", "Priya N"],
    ["control characters removed", "Pr\u0000i\u0007ya", "Priya"],
    ["tab and newline become spaces", "Priya\tN\nSharma\r", "Priya N Sharma"],
    ["inner whitespace collapsed", "Priya     N   Sharma", "Priya N Sharma"],
    ["markup kept as plain text", "<script>alert(1)</script> & \"q\"", "<script>alert(1)</script> & \"q\""],
    ["unicode kept", "Sok Dara é", "Sok Dara é"],
  ];
  for (const [label, input, expected] of table) {
    test(label, () => {
      expect(sanitizeActorName(input)).toBe(expected);
    });
  }

  test("100 characters are cut to 64", () => {
    const out = sanitizeActorName("a".repeat(100));
    expect(out).toBe("a".repeat(64));
    expect(Array.from(sanitizeActorName("b".repeat(63) + " " + "c".repeat(40))).length).toBeLessThanOrEqual(64);
  });

  test("the cut never leaves trailing whitespace", () => {
    const out = sanitizeActorName("a".repeat(63) + " " + "b".repeat(10));
    expect(out).toBe("a".repeat(63));
  });

  test("an emoji at the cut is not split in half", () => {
    const out = sanitizeActorName("a".repeat(63) + "\u{1F600}\u{1F600}");
    expect(Array.from(out).length).toBe(64);
    expect(out.endsWith("\u{1F600}")).toBe(true);
  });

  test("constants", () => {
    expect(ACTOR_STORAGE_KEY).toBe("csa-actor-name");
    expect(DEFAULT_ACTOR_NAME).toBe("Analyst");
  });

  test("the result is idempotent", () => {
    for (const raw of ["  Priya \t N ", "\u0007x", "a".repeat(100), "", "<b>"]) {
      const once = sanitizeActorName(raw);
      expect(sanitizeActorName(once)).toBe(once);
    }
  });
});
