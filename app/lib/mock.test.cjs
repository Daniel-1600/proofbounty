// Run integration checks against the TypeScript mock without adding a test runner.
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  module._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
};
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { BN } = require("@coral-xyz/anchor");
const { PublicKey } = require("@solana/web3.js");
const bs58 = require("bs58").default;
const { mockClient } = require("./mock.ts");
const { PROGRAM_ID } = require("../../shared/src/program.ts");
const settle = () => new Promise((resolve) => setImmediate(resolve));
async function until(predicate) {
  const end = Date.now() + 2000;
  while (!predicate() && Date.now() < end) await settle();
  assert.ok(predicate(), "asynchronous mock update completed");
}

test("seed accounts, exact hashing, PDA seeds, rejected cheats and winning votes", async () => {
  const rows = await mockClient.listBounties();
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((b) => Object.keys(b.status)[0]), ["open", "solved", "refunded"]);
  for (const row of rows) {
    assert.deepEqual(row.theoremHash, [...createHash("sha256").update(row.statement).digest()]);
    const [pda] = PublicKey.findProgramAddressSync([
      Buffer.from("bounty"), row.creator.toBuffer(), row.bountyId.toArrayLike(Buffer, "le", 8),
    ], new PublicKey(PROGRAM_ID.toBase58()));
    assert.equal(pda.toBase58(), row.address.toBase58());
    assert.equal(bs58.decode(row.transaction).length, 64);
  }
  const proofs = await mockClient.listSubmissions(rows[1].address.toBase58());
  assert.equal(proofs.length, 3);
  assert.match(proofs[0].reason, /"sorry"/);
  assert.match(proofs[1].reason, /"sorryAx"/);
  assert.deepEqual(proofs.map((s) => Object.keys(s.status)[0]), ["rejected", "rejected", "accepted"]);
  assert.equal(proofs[2].approvals, 7);
  assert.equal(proofs[0].rejections, 7);
  assert.equal(rows[1].winner.toBase58(), proofs[2].solver.toBase58());
  assert.equal(proofs[2].votes.length, 3);
  for (const proof of proofs) {
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from("sub"), proof.bounty.toBuffer(), proof.solver.toBuffer()], new PublicKey(PROGRAM_ID.toBase58()));
    assert.equal(pda.toBase58(), proof.address.toBase58());
    assert.deepEqual(proof.proofHash, [...createHash("sha256").update(proof.proof).digest()]);
    for (const vote of proof.votes) assert.ok(vote.reason.length > 20);
  }
  // Callers must not mutate internal account state by changing returned objects.
  rows[0].reward.iaddn(100);
  proofs[2].votes.pop();
  assert.equal((await mockClient.listBounties())[0].reward.toString(), "750000000");
  assert.equal((await mockClient.listSubmissions(rows[1].address.toBase58()))[2].votes.length, 3);
  assert.equal(await mockClient.getBounty("missing"), null);
});

test("posting preserves statement bytes and rejects invalid reward/deadline", async () => {
  const [seed] = await mockClient.listBounties();
  const input = { creator: seed.creator, statement: "  ∀ (n : Nat), n + 0 = n\n", reward: new BN("100000001"), deadline: new BN(Math.floor(Date.now() / 1000) + 7200) };
  const row = await mockClient.createBounty(input);
  assert.equal(row.statement, input.statement);
  assert.deepEqual(row.theoremHash, [...createHash("sha256").update(input.statement).digest()]);
  assert.equal((await mockClient.getBounty(row.address.toBase58())).reward.toString(), "100000001");
  await assert.rejects(mockClient.createBounty({ ...input, reward: new BN(0) }), /positive u64/);
  await assert.rejects(mockClient.createBounty({ ...input, reward: new BN("18446744073709551616") }), /positive u64/);
  await assert.rejects(mockClient.createBounty({ ...input, deadline: new BN(1) }), /future deadline/);
});

test("live updates drip a proof, three votes and quorum status; cleanup stops callbacks", async (t) => {
  const rows = await mockClient.listBounties();
  const open = rows.find((b) => b.title === "Reverse twice, get the original");
  const updates = [];
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const stop = mockClient.subscribe(open.address.toBase58(), (update) => updates.push(update));
  await until(() => updates.length > 0);
  assert.equal(updates.at(-1).submissions.length, 0);
  t.mock.timers.tick(4000); await until(() => updates.at(-1)?.submissions.length === 1);
  assert.equal(updates.at(-1).submissions.length, 1);
  assert.equal(updates.at(-1).submissions[0].votes.length, 0);
  for (let i = 1; i <= 3; i++) {
    t.mock.timers.tick(3000); await settle();
    assert.equal(updates.at(-1).submissions[0].votes.length, i);
  }
  assert.ok("rejected" in updates.at(-1).submissions[0].status);
  const count = updates.length;
  stop(); t.mock.timers.tick(6000); await settle();
  assert.equal(updates.length, count);
});
