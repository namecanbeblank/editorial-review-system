import express from "express";
import type { NextFunction, Request, Response } from "express";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { apiRouter } from "./api.js";
import { ensureSeedData } from "./store.js";

ensureSeedData();

const app = express();
app.use(express.json());
app.use("/api", apiRouter);

// web/dist only exists after `npm run build` (or `vite build`); dev mode runs the Vite
// dev server separately on its own port and proxies /api back here (see web/vite.config.ts).
const webDist = resolve(import.meta.dirname, "../web/dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.use((_req, res) => {
    res.sendFile(join(webDist, "index.html"));
  });
}

// Catches JSON body-parse errors (and anything else thrown upstream) as {error} JSON
// instead of Express's default HTML error page. Must be declared with all four
// parameters -- Express dispatches error handlers by function arity.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(400).json({ error: "invalid request" });
});

const PORT = Number(process.env.PORT) || 4610;
app.listen(PORT, "127.0.0.1", () => {
  console.log(`bofu-linter app server listening on http://localhost:${PORT}`);
});
