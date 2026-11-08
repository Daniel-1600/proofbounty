// Proof storage API (SPEC.md Milestone 2), served by checker/store.ts.
//   POST /blob        body: raw text  -> { hash, uri }
//   GET  /blob/:hash                  -> the stored text
import { createHash } from "crypto";

export interface PutBlobResponse {
  /** Hex sha256 of the content. */
  hash: string;
  /** Absolute URL of `GET /blob/:hash`; this goes on-chain. */
  uri: string;
}

export const DEFAULT_STORE_URL = "http://localhost:8787";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** sha256 as the `[u8; 32]` the program stores (`theorem_hash`, `proof_hash`). */
export function sha256Bytes(text: string): number[] {
  return [...createHash("sha256").update(text, "utf8").digest()];
}

export async function putBlob(
  content: string,
  storeUrl: string = process.env.STORE_URL ?? DEFAULT_STORE_URL,
): Promise<PutBlobResponse> {
  const res = await fetch(`${storeUrl}/blob`, {
    method: "POST",
    headers: { "content-type": "text/plain; charset=utf-8" },
    body: content,
  });
  if (!res.ok) throw new Error(`store POST /blob failed: ${res.status}`);
  return (await res.json()) as PutBlobResponse;
}

export async function getBlob(uri: string): Promise<string> {
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`store GET ${uri} failed: ${res.status}`);
  return res.text();
}
