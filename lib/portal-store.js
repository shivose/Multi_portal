"use strict";

const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");
const dataFile = path.join(dataDir, "portal-state.json");

function ensureDir() {
  fs.mkdirSync(dataDir, { recursive: true });
}

function readStore() {
  try {
    const raw = fs.readFileSync(dataFile, "utf8");
    const j = JSON.parse(raw);
    const revision = Number(j.revision) || 0;
    const state = j.state != null && typeof j.state === "object" ? j.state : null;
    return { revision, state, updatedAt: j.updatedAt || null };
  } catch {
    return { revision: 0, state: null, updatedAt: null };
  }
}

function writeStore(revision, state) {
  ensureDir();
  const payload = JSON.stringify(
    {
      revision,
      state,
      updatedAt: new Date().toISOString(),
    },
    null,
    0
  );
  const tmp = dataFile + ".tmp";
  fs.writeFileSync(tmp, payload, "utf8");
  fs.renameSync(tmp, dataFile);
}

/**
 * @returns {{ revision: number, state: object | null, updatedAt: string | null }}
 */
function getState() {
  return readStore();
}

/**
 * Optimistic concurrency: client must send current revision.
 * @returns {{ ok: true, revision: number } | { ok: false, status: number, revision: number, state: object | null }}
 */
function putState(clientRevision, nextState) {
  if (!nextState || typeof nextState !== "object") {
    return { ok: false, status: 400, revision: 0, state: null };
  }
  const cur = readStore();
  const currentRev = cur.revision || 0;
  const clientRev = Number(clientRevision);
  if (!Number.isFinite(clientRev) || clientRev < 0) {
    return { ok: false, status: 400, revision: currentRev, state: cur.state };
  }
  if (clientRev !== currentRev) {
    return { ok: false, status: 409, revision: currentRev, state: cur.state };
  }
  const newRev = currentRev + 1;
  writeStore(newRev, nextState);
  return { ok: true, revision: newRev };
}

module.exports = { getState, putState, dataFile, dataDir };
