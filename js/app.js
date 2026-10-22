import { Auth, makeRecoveryCode } from "./auth.js";
import {
  EMOTIONS,
  VALENCES,
  blankForm,
  entryHeadline,
  entryToForm,
  escapeHtml,
  filterEntries,
  formToEntry,
  formatFullWhen,
  formatMast,
  formatTime,
  groupEntries,
  hasContent,
  isEmail,
  mergeImported,
  normalizeEmail,
  normalizeEmotions,
  passwordIssue,
  resolveRoute,
  sanitizeEntry,
  sortEntries,
  toLocalInputValue,
} from "./logic.js";
import { initStore, Store } from "./store.js";

const DETAIL_SECTIONS = [
  ["body", "What I felt in my body?"],
  ["thoughts", "General thoughts that occurred"],
  ["selfCritical", "What self-critical thoughts did you notice?"],
  ["whatNext", "What happened next? What did you do?"],
  ["needs", "What internal or personal needs have not been addressed or met?"],
  ["growth", "From a growth or noble mindset, how would your response be different?"],
];

const state = {
  form: null,
  formPath: "",
  editingId: null,
  filter: "all",
  query: "",
  recoveryCode: "",
  undo: null,
  setupRole: "owner",
  setupDraft: {
    owner: { email: "", password: "" },
    viewer: { email: "", password: "" },
  },
  loginRole: "owner",
};

let activePath = "";
let paintTail = Promise.resolve();
let draftTimer = 0;
let toastTimer = 0;

const stage = () => document.getElementById("stage");

function currentPath() {
  const hash = location.hash.replace(/^#/, "");
  if (!hash || hash === "/") return "/";
  return hash.startsWith("/") ? hash : `/${hash}`;
}

function entryIdFrom(path) {
  if (path.startsWith("/entry/")) return decodeURIComponent(path.slice("/entry/".length));
  if (path.startsWith("/edit/")) return decodeURIComponent(path.slice("/edit/".length));
  return "";
}

function isCompose(path) {
  return path === "/new" || path.startsWith("/edit/");
}

function routeContext(path) {
  const session = Auth.session();
  const id = entryIdFrom(path);
  return {
    hasAccounts: Auth.hasAccounts(),
    recoveryPending: Auth.recoveryPending(),
    role: session?.role || "",
    entryExists: id ? Store.entries().some((entry) => entry.id === id) : false,
  };
}

function requestPaint() {
  paintTail = paintTail.then(() => paint()).catch((error) => {
    stage().innerHTML = `<div class="screen"><h1 class="login-title">Something went wrong</h1><p class="lede">${escapeHtml(error.message || "Try again.")}</p></div>`;
  });
  return paintTail;
}

function go(path, { replace = false } = {}) {
  const next = path.startsWith("/") ? path : `/${path}`;
  if (currentPath() !== next) {
    const url = `#${next}`;
    if (replace) history.replaceState({ app: true }, "", url);
    else history.pushState({ app: true }, "", url);
  }
  return requestPaint();
}

function cloneForm(form) {
  return {
    ...blankForm(),
    ...form,
    emotions: normalizeEmotions(form?.emotions),
    valence: ["pleasant", "unpleasant", "neutral"].includes(form?.valence) ? form.valence : "",
  };
}

function syncFormFromDom() {
  if (!state.form || !isCompose(activePath)) return;
  for (const key of ["dayTime", "event", "body", "thoughts", "selfCritical", "whatNext", "needs", "growth"]) {
    const field = document.getElementById(`f-${key}`);
    if (field) state.form[key] = field.value;
  }
}

function captureDraftNow() {
  if (!isCompose(activePath) || !state.form) return;
  syncFormFromDom();
  if (!hasContent(state.form)) {
    const draft = Store.draft();
    const owns = activePath === "/new" ? draft && !draft.editingId : draft?.editingId === state.editingId;
    if (owns) Store.clearDraft();
    return;
  }
  Store.saveDraftNow({
    editingId: activePath.startsWith("/edit/") ? state.editingId : null,
    form: cloneForm(state.form),
    savedAt: new Date().toISOString(),
  });
}

function scheduleDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => captureDraftNow(), 300);
}

function prepare(path) {
  if (!isCompose(path)) return;
  if (state.form && state.formPath === path) return;
  const draft = Store.draft();
  if (path === "/new") {
    state.editingId = null;
    state.form = draft && !draft.editingId && hasContent(draft.form) ? cloneForm(draft.form) : blankForm();
  } else {
    const id = entryIdFrom(path);
    const entry = Store.entries().find((item) => item.id === id);
    state.editingId = id;
    if (draft?.editingId === id && hasContent(draft.form)) state.form = cloneForm(draft.form);
    else state.form = entryToForm(entry);
  }
  state.formPath = path;
}

function titleFor(path) {
  const names = {
    "/": "Journal",
    "/new": "New moment",
    "/login": "Sign in",
    "/setup": "Set up",
    "/recovery": "Recovery code",
    "/forgot": "Reset password",
    "/account": "Account",
  };
  const name = names[path] || (path.startsWith("/edit/") ? "Edit moment" : path.startsWith("/entry/") ? "Moment" : "Journal");
  return `${name} · Log your emotions`;
}

async function ensureRecoveryCode() {
  const existing = sessionStorage.getItem("el.recovery.plain");
  if (existing) return existing;
  const code = makeRecoveryCode();
  sessionStorage.setItem("el.recovery.plain", code);
  await Auth.setRecoveryCode(code);
  return code;
}

