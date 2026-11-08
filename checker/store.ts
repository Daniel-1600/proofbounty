// Content-addressed blob store. Production option: IPFS (see README).
import express from "express";
import { DEFAULT_STORE_URL, PutBlobResponse, sha256Hex } from "@proofbounty/shared";

const PORT = Number(process.env.STORE_PORT ?? 8787);
const PUBLIC_URL = process.env.STORE_URL ?? DEFAULT_STORE_URL;
const blobs = new Map<string, string>();

export const app = express();
app.use(express.text({ type: "*/*", limit: "256kb" }));

app.post("/blob", (req, res) => {
  if (typeof req.body !== "string" || req.body.length === 0) {
    res.status(400).json({ error: "body must be non-empty text" });
    return;
  }
  const hash = sha256Hex(req.body);
  blobs.set(hash, req.body);
  const out: PutBlobResponse = { hash, uri: `${PUBLIC_URL}/blob/${hash}` };
  res.json(out);
});

app.get("/blob/:hash", (req, res) => {
  const content = blobs.get(req.params.hash);
  if (content === undefined) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.type("text/plain; charset=utf-8").send(content);
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`store listening on :${PORT}`));
}
