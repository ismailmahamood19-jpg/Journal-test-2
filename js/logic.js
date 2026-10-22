export const EMOTIONS = [
  "Anger",
  "Anxious",
  "Belonging",
  "Blame",
  "Curious",
  "Disappointed",
  "Disgust",
  "Embarrassment",
  "Empathy",
  "Excited",
  "Fear / Scared",
  "Frustrated",
  "Gratitude",
  "Grief",
  "Guilt",
  "Happy",
  "Humiliation",
  "Hurt",
  "Jealous",
  "Joy",
  "Judgment",
  "Lonely",
  "Love",
  "Overwhelmed",
  "Regret",
  "Sad",
  "Shame",
  "Surprised",
  "Vulnerability",
  "Worried",
];

export const VALENCES = [
  { id: "pleasant", label: "Pleasant" },
  { id: "unpleasant", label: "Unpleasant" },
  { id: "neutral", label: "Neutral" },
];

export const TEXT_FIELDS = [
  "event",
  "body",
  "thoughts",
  "selfCritical",
  "whatNext",
  "needs",
  "growth",
];

const ID_RE = /^[A-Za-z0-9_-]{8,80}$/;

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const rand = (Math.random() * 16) | 0;
    const next = char === "x" ? rand : (rand & 0x3) | 0x8;
    return next.toString(16);
  });
}

export function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseDay(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeDayTime(value, now = new Date()) {
  if (typeof value === "string") {
    const trimmed = value.trim().slice(0, 16);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed) && parseDay(trimmed)) return trimmed;
  }
  return toLocalInputValue(now);
}

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

export function passwordIssue(password) {
  if (typeof password !== "string" || password.length < 6) return "Use at least 6 characters.";
  if (password.length > 200) return "That password is too long.";
  return "";
}