async function paint() {
  if (isCompose(activePath)) captureDraftNow();
  const resolved = resolveRoute(currentPath(), routeContext(currentPath()));
  if (resolved !== currentPath()) history.replaceState({ app: true }, "", `#${resolved}`);
  const path = currentPath();
  if (path === "/recovery") state.recoveryCode = await ensureRecoveryCode();
  prepare(path);
  stage().classList.toggle("lock", false);
  stage().innerHTML = render(path);
  document.title = titleFor(path);
  afterPaint();
  if (path !== activePath) window.scrollTo(0, 0);
  activePath = path;
}

function afterPaint() {
  document.querySelectorAll("textarea.field").forEach(autosize);
  const save = document.getElementById("save-entry");
  if (save && save.dataset.busy !== "true") save.disabled = !hasContent(state.form);
  const hint = document.getElementById("save-hint");
  if (hint) hint.hidden = hasContent(state.form);
}

function render(path) {
  if (path === "/setup") return setupScreen();
  if (path === "/recovery") return recoveryScreen();
  if (path === "/login") return loginScreen();
  if (path === "/forgot") return forgotScreen();
  if (path === "/account") return accountScreen();
  if (path === "/new" || path.startsWith("/edit/")) return composeScreen();
  if (path.startsWith("/entry/")) return detailScreen(entryIdFrom(path));
  return homeScreen();
}

function colophon() {
  return `
    <footer class="colophon">
      <p>Log your emotions and triggers.</p>
      <p>Inspired by Daniel Goleman and Brené Brown.</p>
      <p>Worksheet by Reem Al Jizawi, coach, consultant and trainer.</p>
    </footer>
  `;
}

function secretField({ id, label, autocomplete, value = "" }) {
  return `
    <label class="label" for="${id}">${label}</label>
    <div class="secret">
      <input class="field" id="${id}" name="${id}" type="password" autocomplete="${autocomplete}" maxlength="200" value="${escapeHtml(value)}">
      <button class="text-btn" type="button" data-action="toggle-secret" data-target="${id}" aria-pressed="false">Show</button>
    </div>
    <p class="err" data-error-for="${id}"></p>
  `;
}

function emailField({ id, label, autocomplete, value = "" }) {
  return `
    <label class="label" for="${id}">${label}</label>
    <input class="field" id="${id}" name="${id}" type="email" inputmode="email" autocomplete="${autocomplete}" autocapitalize="none" spellcheck="false" maxlength="120" value="${escapeHtml(value)}">
    <p class="err" data-error-for="${id}"></p>
  `;
}

function roleField(id, selected) {
  return `
    <label class="label" for="${id}">Sign in as</label>
    <div class="select">
      <select class="field" id="${id}" name="${id}">
        <option value="owner" ${selected === "owner" ? "selected" : ""}>The one who enters the journal</option>
        <option value="viewer" ${selected === "viewer" ? "selected" : ""}>Viewer</option>
      </select>
    </div>
  `;
}

function setupScreen() {
  const draft = state.setupDraft[state.setupRole];
  const other = state.setupRole === "owner" ? state.setupDraft.viewer : state.setupDraft.owner;
  const otherReady = isEmail(other.email) && !passwordIssue(other.password);
  return `
    <div class="screen">
      <p class="kicker">Emotional intelligence</p>
      <h1 class="login-title">Sign in</h1>
      <p class="lede">One email and one password. Choose who this login is. Nothing is sent anywhere.</p>
      <form data-form="setup" novalidate>
        ${roleField("setup-role", state.setupRole)}
        <p class="fine" id="role-hint">${state.setupRole === "owner" ? "Can add and edit." : "Can only read."}</p>
        ${emailField({ id: "auth-email", label: "Email", autocomplete: "username", value: draft.email })}
        ${secretField({ id: "auth-password", label: "Password", autocomplete: "new-password", value: draft.password })}
        <p class="err" id="form-error" role="alert"></p>
        <div class="stack">
          <button class="btn" id="setup-submit" type="submit">${otherReady ? "Create the journal" : "Continue"}</button>
        </div>
      </form>
      ${colophon()}
    </div>
  `;
}

function recoveryScreen() {
  return `
    <div class="screen">
      <header class="topbar">
        <p class="kicker">Keep this private</p>
        <button class="text-btn" type="button" data-action="logout">Sign out</button>
      </header>
      <h1 class="login-title">Save this code</h1>
      <p class="lede">It is the only way to reset a password. The moments themselves stay on this device either way. This code will not be shown again.</p>
      <p class="code" id="recovery-code" translate="no">${escapeHtml(state.recoveryCode)}</p>
      <div class="stack">
        <button class="btn ghost" type="button" data-action="copy-code">Copy code</button>
      </div>
      <label class="check">
        <input id="ack" type="checkbox">
        <span>I saved the recovery code somewhere safe.</span>
      </label>
      <div class="stack">
        <button class="btn" id="ack-btn" type="button" data-action="ack-recovery" disabled>Continue</button>
      </div>
    </div>
  `;
}

