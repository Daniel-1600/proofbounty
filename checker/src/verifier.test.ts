import { strict as assert } from "node:assert";
import { BN } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { decodeVoteMemo, sha256Bytes } from "@proofbounty/shared";
import type { Bounty, Submission, CheckResult } from "@proofbounty/shared";
import { ALREADY_DECIDED, isRateLimit, VerifierDaemon, VerifierChain, SubmissionAccount } from "./verifier";
import { checkProof } from "./checkProof";

const key = () => Keypair.generate().publicKey;
function fixture() {
  const verifier = key();
  const statement = "True";
  const proof = "by trivial";
  const bounty: Bounty = { creator: key(), bountyId: new BN(1), theoremHash: sha256Bytes(statement), statementUri: "http://store/statement", reward: new BN(1), deadline: new BN(9999999999), verifiers: [verifier, key(), key()], status: { open: {} }, winner: null, bump: 1 };
  const submission: SubmissionAccount = { publicKey: key(), account: { bounty: key(), solver: key(), proofHash: sha256Bytes(proof), proofUri: "http://store/proof", approvals: 0, rejections: 0, status: { pending: {} }, bump: 1 } satisfies Submission };
  const votes: boolean[] = [];
  const logs: Record<string, unknown>[] = [];
  const chain: VerifierChain = { listSubmissions: async () => [submission], getBounty: async () => bounty, vote: async (_s, approve) => { votes.push(approve); return "stub-signature"; } };
  const accepted: CheckResult = { ok: true, reason: "accepted", axioms: [], leanOutput: "" };
  const options = { index: 0, publicKey: verifier, chain, fetchText: async (uri: string) => uri.endsWith("statement") ? statement : proof, check: async () => accepted, log: (entry: Record<string, unknown>) => { logs.push(entry); } };
  return { bounty, submission, votes, logs, chain, options };
}
describe("verifier daemon with a stub vote interface", () => {
  it("votes once and links the decision to its transaction", async () => {
    const f = fixture();
    const daemon = new VerifierDaemon(f.options);
    await daemon.pollOnce(); await daemon.pollOnce();
    assert.deepEqual(f.votes, [true]);
    assert.equal(f.logs[1].signature, "stub-signature");
    assert.match(String(f.logs[1].transaction), /stub-signature\?cluster=devnet/);
    assert.equal(f.logs[1].reason, "accepted");
  });
  it("passes the on-chain hash to the checker", async () => {
    const f = fixture();
    f.options.check = async (_s?: string, _p?: string, options?: any) => {
      assert.deepEqual(options.theoremHash, f.bounty.theoremHash);
      return { ok: false, reason: "wrong proof", axioms: [], leanOutput: "" };
    };
    await new VerifierDaemon(f.options).pollOnce();
    assert.deepEqual(f.votes, [false]);
  });
  it("rejects a tampered statement using the real checker hash gate", async () => {
    const f = fixture();
    f.bounty.theoremHash = sha256Bytes("False");
    const daemon = new VerifierDaemon({ ...f.options, check: checkProof });
    await daemon.pollOnce();
    assert.deepEqual(f.votes, [false]);
    assert.equal(f.logs[1].reason, "Statement hash mismatch");
  });
  it("rejects tampered proof content without Lean", async () => {
    const f = fixture();
    f.submission.account.proofHash = sha256Bytes("different");
    f.options.check = async () => { throw new Error("must not run"); };
    await new VerifierDaemon(f.options).pollOnce();
    assert.deepEqual(f.votes, [false]);
    assert.equal(f.logs[1].reason, "Proof hash mismatch");
  });
  it("skips finalized, voted, solved and unauthorized accounts", async () => {
    for (const change of [
      (f: ReturnType<typeof fixture>) => { f.submission.account.status = { accepted: {} }; },
      (f: ReturnType<typeof fixture>) => { f.submission.account.rejections = 1; },
      (f: ReturnType<typeof fixture>) => { f.bounty.status = { solved: {} }; },
      (f: ReturnType<typeof fixture>) => { f.bounty.verifiers[0] = key(); },
    ]) {
      const f = fixture(); change(f);
      await new VerifierDaemon(f.options).pollOnce();
      assert.deepEqual(f.votes, []);
    }
  });
  it("retries failed RPC transactions without marking a vote complete", async () => {
    const f = fixture(); let calls = 0;
    f.chain.vote = async (_s, approve) => { if (++calls === 1) throw new Error("RPC unavailable"); f.votes.push(approve); return "retry-signature"; };
    const daemon = new VerifierDaemon(f.options);
    await daemon.pollOnce(); await daemon.pollOnce();
    assert.deepEqual(f.votes, [true]);
    assert.equal(f.logs[1].event, "retry");
  });
  it("retries unavailable blobs without casting a rejection", async () => {
    const f = fixture(); let calls = 0;
    f.options.fetchText = async (uri: string) => { if (++calls === 1) throw new Error("offline"); return uri.endsWith("statement") ? "True" : "by trivial"; };
    const daemon = new VerifierDaemon(f.options);
    await daemon.pollOnce(); assert.deepEqual(f.votes, []);
    await daemon.pollOnce(); assert.deepEqual(f.votes, [true]);
  });
  it("puts the checker reason in the vote memo", async () => {
    const f = fixture(); const memos: (string | undefined)[] = [];
    f.chain.vote = async (_s, approve, memo) => { f.votes.push(approve); memos.push(memo); return "memo-signature"; };
    await new VerifierDaemon(f.options).pollOnce();
    assert.deepEqual(decodeVoteMemo(String(memos[0])), { v: 0, ok: true, reason: "accepted" });
  });
  it("does not vote when the submission was decided while checking", async () => {
    const f = fixture();
    f.chain.decided = async () => "submission rejected";
    const daemon = new VerifierDaemon(f.options);
    await daemon.pollOnce(); await daemon.pollOnce();
    assert.deepEqual(f.votes, []);
    const skip = f.logs.find(entry => entry.event === "skip");
    assert.equal(skip?.reason, ALREADY_DECIDED);
    assert.equal(skip?.state, "submission rejected");
    assert.equal(f.logs.filter(entry => entry.event === "skip").length, 1);
  });
  it("treats a program 'not pending' error as decided, not as a retry", async () => {
    const f = fixture();
    f.chain.vote = async () => { throw new Error("AnchorError: Error Code: SubmissionNotPending."); };
    const daemon = new VerifierDaemon(f.options);
    await daemon.pollOnce(); await daemon.pollOnce();
    assert.equal(f.logs.filter(entry => entry.event === "retry").length, 0);
    assert.equal(f.logs.filter(entry => entry.reason === ALREADY_DECIDED).length, 1);
  });
  it("logs a solved bounty as already decided without checking", async () => {
    const f = fixture();
    f.bounty.status = { solved: {} };
    f.options.check = async () => { throw new Error("must not run"); };
    await new VerifierDaemon(f.options).pollOnce();
    assert.deepEqual(f.votes, []);
    assert.equal(f.logs[0].reason, ALREADY_DECIDED);
  });
  it("rethrows rate limits so run() can back off", async () => {
    const f = fixture();
    f.chain.getBounty = async () => { throw new Error("429 Too Many Requests"); };
    await assert.rejects(new VerifierDaemon(f.options).pollOnce(), /429/);
    assert.ok(isRateLimit(new Error("Server responded with 429 Too Many Requests")));
    assert.ok(!isRateLimit(new Error("Blob fetch failed: 404")));
  });
  it("requires a valid verifier index", () => {
    assert.throws(() => new VerifierDaemon({ ...fixture().options, index: 3 }));
  });
});
