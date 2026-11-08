import express from "express";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DEFAULT_STORE_URL, sha256Hex } from "@proofbounty/shared";
import type { PutBlobResponse } from "@proofbounty/shared";

export function createStore(directory: string, publicUrl: string) {
  const app = express();
  // The frontend reads and uploads blobs from the browser (another origin).
  app.use((req, res, next) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });
  app.use(express.raw({ type: "*/*", limit: "256kb" }));
  app.post("/blob", async (req, res, next) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "body must be non-empty text" }); return;
    }
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(req.body); }
    catch { res.status(400).json({ error: "body must be valid UTF-8" }); return; }
    try {
      const hash = sha256Hex(content);
      await mkdir(directory, { recursive: true });
      // Exclusive creation makes repeated uploads idempotent and immutable.
      try { await writeFile(resolve(directory, hash), content, { flag: "wx" }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      const out: PutBlobResponse = { hash, uri: `${publicUrl.replace(/\/$/, "")}/blob/${hash}` };
      res.json(out);
    } catch (error) { next(error); }
  });
  app.get("/blob/:hash", async (req, res, next) => {
    if (!/^[a-f0-9]{64}$/.test(req.params.hash)) { res.status(400).json({ error: "invalid hash" }); return; }
    try {
      const content = await readFile(resolve(directory, req.params.hash), "utf8");
      if (sha256Hex(content) !== req.params.hash) { res.status(500).json({ error: "corrupt blob" }); return; }
      res.type("text/plain; charset=utf-8").send(content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") res.status(404).json({ error: "not found" });
      else next(error);
    }
  });
  return app;
}
export const app = createStore(process.env.STORE_DIR ?? resolve(__dirname, "blobs"), process.env.STORE_URL ?? DEFAULT_STORE_URL);
if (require.main === module) {
  const port = Number(process.env.STORE_PORT ?? 8787);
  app.listen(port, "127.0.0.1", () => console.log(`store listening on 127.0.0.1:${port}`));
}