function loginScreen() {
  return `
    <div class="screen">
      <p class="kicker">Emotional intelligence</p>
      <h1 class="login-title">Log your emotions and triggers</h1>
      <p class="lede">A private record of what you feel, what you need, and how you might answer next time.</p>
      <form data-form="login" novalidate>
        ${roleField("login-role", state.loginRole)}
        <p class="fine" id="role-hint">${state.loginRole === "owner" ? "Can add and edit." : "Can only read."}</p>
        ${emailField({ id: "login-email", label: "Email", autocomplete: "username" })}
        ${secretField({ id: "login-password", label: "Password", autocomplete: "current-password" })}
        <p class="err" id="form-error" role="alert"></p>
        <div class="stack">
          <button class="btn" type="submit">Enter</button>
        </div>
      </form>
      <p class="fine"><button class="link" type="button" data-action="forgot">Forgot password</button></p>
      <p class="fine">Saved on this device. Sign out before the viewer opens the journal.</p>
      ${colophon()}
    </div>
  `;
}

function forgotScreen() {
  return `
    <div class="screen">
      <header class="topbar">
        <button class="back" type="button" data-action="to-login">← Sign in</button>
      </header>
      <h1 class="login-title">Reset a password</h1>
      <p class="lede">Use the email and the recovery code from setup. This does not delete any moments.</p>
      <form data-form="forgot" novalidate>
        ${emailField({ id: "forgot-email", label: "Email", autocomplete: "username" })}
        <label class="label" for="forgot-code">Recovery code</label>
        <input class="field" id="forgot-code" autocomplete="off" autocapitalize="characters" spellcheck="false">
        <p class="err" data-error-for="forgot-code"></p>
        ${secretField({ id: "forgot-password", label: "New password", autocomplete: "new-password" })}
        ${secretField({ id: "forgot-password-2", label: "Repeat new password", autocomplete: "new-password" })}
        <p class="err" id="form-error" role="alert"></p>
        <div class="stack">
          <button class="btn" type="submit">Reset password</button>
        </div>
      </form>
    </div>
  `;
}

function homeScreen() {
  const profile = Auth.profile();
  const mast = formatMast();
  const entries = Store.entries();
  const draft = Store.draft();
  const showDraft = draft && hasContent(draft.form);
  const owner = profile?.role === "owner";
  return `
    <div class="screen${owner ? " has-dock" : ""}">
      <header class="topbar">
        <p class="kicker">Log your emotions and triggers</p>
        <button class="text-btn" type="button" data-action="account">Account</button>
      </header>
      <h1 class="mast"><em>${escapeHtml(mast.weekday)}</em>${escapeHtml(mast.day)}</h1>
      <p class="mast-meta">${escapeHtml(mast.month)} ${escapeHtml(mast.year)}</p>
      ${owner ? "" : `<p class="viewing">Viewing only</p>`}
      ${showDraft && owner ? draftBanner(draft) : ""}
      ${entries.length ? `
        <label class="search">
          <span class="sr">Search entries</span>
          <input id="search" type="search" placeholder="Search the journal" value="${escapeHtml(state.query)}" enterkeyhint="search">
        </label>
        <div class="filters" role="toolbar" aria-label="Filter">
          ${["all", "pleasant", "unpleasant", "neutral"].map((value) => `
            <button class="filter${state.filter === value ? " is-on" : ""}" type="button" data-action="filter" data-valence="${value}" aria-pressed="${state.filter === value}">
              ${value === "all" ? "All" : value[0].toUpperCase() + value.slice(1)}
            </button>
          `).join("")}
        </div>
      ` : ""}
      <div id="journal">${entries.length ? journalHtml() : emptyHtml(owner)}</div>
      ${colophon()}
    </div>
    ${owner ? `<div class="dock"><button class="btn" type="button" data-action="compose">Log this moment</button></div>` : ""}
  `;
}

function draftBanner(draft) {
  const when = formatTime(draft.savedAt);
  const title = entryHeadline(draft.form || {});
  const kind = draft.editingId ? "Unfinished edit" : "Unfinished moment";
  return `
    <div class="banner">
      <p>${kind}${when ? ` from ${escapeHtml(when)}` : ""}. ${escapeHtml(title)}</p>
      <div class="banner-actions">
        <button class="link" type="button" data-action="resume-draft">Continue</button>
        <button class="text-btn danger" type="button" data-action="discard-draft">Discard</button>
      </div>
    </div>
  `;
}

function emptyHtml(owner) {
  if (owner) {
    return `
      <div class="empty">
        <strong>Nothing written yet.</strong>
        <p>A meeting, a tone of voice, a tight jaw. Catch it while it is still clear.</p>
      </div>
    `;
  }
  return `
    <div class="empty">
      <strong>Nothing written yet.</strong>
      <p>When the writer logs a moment, it will show up here.</p>
    </div>
  `;
}

function journalHtml() {
  const entries = filterEntries(Store.entries(), { valence: state.filter, query: state.query });
  if (!entries.length) return `<p class="quiet-empty">Nothing matches.</p>`;
  let index = 0;
  return groupEntries(entries).map((group) => `
    <section class="day-group">
      <h2 class="day">${escapeHtml(group.label)}</h2>
      ${group.items.map((entry) => {
        const delay = Math.min(index, 8) * 35;
        index += 1;
        const valence = VALENCES.find((item) => item.id === entry.valence);
        return `
          <button class="entry" type="button" data-action="open" data-id="${escapeHtml(entry.id)}" style="animation-delay:${delay}ms">
            <span class="entry-top">
              <span>${escapeHtml(formatTime(entry.dayTime))}</span>
              ${valence ? `<span class="v-${valence.id}">${valence.label}</span>` : "<span></span>"}
            </span>
            <span class="entry-title">${escapeHtml(entryHeadline(entry))}</span>
            ${entry.emotions?.length ? `<span class="entry-emotions">${escapeHtml(entry.emotions.join(" · "))}</span>` : ""}
          </button>
        `;
      }).join("")}
    </section>
  `).join("");
}

