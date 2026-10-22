import test from "node:test";
import assert from "node:assert/strict";
import {
  EMOTIONS,
  blankForm,
  chooseSnapshot,
  entryHeadline,
  escapeHtml,
  filterEntries,
  formToEntry,
  groupEntries,
  hasContent,
  mergeImported,
  normalizeCode,
  passwordIssue,
  resolveRoute,
  sanitizeEntry,
  toLocalInputValue,
} from "../js/logic.js";

const base = {
  hasAccounts: true,
  recoveryPending: false,
  role: "owner",
  entryExists: true,
};

test("includes every emotion from the worksheet", () => {
  assert.deepEqual(EMOTIONS, [
    "Anger", "Anxious", "Belonging", "Blame", "Curious", "Disappointed", "Disgust",
    "Embarrassment", "Empathy", "Excited", "Fear / Scared", "Frustrated", "Gratitude",
    "Grief", "Guilt", "Happy", "Humiliation", "Hurt", "Jealous", "Joy", "Judgment",
    "Lonely", "Love", "Overwhelmed", "Regret", "Sad", "Shame", "Surprised",
    "Vulnerability", "Worried",
  ]);
});

test("a moment needs words, an emotion, or a valence", () => {
  assert.equal(hasContent(blankForm()), false);
  assert.equal(hasContent({ ...blankForm(), event: "  " }), false);
  assert.equal(hasContent({ ...blankForm(), body: "tight jaw" }), true);
  assert.equal(hasContent({ ...blankForm(), emotions: ["Sad"] }), true);
  assert.equal(hasContent({ ...blankForm(), valence: "unpleasant" }), true);
});

test("entries keep the worksheet fields and drop unknown emotions", () => {
  const entry = formToEntry({
    ...blankForm(new Date(2026, 6, 2, 9, 30)),
    event: "The meeting <ran> long",
    body: "hot face",
    thoughts: "I should have spoken",
    emotions: ["Hurt", "Not a feeling", "Sad"],
    valence: "unpleasant",
    selfCritical: "I always freeze",
    whatNext: "I left quietly",
    needs: "to be heard",
    growth: "I would name it",
  }, null, new Date("2026-07-02T06:30:00.000Z"));
  assert.equal(entry.event, "The meeting <ran> long");
  assert.deepEqual(entry.emotions, ["Hurt", "Sad"]);
  assert.equal(entry.valence, "unpleasant");
  assert.equal(entry.dayTime, "2026-07-02T09:30");
  assert.equal(entryHeadline(entry), "The meeting <ran> long");
  assert.equal(escapeHtml(entry.event).includes("<"), false);
});

test("search and valence filters narrow the journal", () => {
  const entries = [
    sanitizeEntry({ id: "entry-aaa", dayTime: "2026-07-01T09:00", event: "Morning walk", emotions: ["Joy"], valence: "pleasant" }),
    sanitizeEntry({ id: "entry-bbb", dayTime: "2026-07-01T18:00", event: "A sharp email", emotions: ["Anger"], valence: "unpleasant" }),
  ];
  assert.equal(filterEntries(entries, { query: "email" }).length, 1);
  assert.equal(filterEntries(entries, { valence: "pleasant" })[0].id, "entry-aaa");
});

test("days group into today and yesterday", () => {
  const now = new Date(2026, 9, 22, 13, 0);
  const entries = [
    sanitizeEntry({ id: "entry-today", dayTime: toLocalInputValue(now), event: "Now" }),
    sanitizeEntry({ id: "entry-yest", dayTime: toLocalInputValue(new Date(2026, 9, 21, 8, 15)), event: "Then" }),
  ];
  const groups = groupEntries(entries, now);
  assert.deepEqual(groups.map((group) => group.label), ["Today", "Yesterday"]);
  assert.equal(groups[0].items[0].id, "entry-today");
});

test("the newer saved copy wins, and a missing copy does not wipe the other", () => {
  const older = { savedAt: "2026-01-01T00:00:00.000Z", data: [1] };
  const newer = { savedAt: "2026-02-01T00:00:00.000Z", data: [1, 2] };
  assert.equal(chooseSnapshot(older, newer), newer);
  assert.equal(chooseSnapshot(newer, null), newer);
  assert.equal(chooseSnapshot(null, null), null);
});

test("import adds and updates without duplicating the same moment", () => {
  const current = [sanitizeEntry({ id: "entry-aaa", event: "Old", updatedAt: "2026-01-01T00:00:00.000Z" })];
  const incoming = [
    sanitizeEntry({ id: "entry-aaa", event: "New", updatedAt: "2026-03-01T00:00:00.000Z" }),
    sanitizeEntry({ id: "entry-bbb", event: "Extra", updatedAt: "2026-03-01T00:00:00.000Z" }),
  ];
  const merged = mergeImported(current, incoming);
  assert.equal(merged.added, 1);
  assert.equal(merged.updated, 1);
  assert.equal(merged.entries.find((entry) => entry.id === "entry-aaa").event, "New");
  const again = mergeImported(merged.entries, incoming);
  assert.equal(again.added, 0);
  assert.equal(again.updated, 0);
});

test("routes keep the viewer out of writing, and the writer behind the recovery code", () => {
  assert.equal(resolveRoute("/new", { ...base, hasAccounts: false }), "/setup");
  assert.equal(resolveRoute("/account", { ...base, role: "" }), "/login");
  assert.equal(resolveRoute("/forgot", { ...base, role: "" }), "/forgot");
  assert.equal(resolveRoute("/", { ...base, recoveryPending: true }), "/recovery");
  assert.equal(resolveRoute("/new", { ...base, role: "viewer" }), "/");
  assert.equal(resolveRoute("/entry/abc", { ...base, role: "viewer", entryExists: true }), "/entry/abc");
  assert.equal(resolveRoute("/edit/abc", { ...base, role: "viewer", entryExists: true }), "/");
  assert.equal(resolveRoute("/missing", base), "/");
  assert.equal(passwordIssue("short"), "Use at least 6 characters.");
  assert.equal(normalizeCode("ab-cd 12ef"), "ABCD12EF");
});