export function normalizeCode(code) {
  return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normalizeEmotions(list) {
  const selected = new Set(Array.isArray(list) ? list : []);
  return EMOTIONS.filter((emotion) => selected.has(emotion));
}

export function normalizeValence(value) {
  return ["pleasant", "unpleasant", "neutral"].includes(value) ? value : "";
}

function clip(value) {
  return String(value ?? "").replace(/\u0000/g, "").slice(0, 20000);
}

export function blankForm(now = new Date()) {
  return {
    dayTime: toLocalInputValue(now),
    event: "",
    body: "",
    thoughts: "",
    emotions: [],
    valence: "",
    selfCritical: "",
    whatNext: "",
    needs: "",
    growth: "",
  };
}

export function hasContent(form) {
  if (!form) return false;
  if (TEXT_FIELDS.some((key) => String(form[key] || "").trim())) return true;
  if (Array.isArray(form.emotions) && form.emotions.length > 0) return true;
  return Boolean(form.valence);
}

export function sanitizeEntry(raw, now = new Date()) {
  const source = raw && typeof raw === "object" ? raw : {};
  const id = typeof source.id === "string" && ID_RE.test(source.id) ? source.id : uid();
  const createdAt = typeof source.createdAt === "string" ? source.createdAt.slice(0, 40) : now.toISOString();
  const updatedAt = typeof source.updatedAt === "string" ? source.updatedAt.slice(0, 40) : now.toISOString();
  return {
    id,
    createdAt,
    updatedAt,
    dayTime: normalizeDayTime(source.dayTime, now),
    event: clip(source.event),
    body: clip(source.body),
    thoughts: clip(source.thoughts),
    emotions: normalizeEmotions(source.emotions),
    valence: normalizeValence(source.valence),
    selfCritical: clip(source.selfCritical),
    whatNext: clip(source.whatNext),
    needs: clip(source.needs),
    growth: clip(source.growth),
  };
}

export function entryToForm(entry) {
  return {
    dayTime: normalizeDayTime(entry?.dayTime),
    event: entry?.event || "",
    body: entry?.body || "",
    thoughts: entry?.thoughts || "",
    emotions: normalizeEmotions(entry?.emotions),
    valence: normalizeValence(entry?.valence),
    selfCritical: entry?.selfCritical || "",
    whatNext: entry?.whatNext || "",
    needs: entry?.needs || "",
    growth: entry?.growth || "",
  };
}

export function formToEntry(form, existing, now = new Date()) {
  return sanitizeEntry({
    id: existing?.id,
    createdAt: existing?.createdAt,
    updatedAt: now.toISOString(),
    dayTime: form.dayTime,
    event: form.event,
    body: form.body,
    thoughts: form.thoughts,
    emotions: form.emotions,
    valence: form.valence,
    selfCritical: form.selfCritical,
    whatNext: form.whatNext,
    needs: form.needs,
    growth: form.growth,
  }, now);
}

export function entryHeadline(entry) {
  const event = String(entry?.event || "").trim();
  if (event) return event.split("\n")[0].slice(0, 180);
  if (entry?.emotions?.length) return entry.emotions.join(", ");
  return "A moment";
}

export function formatMast(now = new Date()) {
  return {
    weekday: new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(now),
    day: String(now.getDate()),
    month: new Intl.DateTimeFormat(undefined, { month: "long" }).format(now),
    year: String(now.getFullYear()),
  };
}

export function formatDayLabel(date, now = new Date()) {
  const start = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diff = Math.round((start(now) - start(date)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(undefined, sameYear
    ? { weekday: "long", day: "numeric", month: "long" }
    : { day: "numeric", month: "long", year: "numeric" }).format(date);
}

export function formatTime(value) {
  const date = parseDay(value);
  if (!date) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

export function formatFullWhen(value) {
  const date = parseDay(value);
  if (!date) return "";
  const day = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  return `${day} · ${formatTime(value)}`;
}

export function sortEntries(entries) {
  return [...entries].sort((a, b) => String(b.dayTime).localeCompare(String(a.dayTime))
    || String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function filterEntries(entries, { valence = "all", query = "" } = {}, now = new Date()) {
  const needle = query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (valence !== "all" && entry.valence !== valence) return false;
    if (!needle) return true;
    const date = parseDay(entry.dayTime);
    const haystack = [
      entry.event,
      entry.body,
      entry.thoughts,
      entry.selfCritical,
      entry.whatNext,
      entry.needs,
      entry.growth,
      entry.valence,
      ...(entry.emotions || []),
      date ? formatDayLabel(date, now) : "",
      formatTime(entry.dayTime),
      formatFullWhen(entry.dayTime),
    ].join("\n").toLowerCase();
    return haystack.includes(needle);
  });
}

export function groupEntries(entries, now = new Date()) {
  const groups = [];
  for (const entry of sortEntries(entries)) {
    const date = parseDay(entry.dayTime);
    const key = date
      ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
      : "undated";
    const label = date ? formatDayLabel(date, now) : "Undated";
    const last = groups[groups.length - 1];
    if (!last || last.key !== key) groups.push({ key, label, items: [entry] });
    else last.items.push(entry);
  }
  return groups;
}

export function chooseSnapshot(primary, secondary) {
  if (!primary && !secondary) return null;
  if (!primary) return secondary;
  if (!secondary) return primary;
  return String(primary.savedAt) >= String(secondary.savedAt) ? primary : secondary;
}

export function resolveRoute(path, ctx) {
  const clean = typeof path === "string" && path.startsWith("/") ? path : "/";
  const entryId = clean.startsWith("/entry/") ? decodeURIComponent(clean.slice(7)) : "";
  const editId = clean.startsWith("/edit/") ? decodeURIComponent(clean.slice(6)) : "";

  if (!ctx.hasAccounts) return clean === "/setup" ? clean : "/setup";

  if (ctx.recoveryPending && ctx.role === "owner") {
    return clean === "/recovery" ? clean : "/recovery";
  }

  if (!ctx.role) {
    return clean === "/login" || clean === "/forgot" ? clean : "/login";
  }

  if (["/login", "/forgot", "/setup", "/recovery"].includes(clean)) return "/";
  if (clean === "/new") return ctx.role === "owner" ? clean : "/";
  if (editId) return ctx.role === "owner" && ctx.entryExists ? clean : "/";
  if (entryId) return ctx.entryExists ? clean : "/";
  if (clean === "/" || clean === "/account") return clean;
  return "/";
}

export function mergeImported(current, incoming) {
  const map = new Map(current.map((entry) => [entry.id, entry]));
  let added = 0;
  let updated = 0;
  for (const entry of incoming) {
    const prev = map.get(entry.id);
    if (!prev) {
      map.set(entry.id, entry);
      added += 1;
      continue;
    }
    if (JSON.stringify(prev) === JSON.stringify(entry)) continue;
    if (String(entry.updatedAt) >= String(prev.updatedAt)) {
      map.set(entry.id, entry);
      updated += 1;
    }
  }
  return { entries: sortEntries([...map.values()]), added, updated };
}