function composeScreen() {
  const form = state.form || blankForm();
  const editing = Boolean(state.editingId);
  const field = (key, number, label, placeholder) => `
    <label class="q" for="f-${key}"><small>${number}</small>${label}</label>
    <textarea class="field" id="f-${key}" name="${key}" rows="3" placeholder="${escapeHtml(placeholder)}">${escapeHtml(form[key] || "")}</textarea>
  `;
  return `
    <form id="moment-form" class="screen has-dock" data-form="moment" autocomplete="off" novalidate>
      <header class="topbar">
        <button class="back" type="button" data-action="back">← Journal</button>
        <p class="kicker">${editing ? "Edit moment" : "New moment"}</p>
      </header>
      <label class="q" for="f-dayTime"><small>01</small>Day and time</label>
      <input class="field" id="f-dayTime" type="datetime-local" value="${escapeHtml(form.dayTime)}">
      ${field("event", "02", "Event / situation", "What happened, or what set this off?")}
      ${field("body", "03", "What I felt in my body?", "Breath, jaw, chest, stomach, hands…")}
      ${field("thoughts", "04", "General thoughts that occurred", "What ran through your mind?")}
      <div class="group" role="group" aria-labelledby="q-emotions">
        <p class="q" id="q-emotions"><small>05</small>Name your emotions at the moment.</p>
        <p class="hint">Choose any that fit.</p>
        <div class="chips">
          ${EMOTIONS.map((emotion) => {
            const on = form.emotions.includes(emotion);
            return `<button class="chip${on ? " is-on" : ""}" type="button" data-action="toggle-emotion" data-emotion="${escapeHtml(emotion)}" aria-pressed="${on}">${escapeHtml(emotion)}</button>`;
          }).join("")}
        </div>
      </div>
      <div role="group" aria-labelledby="q-valence">
        <p class="q" id="q-valence"><small>06</small>Was the emotion pleasant, unpleasant, or neutral?</p>
        <div class="valence-row">
          ${VALENCES.map((item) => `
            <button class="valence${form.valence === item.id ? " is-on" : ""}" type="button" data-action="set-valence" data-valence="${item.id}" aria-pressed="${form.valence === item.id}">${item.label}</button>
          `).join("")}
        </div>
      </div>
      ${field("selfCritical", "07", "What self-critical thoughts did you notice?", "The harsh line, if there was one")}
      ${field("whatNext", "08", "What happened next? What did you do?", "What you did, or what happened after")}
      ${field("needs", "09", "What internal or personal needs have not been addressed or met?", "Respect, rest, honesty, closeness…")}
      ${field("growth", "10", "From a growth or noble mindset, how would your response be different?", "A response you could stand by later")}
    </form>
    <div class="dock">
      <p id="save-hint">Add a few words, or choose an emotion.</p>
      <button class="btn" id="save-entry" type="submit" form="moment-form">${editing ? "Save changes" : "Save entry"}</button>
    </div>
  `;
}

function detailScreen(id) {
  const entry = Store.entries().find((item) => item.id === id);
  if (!entry) return homeScreen();
  const owner = Auth.session()?.role === "owner";
  const valence = VALENCES.find((item) => item.id === entry.valence);
  const hasEvent = Boolean(String(entry.event || "").trim());
  const blocks = DETAIL_SECTIONS.filter(([key]) => String(entry[key] || "").trim())
    .map(([key, label]) => `
      <section class="detail-block">
        <h2>${label}</h2>
        <p>${escapeHtml(entry[key])}</p>
      </section>
    `).join("");
  return `
    <div class="screen${owner ? " has-dock" : ""}">
      <header class="topbar">
        <button class="back" type="button" data-action="back">← Journal</button>
      </header>
      <p class="kicker when">${escapeHtml(formatFullWhen(entry.dayTime))}</p>
      ${valence ? `<p class="valence-word v-${valence.id}">${valence.label}</p>` : ""}
      ${hasEvent ? `<p class="eyebrow">Event / situation</p>` : ""}
      <h1 class="detail-title">${escapeHtml(hasEvent ? entry.event.trim() : entryHeadline(entry))}</h1>
      ${entry.emotions?.length && hasEvent ? `<p class="emotion-line">${escapeHtml(entry.emotions.join(", "))}</p>` : ""}
      ${blocks}
      ${owner ? `<div class="stack"><button class="btn quiet danger" type="button" data-action="delete" data-id="${escapeHtml(entry.id)}">Remove this moment</button></div>` : ""}
      ${colophon()}
    </div>
    ${owner ? `<div class="dock"><button class="btn" type="button" data-action="edit" data-id="${escapeHtml(entry.id)}">Edit</button></div>` : ""}
  `;
}

