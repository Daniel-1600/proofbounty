import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { sha256Hex } from "@proofbounty/shared";
import { createStore } from "../store";

describe("content-addressed store", () => {
  it("persists exact text and returns stable hashes, URIs and missing errors", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pb-store-test-"));
    const server = createStore(directory, "http://localhost:8787").listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    try {
      const content = "\uFEFF∀ n : Nat, n + 0 = n\n";
      const post = () => fetch(`${base}/blob`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: content });
      const first = await (await post()).json() as any;
      assert.equal(first.hash, sha256Hex(content));
      assert.equal(first.uri, `http://localhost:8787/blob/${first.hash}`);
      assert.deepEqual(await (await post()).json(), first);
      const retrieved = await (await fetch(`${base}/blob/${first.hash}`)).arrayBuffer();
      assert.equal(new TextDecoder("utf-8", { ignoreBOM: true }).decode(retrieved), content);
      assert.equal((await fetch(`${base}/blob/${"0".repeat(64)}`)).status, 404);
      assert.equal((await fetch(`${base}/blob/invalid`)).status, 400);
      assert.equal((await fetch(`${base}/blob`, { method: "POST", body: "" })).status, 400);
      assert.equal(await (await import("node:fs/promises")).readFile(join(directory, first.hash), "utf8"), content);
    } finally {
      await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
      await rm(directory, { recursive: true, force: true });
    }
  });
});
