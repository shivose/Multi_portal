"use strict";

const path = require("path");
const express = require("express");

const app = express();
const PORT = Number.parseInt(process.env.PORT, 10) || 3000;
const publicDir = path.join(__dirname, "public");

app.disable("x-powered-by");

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
});