function accountScreen() {
  const profile = Auth.profile();
  if (!profile) return loginScreen();
  const owner = profile.role === "owner";
  return `
    <div class="screen">
      <header class="topbar">
        <button class="back" type="button" data-action="back">← Journal</button>
        <p class="kicker">${owner ? "Writer" : "Viewer"}</p>
      </header>
      <h1 class="login-title">${escapeHtml(profile.email)}</h1>
      <p class="lede">${owner ? "You can log and edit." : "You can read this journal."} One person is signed in at a time on this device.</p>
      <form class="block" data-form="password" novalidate>
        <h2>Change your password</h2>
        ${secretField({ id: "current-password", label: "Current password", autocomplete: "current-password" })}
        ${secretField({ id: "next-password", label: "New password", autocomplete: "new-password" })}
        ${secretField({ id: "next-password-2", label: "Repeat new password", autocomplete: "new-password" })}
        <p class="err" data-error-for="password-form"></p>
        <div class="stack"><button class="btn" type="submit">Update password</button></div>
      </form>
      ${owner ? `
        <form class="block" data-form="viewer-password" novalidate>
          <h2>Viewer password</h2>
          <p class="lede">Set a new password for ${escapeHtml(profile.viewerEmail)}.</p>
          ${secretField({ id: "viewer-next", label: "New viewer password", autocomplete: "new-password" })}
          ${secretField({ id: "viewer-next-2", label: "Repeat it", autocomplete: "new-password" })}
          <p class="err" data-error-for="viewer-form"></p>
          <div class="stack"><button class="btn ghost" type="submit">Update viewer password</button></div>
        </form>
        <form class="block" data-form="emails" novalidate>
          <h2>Emails</h2>
          <label class="label" for="edit-owner-email">Writer email</label>
          <input class="field" id="edit-owner-email" type="email" inputmode="email" autocomplete="off" value="${escapeHtml(profile.ownerEmail)}">
          <label class="label" for="edit-viewer-email">Viewer email</label>
          <input class="field" id="edit-viewer-email" type="email" inputmode="email" autocomplete="off" value="${escapeHtml(profile.viewerEmail)}">
          <p class="err" data-error-for="emails"></p>
          <div class="stack"><button class="btn ghost" type="submit">Save emails</button></div>
        </form>
      ` : ""}
      <section class="block">
        <h2>A copy of the journal</h2>
        <p class="lede">Entries live in this browser. Export a file if you want a backup. Open the journal the same way each time — a home-screen icon and a browser tab can keep separate copies on some phones.</p>
        <div class="stack">
          <button class="btn ghost" type="button" data-action="export">Export</button>
          ${owner ? `<button class="btn ghost" type="button" data-action="pick-import">Import</button>` : ""}
        </div>
        ${owner ? `<input id="import-file" class="sr" type="file" accept="application/json,.json">` : ""}
      </section>
      <div class="stack">
        <button class="btn quiet" type="button" data-action="logout">Sign out</button>
      </div>
      ${colophon()}
    </div>
  `;
}

function showError(id, message) {
  const el = document.querySelector(`[data-error-for="${id}"]`) || document.getElementById(id);
  if (el) el.textContent = message || "";
}

function clearErrors() {
  document.querySelectorAll(".err").forEach((el) => {
    el.textContent = "";
  });
}

async function withBusy(button, label, fn) {
  if (!button || button.dataset.busy === "true") return;
  const previous = button.textContent;
  button.dataset.busy = "true";
  button.disabled = true;
  button.textContent = label;
  try {
    await fn();
  } finally {
    button.dataset.busy = "false";
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = previous;
    }
  }
}

function value(id) {
  return document.getElementById(id)?.value || "";
}

function rememberSetupFields() {
  state.setupDraft[state.setupRole] = {
    email: value("auth-email"),
    password: value("auth-password"),
  };
}

function applySetupRole(role) {
  rememberSetupFields();
  state.setupRole = role;
  const draft = state.setupDraft[role];
  const email = document.getElementById("auth-email");
  const password = document.getElementById("auth-password");
  if (email) email.value = draft.email;
  if (password) {
    password.value = draft.password;
    password.type = "password";
  }
  const toggle = document.querySelector("[data-target='auth-password']");
  if (toggle) {
    toggle.textContent = "Show";
    toggle.setAttribute("aria-pressed", "false");
  }
  const select = document.getElementById("setup-role");
  if (select) select.value = role;
  const hint = document.getElementById("role-hint");
  if (hint) hint.textContent = role === "owner" ? "Can add and edit." : "Can only read.";
  syncSetupButton();
}

function syncSetupButton() {
  const button = document.getElementById("setup-submit");
  if (!button || button.dataset.busy === "true") return;
  const other = state.setupRole === "owner" ? state.setupDraft.viewer : state.setupDraft.owner;
  const otherReady = isEmail(other.email) && !passwordIssue(other.password);
  button.textContent = otherReady ? "Create the journal" : "Continue";
}

async function onSetup(event) {
  clearErrors();
  rememberSetupFields();
  const current = state.setupDraft[state.setupRole];
  if (!isEmail(current.email)) {
    showError("auth-email", "Enter an email.");
    return;
  }
  const issue = passwordIssue(current.password);
  if (issue) {
    showError("auth-password", issue);
    return;
  }
  const otherRole = state.setupRole === "owner" ? "viewer" : "owner";
  const other = state.setupDraft[otherRole];
  if (!isEmail(other.email) || passwordIssue(other.password)) {
    applySetupRole(otherRole);
    showError("form-error", otherRole === "viewer"
      ? "Now the viewer."
      : "Now the one who enters the journal.");
    document.getElementById("auth-email")?.focus();
    return;
  }
  if (normalizeEmail(state.setupDraft.owner.email) === normalizeEmail(state.setupDraft.viewer.email)) {
    showError("auth-email", "Use a different email for each person.");
    return;
  }
  const button = event.submitter;
  await withBusy(button, "Saving…", async () => {
    const code = makeRecoveryCode();
    sessionStorage.setItem("el.recovery.plain", code);
    await Auth.setup({
      ownerEmail: state.setupDraft.owner.email,
      ownerPassword: state.setupDraft.owner.password,
      viewerEmail: state.setupDraft.viewer.email,
      viewerPassword: state.setupDraft.viewer.password,
      recoveryCode: code,
    });
    state.recoveryCode = code;
    await go("/recovery", { replace: true });
  });
}

