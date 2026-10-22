import { chooseSnapshot } from "./logic.js";

const KEYS = {
  accounts: "el.accounts.v1",
  entries: "el.entries.v1",
  session: "el.session.v1",
  draft: "el.draft.v1",
};

const SAVE_ERROR = "This browser couldn’t store the journal. Free a little space and try again.";

const memory = new Map();
let dbPromise = null;

function snapshot(data) {
  if (typeof structuredClone === "function") return structuredClone(data);
  return JSON.parse(JSON.stringify(data));
}

function normalizePayload(value) {
  if (!value || typeof value !== "object" || !("data" in value) || !value.savedAt) return null;
  return value;
}

function localGet(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    return normalizePayload(JSON.parse(raw));
  } catch {
    return null;
  }
}

function localSet(storageKey, value) {
  localStorage.setItem(storageKey, JSON.stringify(value));
}

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      if (!globalThis.indexedDB) {
        resolve(null);
        return;
      }
      const request = indexedDB.open("emotional-log", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
  }
  return dbPromise;
}

function readIdb(name) {
  return openDb().then((db) => new Promise((resolve) => {
    if (!db) {
      resolve(null);
      return;
    }
    try {
      const tx = db.transaction("kv", "readonly");
      const request = tx.objectStore("kv").get(name);
      request.onsuccess = () => resolve(normalizePayload(request.result));
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}

function writeIdb(name, payload) {
  return openDb().then((db) => new Promise((resolve) => {
    if (!db) {
      resolve(false);
      return;
    }
    try {
      const tx = db.transaction("kv", "readwrite");
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
      tx.objectStore("kv").put(payload, name);
    } catch {
      resolve(false);
    }
  }));
}

function deleteIdb(name) {
  return openDb().then((db) => new Promise((resolve) => {
    if (!db) {
      resolve(false);
      return;
    }
    try {
      const tx = db.transaction("kv", "readwrite");
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
      tx.objectStore("kv").delete(name);
    } catch {
      resolve(false);
    }
  }));
}

function commit(name, data) {
  const payload = { savedAt: new Date().toISOString(), data: snapshot(data) };
  memory.set(name, payload);
  let localOk = false;
  try {
    localSet(KEYS[name], payload);
    localOk = true;
  } catch {
    localOk = false;
  }
  return { localOk, idbOk: writeIdb(name, payload) };
}

async function commitOrThrow(name, data) {
  const { localOk, idbOk } = commit(name, data);
  if (!localOk && !(await idbOk)) throw new Error(SAVE_ERROR);
}

function read(name) {
  return memory.get(name)?.data ?? null;
}

export async function initStore() {
  for (const name of Object.keys(KEYS)) {
    const fromLocal = localGet(KEYS[name]);
    const fromIdb = await readIdb(name);
    const chosen = chooseSnapshot(fromLocal, fromIdb);
    if (!chosen) continue;
    memory.set(name, chosen);
    if (!fromLocal || String(fromLocal.savedAt) < String(chosen.savedAt)) {
      try {
        localSet(KEYS[name], chosen);
      } catch {
        /* the other copy is still there */
      }
    }
    if (!fromIdb || String(fromIdb.savedAt) < String(chosen.savedAt)) {
      await writeIdb(name, chosen);
    }
  }
}

export const Store = {
  accounts() {
    return read("accounts");
  },
  saveAccounts(accounts) {
    return commitOrThrow("accounts", accounts);
  },
  entries() {
    const data = read("entries");
    return Array.isArray(data) ? data : [];
  },
  saveEntries(entries) {
    return commitOrThrow("entries", entries);
  },
  session() {
    return read("session");
  },
  saveSession(session) {
    return commitOrThrow("session", session);
  },
  async clearSession() {
    memory.delete("session");
    try {
      localStorage.removeItem(KEYS.session);
    } catch {
      /* ignore */
    }
    await deleteIdb("session");
  },
  draft() {
    return read("draft");
  },
  saveDraftNow(draft) {
    commit("draft", draft);
  },
  async clearDraft() {
    memory.delete("draft");
    try {
      localStorage.removeItem(KEYS.draft);
    } catch {
      /* ignore */
    }
    await deleteIdb("draft");
  },
};
