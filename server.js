"use strict";

const path = require("path");
const express = require("express");
const portalStore = require("./lib/portal-store");

const app = express();
const PORT = Number.parseInt(process.env.PORT, 10) || 3000;
const publicDir = path.join(__dirname, "public");

app.disable("x-powered-by");

app.use(
  express.json({
    limit: process.env.JSON_BODY_LIMIT || "50mb",
  })
);

/** Centralized app data: all clients read/write this document (optimistic revision). */
app.get("/api/state", (req, res) => {
  const { revision, state, updatedAt } = portalStore.getState();
  res.json({
    revision,
    state,
    updatedAt,
  });
});

app.put("/api/state", (req, res) => {
  const body = req.body || {};
  const clientRevision = body.revision;
  const nextState = body.state;
  const result = portalStore.putState(clientRevision, nextState);
  if (!result.ok) {
    if (result.status === 409) {
      return res.status(409).json({
        error: "revision_conflict",
        revision: result.revision,
        state: result.state,
      });
    }
    return res.status(result.status || 400).json({ error: "invalid_request" });
  }
  res.json({ ok: true, revision: result.revision });
});

app.use(
  express.static(publicDir, {
    index: "index.html",
    extensions: ["html"],
    maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
  })
);

/**
 * Client-side app uses hash-less paths only at /. If someone opens a deep link
 * without a file extension, serve index.html so the SPA can load.
 */
app.get("*", (req, res, next) => {
  if (req.path.includes(".")) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  res.sendFile(path.join(publicDir, "index.html"), (err) => {
    if (err) next(err);
  });
});

app.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
  console.log(`Central data file: ${portalStore.dataFile}`);
});