async function onLogin(event) {
  clearErrors();
  const button = event.submitter;
  await withBusy(button, "Checking…", async () => {
    try {
      state.loginRole = document.getElementById("login-role")?.value || "owner";
      await Auth.login(value("login-email"), value("login-password"), state.loginRole);
      await go("/", { replace: true });
    } catch (error) {
      showError("form-error", error.message);
    }
  });
}

async function onForgot(event) {
  clearErrors();
  const next = value("forgot-password");
  const again = value("forgot-password-2");
  const issue = passwordIssue(next);
  if (issue) {
    showError("forgot-password", issue);
    return;
  }
  if (next !== again) {
    showError("forgot-password-2", "Those passwords don’t match.");
    return;
  }
  const button = event.submitter;
  await withBusy(button, "Resetting…", async () => {
    try {
      await Auth.resetWithRecovery(value("forgot-email"), value("forgot-code"), next);
      toast("Password updated. Sign in with it.");
      await go("/login", { replace: true });
    } catch (error) {
      showError("form-error", error.message);
    }
  });
}

async function onPassword(event) {
  clearErrors();
  const next = value("next-password");
  const issue = passwordIssue(next);
  if (issue) {
    showError("next-password", issue);
    return;
  }
  if (next !== value("next-password-2")) {
    showError("next-password-2", "Those passwords don’t match.");
    return;
  }
  const button = event.submitter;
  await withBusy(button, "Updating…", async () => {
    try {
      await Auth.changePassword(value("current-password"), next);
      event.target.reset();
      toast("Password updated");
    } catch (error) {
      showError("password-form", error.message);
    }
  });
}

async function onViewerPassword(event) {
  clearErrors();
  const next = value("viewer-next");
  const issue = passwordIssue(next);
  if (issue) {
    showError("viewer-next", issue);
    return;
  }
  if (next !== value("viewer-next-2")) {
    showError("viewer-next-2", "Those passwords don’t match.");
    return;
  }
  const button = event.submitter;
  await withBusy(button, "Updating…", async () => {
    try {
      await Auth.setViewerPassword(next);
      event.target.reset();
      toast("Viewer password updated");
    } catch (error) {
      showError("viewer-form", error.message);
    }
  });
}

async function onEmails(event) {
  clearErrors();
  const button = event.submitter;
  await withBusy(button, "Saving…", async () => {
    try {
      await Auth.updateEmails(value("edit-owner-email"), value("edit-viewer-email"));
      toast("Emails saved");
      await requestPaint();
    } catch (error) {
      showError("emails", error.message);
    }
  });
}

async function onSaveMoment(event) {
  if (Auth.session()?.role !== "owner") return;
  syncFormFromDom();
  if (!hasContent(state.form)) {
    afterPaint();
    return;
  }
  const button = event.submitter;
  await withBusy(button, "Saving…", async () => {
    clearTimeout(draftTimer);
    const existing = state.editingId
      ? Store.entries().find((entry) => entry.id === state.editingId)
      : null;
    const entry = formToEntry(state.form, existing);
    const rest = Store.entries().filter((item) => item.id !== entry.id);
    await Store.saveEntries(sortEntries([entry, ...rest]));
    await Store.clearDraft();
    state.form = null;
    state.formPath = "";
    state.editingId = null;
    toast("Saved on this device");
    await go("/", { replace: true });
  });
}

function onSubmit(event) {
  const form = event.target;
  const name = form?.dataset?.form;
  if (!name) return;
  event.preventDefault();
  const handlers = {
    setup: onSetup,
    login: onLogin,
    forgot: onForgot,
    password: onPassword,
    "viewer-password": onViewerPassword,
    emails: onEmails,
    moment: onSaveMoment,
  };
  Promise.resolve(handlers[name]?.(event)).catch((error) => {
    const message = error.message || "Something went wrong.";
    showError("form-error", message);
    if (!document.getElementById("form-error")) toast(message);
  });
}

function choiceSheet({ title, body, primary, secondary, danger = false }) {
  const dialog = document.getElementById("sheet");
  dialog.innerHTML = `
    <div class="sheet">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(body)}</p>
      <div class="stack">
        <button class="btn" type="button" data-choice="primary">${escapeHtml(primary)}</button>
        <button class="btn quiet${danger ? " danger" : ""}" type="button" data-choice="secondary">${escapeHtml(secondary)}</button>
      </div>
    </div>
  `;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      resolve(value);
    };
    dialog.querySelector("[data-choice='primary']").onclick = () => finish("primary");
    dialog.querySelector("[data-choice='secondary']").onclick = () => finish("secondary");
    dialog.addEventListener("close", () => finish("dismiss"), { once: true });
    dialog.addEventListener("cancel", (cancelEvent) => {
      cancelEvent.preventDefault();
      finish("dismiss");
    }, { once: true });
    if (!dialog.open) dialog.showModal();
  });
}

