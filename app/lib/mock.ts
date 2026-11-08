import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { Buffer } from "buffer";
import { BOUNTY_SEED, SUBMISSION_SEED, PROGRAM_ID } from "../../shared/src/program";
import type { BountyClient, BountyView, BountyUpdate, PostBountyInput, SubmissionView } from "./client";

const CACHE_KEY = "proofbounty.mock.created.v1";
const verifiers: [PublicKey, PublicKey, PublicKey] = [key(11), key(22), key(33)];
let ready: Promise<void> | undefined;
let bounties: BountyView[] = [];
const submissions = new Map<string, SubmissionView[]>();
const created: BountyView[] = [];
let nextLiveSolver = 100;

// Use explicit browser Buffer imports rather than the Node-only globals in shared helpers.
function bountyPda(creator: PublicKey, id: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([
    Buffer.from(BOUNTY_SEED), creator.toBuffer(), id.toArrayLike(Buffer, "le", 8),
  ], PROGRAM_ID);
}
function submissionPda(bounty: PublicKey, solver: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from(SUBMISSION_SEED), bounty.toBuffer(), solver.toBuffer()], PROGRAM_ID);
}

function bytes(seed: number, length: number) {
  return Uint8Array.from({ length }, (_, i) => ((seed * 37 + i * 61 + i * i * 7) % 255) + 1);
}
function key(seed: number) { return new PublicKey(bytes(seed, 32)); }
function signature(seed: number) { return bs58.encode(bytes(seed, 64)); }
async function hash(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}
function blobUri(digest: number[]) {
  return `https://mock.proofbounty.invalid/blob/${digest.map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
function clone<T>(value: T): T {
  if (value instanceof PublicKey) return new PublicKey(value.toBytes()) as T;
  if (BN.isBN(value)) return new BN((value as BN).toString()) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
  return value;
}

async function makeBounty(input: PostBountyInput, bountyId: BN, title: string): Promise<BountyView> {
  const [address, bump] = bountyPda(input.creator, bountyId);
  const theoremHash = await hash(input.statement);
  return {
    creator: input.creator, statement: input.statement, reward: input.reward, deadline: input.deadline,
    bountyId, address, bump, theoremHash, statementUri: blobUri(theoremHash),
    verifiers, title, status: { open: {} }, winner: null,
    createdAt: Date.now(), transaction: signature(Number(bountyId.mod(new BN(251)).toString())),
  };
}

async function makeSubmission(bounty: BountyView, kind: "sorry" | "axiom" | "valid", seed: number): Promise<SubmissionView> {
  const solver = key(seed);
  const [address, bump] = submissionPda(bounty.address, solver);
  const proof = kind === "sorry" ? "by\n  intro a b\n  sorry"
    : kind === "axiom" ? "by\n  intro a b\n  exact sorryAx (a + b = b + a)"
    : "by\n  intro a b\n  exact Nat.add_comm a b";
  const reason = kind === "sorry" ? 'Forbidden token "sorry" detected before running Lean. No payout.'
    : kind === "axiom" ? 'Axiom "sorryAx" is not allowed. Only propext, Classical.choice and Quot.sound are permitted. No payout.' : undefined;
  const proofHash = await hash(proof);
  return {
    address, bounty: bounty.address, solver, bump, proof, proofHash, proofUri: blobUri(proofHash),
    approvals: 0, rejections: 0, status: { pending: {} }, votes: [], reason,
    submittedAt: Date.now(), transaction: signature(seed + 40),
  };
}

function addVote(sub: SubmissionView, index: 0 | 1 | 2, approve: boolean) {
  const reasons = approve ? [
    "Lean accepted target. Statement SHA-256 matches the bounty; no disallowed axioms.",
    "Independent Lean check passed. Nat.add_comm proves the exact posted statement.",
    "Lean exited successfully. Axiom audit passed; allowed axioms only.",
  ] : [sub.reason!, `Independent check rejected the proof: ${sub.reason}`, `Token and axiom audit failed: ${sub.reason}`];
  sub.votes.push({ verifierIndex: index, verifier: verifiers[index], approve, reason: reasons[index], transaction: signature(sub.solver.toBytes()[0] + index), timestamp: Date.now() });
  if (approve) sub.approvals |= 1 << index;
  else sub.rejections |= 1 << index;
  if (sub.votes.filter((vote) => vote.approve).length >= 2) sub.status = { accepted: {} };
  if (sub.votes.filter((vote) => !vote.approve).length >= 2) sub.status = { rejected: {} };
}

async function initialize() {
  if (!ready) ready = (async () => {
    const now = Math.floor(Date.now() / 1000);
    const open = await makeBounty({ creator: key(41), statement: "∀ (l : List Nat), List.reverse (List.reverse l) = l", reward: new BN(750_000_000), deadline: new BN(now + 86400 * 3) }, new BN(1), "Reverse twice, get the original");
    const solved = await makeBounty({ creator: key(42), statement: "∀ (a b : Nat), a + b = b + a", reward: new BN(1_500_000_000), deadline: new BN(now + 86400) }, new BN(2), "Natural addition is commutative");
    const refunded = await makeBounty({ creator: key(43), statement: "∀ (l m : List Nat), List.length (l ++ m) = List.length l + List.length m", reward: new BN(500_000_000), deadline: new BN(now - 86400) }, new BN(3), "Length of appended lists");
    const rows = await Promise.all([makeSubmission(solved, "sorry", 51), makeSubmission(solved, "axiom", 52), makeSubmission(solved, "valid", 53)]);
    rows.forEach((row, i) => { [0, 1, 2].forEach((v) => addVote(row, v as 0 | 1 | 2, i === 2)); });
    solved.status = { solved: {} };
    solved.winner = rows[2].solver;
    solved.payoutTransaction = signature(99);
    refunded.status = { refunded: {} };
    bounties = [open, solved, refunded];
    submissions.set(solved.address.toBase58(), rows);
    restoreCreated();
  })().catch((error) => { ready = undefined; throw error; });
  await ready;
}

/** Persist only user-created mock bounties. Restore contract types rather than raw JSON. */
function restoreCreated() {
  if (typeof window === "undefined") return;
  try {
    const items = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "[]") as Record<string, unknown>[];
    for (const raw of items) {
      const creator = new PublicKey(String(raw.creator));
      const bountyId = new BN(String(raw.bountyId));
      const [address, bump] = bountyPda(creator, bountyId);
      const row: BountyView = {
        creator, bountyId, address, bump, theoremHash: raw.theoremHash as number[], statementUri: String(raw.statementUri),
        statement: String(raw.statement), reward: new BN(String(raw.reward)), deadline: new BN(String(raw.deadline)),
        title: String(raw.title), createdAt: Number(raw.createdAt), transaction: String(raw.transaction),
        status: { open: {} }, winner: null, verifiers,
      };
      created.push(row);
      bounties.push(row);
    }
  } catch { /* An unavailable or stale local cache does not break the demo. */ }
}
function persistCreated() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(created.map((b) => ({
      creator: b.creator.toBase58(), bountyId: b.bountyId.toString(), theoremHash: b.theoremHash,
      statementUri: b.statementUri, statement: b.statement, reward: b.reward.toString(), deadline: b.deadline.toString(),
      title: b.title, createdAt: b.createdAt, transaction: b.transaction,
    }))));
  } catch { /* Continue with the in-memory store when browser storage is unavailable. */ }
}

export const mockClient: BountyClient = {
  async listBounties() { await initialize(); return clone(bounties); },
  async getBounty(address) { await initialize(); return clone(bounties.find((b) => b.address.toBase58() === address) ?? null); },
  async listSubmissions(address) { await initialize(); return clone(submissions.get(address) ?? []); },
  async createBounty(input) {
    await initialize();
    if (!input.statement.trim()) throw new Error("Enter a Lean statement.");
    if (input.statement.length > 20_000) throw new Error("Keep the statement under 20,000 characters.");
    if (input.reward.lten(0) || input.reward.bitLength() > 64) throw new Error("Reward must be a positive u64 amount in lamports.");
    if (input.deadline.lte(new BN(Math.floor(Date.now() / 1000))) || input.deadline.bitLength() > 63) throw new Error("Choose a future deadline.");
    const id = new BN((BigInt(Date.now()) * 1000n + BigInt(crypto.getRandomValues(new Uint16Array(1))[0] % 1000)).toString());
    const row = await makeBounty(input, id, "Community theorem");
    bounties.unshift(row);
    created.push(row);
    persistCreated();
    return clone(row);
  },
  subscribe(address, callback) {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const emit = (bounty: BountyView, rows: SubmissionView[]) => {
      if (!cancelled) callback(clone({ bounty, submissions: rows } satisfies BountyUpdate));
    };
    void (async () => {
      await initialize();
      const bounty = bounties.find((b) => b.address.toBase58() === address);
      if (!bounty) throw new Error("Bounty not found.");
      if ("refunded" in bounty.status) { emit(bounty, []); return; }
      // Solved accounts cannot receive new proofs. Replay recorded history instead.
      const historical = "solved" in bounty.status;
      let sequence = 0;
      let voteIndex = 0;
      let current: SubmissionView | undefined;
      let rows = clone(submissions.get(address) ?? []);
      emit(bounty, rows);
      const tick = async () => {
        if (cancelled) return;
        if (!current) {
          if (historical && sequence % 3 === 0) rows = [];
          const kind = historical ? (["sorry", "axiom", "valid"] as const)[sequence % 3] : sequence % 2 === 0 ? "sorry" : "axiom";
          current = await makeSubmission(bounty, kind, historical ? 51 + sequence % 3 : nextLiveSolver++);
          if (cancelled) return;
          // For arbitrary posted statements the demo only submits a rejected cheat.
          if (!historical && created.includes(bounty)) {
            current.proof = "by\n  sorry";
            current.proofHash = await hash(current.proof);
            current.proofUri = blobUri(current.proofHash);
            current.reason = 'Forbidden token "sorry" detected before running Lean. No payout.';
          }
          rows = [current, ...rows].slice(0, 12);
          voteIndex = 0;
        } else {
          addVote(current, voteIndex as 0 | 1 | 2, historical && sequence % 3 === 2);
          voteIndex++;
          if (voteIndex === 3) { current = undefined; sequence++; }
        }
        if (!historical) submissions.set(address, clone(rows));
        emit(bounty, rows);
        if (!cancelled) timer = setTimeout(() => { void tick().catch(fail); }, 3000);
      };
      timer = setTimeout(() => { void tick().catch(fail); }, 4000);
    })().catch(fail);
    function fail(error: unknown) {
      if (!cancelled) callback(error instanceof Error ? error : new Error(String(error)));
    }
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  },
};
