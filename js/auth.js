import { isEmail, normalizeCode, normalizeEmail, passwordIssue } from "./logic.js";
import { Store } from "./store.js";

const ITERATIONS = 60000;

function bytesToB64(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function b64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function safeEqual(a, b) {
  const left = String(a);
  const right = String(b);
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    mismatch |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

async function hashSecret(secret, saltB64) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Open this journal at http://localhost so sign-in can be protected.");
  }
  const salt = saltB64 ? b64ToBytes(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt,
    iterations: ITERATIONS,
    hash: "SHA-256",
  }, key, 256);
  return { salt: bytesToB64(salt), hash: bytesToB64(new Uint8Array(bits)) };
}

async function verifySecret(secret, record) {
  try {
    if (!record?.salt || !record?.hash) return false;
    const next = await hashSecret(secret, record.salt);
    return safeEqual(next.hash, record.hash);
  } catch {
    return false;
  }
}

function accountsOrThrow() {
  const accounts = Store.accounts();
  if (!accounts?.owner || !accounts?.viewer) throw new Error("Set up the journal first.");
  return accounts;
}

export function makeRecoveryCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map((byte) => alphabet[byte % alphabet.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

export const Auth = {
  hasAccounts() {
    const accounts = Store.accounts();
    return Boolean(accounts?.owner && accounts?.viewer);
  },
  session() {
    const session = Store.session();
    if (!session?.email || !session?.role) return null;
    return session;
  },
  recoveryPending() {
    const accounts = Store.accounts();
    return Boolean(accounts && accounts.recoveryAck === false);
  },
  profile() {
    const accounts = Store.accounts();
    const session = this.session();
    if (!accounts || !session) return null;
    return {
      role: session.role,
      email: session.email,
      ownerEmail: accounts.owner.email,
      viewerEmail: accounts.viewer.email,
    };
  },
  async setup({ ownerEmail, ownerPassword, viewerEmail, viewerPassword, recoveryCode }) {
    if (this.hasAccounts()) throw new Error("This journal already has logins.");
    const owner = normalizeEmail(ownerEmail);
    const viewer = normalizeEmail(viewerEmail);
    if (!isEmail(owner)) throw new Error("Enter your email.");
    if (!isEmail(viewer)) throw new Error("Enter the viewer email.");
    if (owner === viewer) throw new Error("Use two different emails.");
    const ownerIssue = passwordIssue(ownerPassword);
    const viewerIssue = passwordIssue(viewerPassword);
    if (ownerIssue) throw new Error(ownerIssue);
    if (viewerIssue) throw new Error(viewerIssue);
    const code = normalizeCode(recoveryCode);
    if (code.length < 8) throw new Error("Recovery code is missing.");
    const [ownerHash, viewerHash, recoveryHash] = await Promise.all([
      hashSecret(ownerPassword),
      hashSecret(viewerPassword),
      hashSecret(code),
    ]);
    await Store.saveAccounts({
      owner: { email: owner, ...ownerHash },
      viewer: { email: viewer, ...viewerHash },
      recovery: recoveryHash,
      recoveryAck: false,
    });
    await Store.saveSession({ email: owner, role: "owner" });
  },
  async login(email, password, expectedRole) {
    const accounts = accountsOrThrow();
    const normalized = normalizeEmail(email);
    const role = normalized === accounts.owner.email
      ? "owner"
      : normalized === accounts.viewer.email
        ? "viewer"
        : "";
    if (!role) throw new Error("No login uses that email.");
    if (expectedRole && role !== expectedRole) {
      throw new Error(expectedRole === "owner"
        ? "That email is not the one who enters the journal."
        : "That email is not the viewer.");
    }
    const record = role === "owner" ? accounts.owner : accounts.viewer;
    const ok = await verifySecret(password, record);
    if (!ok) throw new Error("That password doesn’t match.");
    await Store.saveSession({ email: normalized, role });
    return { email: normalized, role };
  },
  async logout() {
    await Store.clearSession();
  },
  async setRecoveryCode(recoveryCode) {
    const accounts = accountsOrThrow();
    const code = normalizeCode(recoveryCode);
    if (code.length < 8) throw new Error("Recovery code is missing.");
    accounts.recovery = await hashSecret(code);
    accounts.recoveryAck = false;
    await Store.saveAccounts(accounts);
  },
  async acknowledgeRecovery() {
    const accounts = accountsOrThrow();
    accounts.recoveryAck = true;
    await Store.saveAccounts(accounts);
    sessionStorage.removeItem("el.recovery.plain");
  },
  async resetWithRecovery(email, recoveryCode, nextPassword) {
    const accounts = accountsOrThrow();
    const issue = passwordIssue(nextPassword);
    if (issue) throw new Error(issue);
    const normalized = normalizeEmail(email);
    const role = normalized === accounts.owner.email
      ? "owner"
      : normalized === accounts.viewer.email
        ? "viewer"
        : "";
    if (!role) throw new Error("No login uses that email.");
    const ok = await verifySecret(normalizeCode(recoveryCode), accounts.recovery);
    if (!ok) throw new Error("That recovery code doesn’t match.");
    const next = await hashSecret(nextPassword);
    accounts[role] = { email: normalized, ...next };
    await Store.saveAccounts(accounts);
  },
  async changePassword(currentPassword, nextPassword) {
    const accounts = accountsOrThrow();
    const session = this.session();
    if (!session) throw new Error("Sign in first.");
    const issue = passwordIssue(nextPassword);
    if (issue) throw new Error(issue);
    const record = accounts[session.role];
    const ok = await verifySecret(currentPassword, record);
    if (!ok) throw new Error("Current password doesn’t match.");
    accounts[session.role] = { email: record.email, ...(await hashSecret(nextPassword)) };
    await Store.saveAccounts(accounts);
  },
  async setViewerPassword(nextPassword) {
    const accounts = accountsOrThrow();
    if (this.session()?.role !== "owner") throw new Error("Only the writer can do that.");
    const issue = passwordIssue(nextPassword);
    if (issue) throw new Error(issue);
    accounts.viewer = {
      email: accounts.viewer.email,
      ...(await hashSecret(nextPassword)),
    };
    await Store.saveAccounts(accounts);
  },
  async updateEmails(ownerEmail, viewerEmail) {
    const accounts = accountsOrThrow();
    if (this.session()?.role !== "owner") throw new Error("Only the writer can do that.");
    const owner = normalizeEmail(ownerEmail);
    const viewer = normalizeEmail(viewerEmail);
    if (!isEmail(owner) || !isEmail(viewer)) throw new Error("Enter both emails.");
    if (owner === viewer) throw new Error("Use two different emails.");
    accounts.owner = { ...accounts.owner, email: owner };
    accounts.viewer = { ...accounts.viewer, email: viewer };
    await Store.saveAccounts(accounts);
    await Store.saveSession({ email: owner, role: "owner" });
  },
};