function toast(message, undo) {
  const el = document.getElementById("toast");
  clearTimeout(toastTimer);
  const dock = document.querySelector(".dock");
  el.style.bottom = `calc(${dock ? 96 : 20}px + env(safe-area-inset-bottom))`;
  el.innerHTML = `<span>${escapeHtml(message)}</span>${undo ? `<button type="button" data-action="undo">Undo</button>` : ""}`;
  el.classList.add("show");
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
    if (!undo) return;
    state.undo = null;
  }, undo ? 6000 : 2400);
  if (!undo) state.undo = null;
}

function autosize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.max(textarea.scrollHeight, 96)}px`;
}

function resumeDraft() {
  const draft = Store.draft();
  state.form = null;
  state.formPath = "";
  if (draft?.editingId) go(`/edit/${encodeURIComponent(draft.editingId)}`);
  else go("/new");
}

async function startFresh() {
  const draft = Store.draft();
  if (draft && hasContent(draft.form)) {
    const choice = await choiceSheet({
      title: "Unfinished moment",
      body: "You already started writing. Continue that one, or discard it and start fresh.",
      primary: "Continue writing",
      secondary: "Start fresh",
      danger: true,
    });
    if (choice === "dismiss") return;
    if (choice === "primary") {
      resumeDraft();
      return;
    }
    await Store.clearDraft();
  }
  state.form = blankForm();
  state.editingId = null;
  state.formPath = "/new";
  go("/new");
}

async function openEdit(id) {
  if (Auth.session()?.role !== "owner") return;
  const draft = Store.draft();
  if (draft && hasContent(draft.form) && draft.editingId !== id) {
    const choice = await choiceSheet({
      title: "Unfinished moment",
      body: "Starting this edit will put aside what you were writing.",
      primary: "Keep writing the other one",
      secondary: "Edit this moment",
      danger: true,
    });
    if (choice !== "secondary") {
      if (choice === "primary") resumeDraft();
      return;
    }
    await Store.clearDraft();
  }
  state.form = null;
  state.formPath = "";
  go(`/edit/${encodeURIComponent(id)}`);
}

async function removeEntry(id) {
  if (Auth.session()?.role !== "owner") return;
  const choice = await choiceSheet({
    title: "Remove this moment?",
    body: "You can undo it for a few seconds after.",
    primary: "Keep",
    secondary: "Remove",
    danger: true,
  });
  if (choice !== "secondary") return;
  const entry = Store.entries().find((item) => item.id === id);
  if (!entry) return;
  await Store.saveEntries(Store.entries().filter((item) => item.id !== id));
  state.undo = entry;
  toast("Moment removed", true);
  await go("/", { replace: true });
}

async function undoRemove() {
  const entry = state.undo;
  state.undo = null;
  document.getElementById("toast").classList.remove("show");
  if (!entry) return;
  if (Store.entries().some((item) => item.id === entry.id)) return;
  await Store.saveEntries(sortEntries([entry, ...Store.entries()]));
  toast("Restored");
  await requestPaint();
}

function exportJournal() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: Store.entries(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `emotions-log-${toLocalInputValue(new Date()).slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast("Export started");
}

async function importFile(file) {
  if (Auth.session()?.role !== "owner") return;
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    toast("That file isn’t a journal export.");
    return;
  }
  const rawEntries = Array.isArray(parsed) ? parsed : parsed?.entries;
  if (!Array.isArray(rawEntries)) {
    toast("That file has no moments.");
    return;
  }
  const incoming = rawEntries.map((entry) => sanitizeEntry(entry));
  const result = mergeImported(Store.entries(), incoming);
  await Store.saveEntries(result.entries);
  if (!result.added && !result.updated) toast("Nothing new in that file.");
  else toast(`Added ${result.added}, updated ${result.updated}.`);
}

function toggleEmotion(emotion) {
  if (!state.form || !EMOTIONS.includes(emotion)) return;
  const has = state.form.emotions.includes(emotion);
  state.form.emotions = has
    ? state.form.emotions.filter((item) => item !== emotion)
    : normalizeEmotions([...state.form.emotions, emotion]);
  const button = [...document.querySelectorAll("[data-action='toggle-emotion']")]
    .find((item) => item.dataset.emotion === emotion);
  if (button) {
    const on = state.form.emotions.includes(emotion);
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", String(on));
  }
  afterPaint();
  scheduleDraft();
}

function setValence(value) {
  if (!state.form) return;
  state.form.valence = state.form.valence === value ? "" : value;
  document.querySelectorAll("[data-action='set-valence']").forEach((button) => {
    const on = button.dataset.valence === state.form.valence;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", String(on));
  });
  afterPaint();
  scheduleDraft();
}

function setFilter(value) {
  state.filter = value;
  document.querySelectorAll("[data-action='filter']").forEach((button) => {
    const on = button.dataset.valence === value;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", String(on));
  });
  const journal = document.getElementById("journal");
  if (journal) journal.innerHTML = journalHtml();
}

async function onClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "toggle-secret") {
    const input = document.getElementById(button.dataset.target);
    if (!input) return;
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    button.textContent = showing ? "Show" : "Hide";
    button.setAttribute("aria-pressed", String(!showing));
    return;
  }
  if (action === "toggle-emotion") {
    toggleEmotion(button.dataset.emotion);
    return;
  }
  if (action === "set-valence") {
    setValence(button.dataset.valence);
    return;
  }
  if (action === "filter") {
    setFilter(button.dataset.valence);
    return;
  }
  if (action === "compose") {
    await startFresh();
    return;
  }
  if (action === "open") {
    go(`/entry/${encodeURIComponent(button.dataset.id)}`);
    return;
  }
  if (action === "edit") {
    await openEdit(button.dataset.id);
    return;
  }
  if (action === "delete") {
    await removeEntry(button.dataset.id);
    return;
  }
  if (action === "back") {
    const path = currentPath();
    if (path.startsWith("/edit/") && state.editingId) {
      await go(`/entry/${encodeURIComponent(state.editingId)}`, { replace: true });
      return;
    }
    await go(path === "/account" || path.startsWith("/entry/") || path === "/new" || path.startsWith("/edit/") ? "/" : "/login", { replace: true });
    return;
  }
  if (action === "account") {
    go("/account");
    return;
  }
  if (action === "logout") {
    clearTimeout(draftTimer);
    captureDraftNow();
    await Auth.logout();
    state.form = null;
    state.formPath = "";
    await go("/login", { replace: true });
    return;
  }
  if (action === "forgot" || action === "to-login") {
    go(action === "forgot" ? "/forgot" : "/login");
    return;
  }
  if (action === "resume-draft") {
    resumeDraft();
    return;
  }
  if (action === "discard-draft") {
    const choice = await choiceSheet({
      title: "Discard this draft?",
      body: "What you wrote in it will be removed from this device.",
      primary: "Keep",
      secondary: "Discard",
      danger: true,
    });
    if (choice !== "secondary") return;
    await Store.clearDraft();
    state.form = null;
    state.formPath = "";
    await requestPaint();
    return;
  }
  if (action === "ack-recovery") {
    if (!document.getElementById("ack")?.checked) return;
    await Auth.acknowledgeRecovery();
    await go("/", { replace: true });
    return;
  }
  if (action === "copy-code") {
    const code = state.recoveryCode || sessionStorage.getItem("el.recovery.plain") || "";
    try {
      await navigator.clipboard.writeText(code);
      toast("Copied");
    } catch {
      toast("Select the code and copy it.");
    }
    return;
  }
  if (action === "export") {
    exportJournal();
    return;
  }
  if (action === "pick-import") {
    document.getElementById("import-file")?.click();
    return;
  }
  if (action === "undo") {
    await undoRemove();
  }
}

function onInput(event) {
  const target = event.target;
  if (target.id === "search") {
    state.query = target.value;
    const journal = document.getElementById("journal");
    if (journal) journal.innerHTML = journalHtml();
    return;
  }
  if (target.id === "auth-email" || target.id === "auth-password") {
    rememberSetupFields();
    syncSetupButton();
  }
  if (target.id?.startsWith("f-") && state.form) {
    const key = target.id.slice(2);
    if (key in state.form) state.form[key] = target.value;
    if (target instanceof HTMLTextAreaElement) autosize(target);
    afterPaint();
    scheduleDraft();
  }
}

function onChange(event) {
  const target = event.target;
  if (target.id === "setup-role") {
    applySetupRole(target.value === "viewer" ? "viewer" : "owner");
    clearErrors();
    return;
  }
  if (target.id === "login-role") {
    state.loginRole = target.value === "viewer" ? "viewer" : "owner";
    const hint = document.getElementById("role-hint");
    if (hint) hint.textContent = state.loginRole === "owner" ? "Can add and edit." : "Can only read.";
    return;
  }
  if (target.id === "ack") {
    const button = document.getElementById("ack-btn");
    if (button) button.disabled = !target.checked;
  }
  if (target.id === "import-file" && target.files?.[0]) {
    const file = target.files[0];
    target.value = "";
    importFile(file).catch((error) => toast(error.message || "Import failed."));
  }
}

function applyThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  meta.content = dark ? "#161411" : "#f7f3ec";
}

function showBlocked(message) {
  stage().innerHTML = `
    <div class="screen">
      <p class="kicker">Emotional intelligence</p>
      <h1 class="login-title">Open it in the browser</h1>
      <p class="lede">${escapeHtml(message)}</p>
    </div>
  `;
}

async function boot() {
  applyThemeColor();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyThemeColor);
  document.addEventListener("click", (event) => {
    onClick(event).catch((error) => toast(error.message || "Something went wrong."));
  });
  document.addEventListener("submit", onSubmit);
  document.addEventListener("input", onInput);
  document.addEventListener("change", onChange);
  document.getElementById("sheet").addEventListener("click", (event) => {
    if (event.target.id === "sheet" && event.target.open) event.target.close();
  });
  document.addEventListener("focusin", (event) => {
    if (event.target.matches?.("textarea, input:not([type='checkbox']):not([type='file'])")) {
      setTimeout(() => {
        event.target.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      }, 280);
    }
  });
  window.addEventListener("pagehide", () => captureDraftNow());
  window.addEventListener("popstate", () => requestPaint());
  window.addEventListener("hashchange", () => requestPaint());
  if (!globalThis.crypto?.subtle || location.protocol === "file:") {
    showBlocked("Sign-in needs a normal web address. In this folder, run python3 -m http.server 4173 and open http://localhost:4173");
    return;
  }
  await initStore();
  if (!location.hash) history.replaceState({ app: true }, "", "#/");
  await requestPaint();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

boot().catch((error) => showBlocked(error.message || "The journal couldn’t start."));
