// On-chain interface, mirroring programs/proof_bounty/src/lib.rs (see SPEC.md).
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

/** Devnet deployment; keep in sync with Anchor.toml and app/. */
export const PROGRAM_ID = new PublicKey(
  "28CYsLKihZfAQWz513EAEXS52hc9npL9frZw1VpPAz3i",
);

export const BOUNTY_SEED = "bounty";
export const SUBMISSION_SEED = "sub";
export const MAX_STATEMENT_URI_LEN = 200;
export const MAX_PROOF_URI_LEN = 200;
export const NUM_VERIFIERS = 3;
export const VOTE_THRESHOLD = 2;

/** Anchor encodes unit enum variants as `{ variantName: {} }`. */
export type BountyStatus = { open: {} } | { solved: {} } | { refunded: {} };
export type SubmissionStatus = { pending: {} } | { accepted: {} } | { rejected: {} };

export interface Bounty {
  creator: PublicKey;
  bountyId: BN;
  /** sha256 of the exact statement text. */
  theoremHash: number[];
  statementUri: string;
  reward: BN;
  deadline: BN;
  verifiers: [PublicKey, PublicKey, PublicKey];
  status: BountyStatus;
  winner: PublicKey | null;
  bump: number;
}

export interface Submission {
  bounty: PublicKey;
  solver: PublicKey;
  proofHash: number[];
  proofUri: string;
  /** Bitmask: bit i set when verifiers[i] approved. */
  approvals: number;
  /** Bitmask: bit i set when verifiers[i] rejected. */
  rejections: number;
  status: SubmissionStatus;
  bump: number;
}

/** Instruction args, in the order SPEC.md gives them. */
export interface CreateBountyArgs {
  bountyId: BN;
  theoremHash: number[];
  statementUri: string;
  reward: BN;
  deadline: BN;
  verifiers: [PublicKey, PublicKey, PublicKey];
}
export interface SubmitProofArgs {
  proofHash: number[];
  proofUri: string;
}
export interface VoteArgs {
  approve: boolean;
}

/** `[b"bounty", creator, bounty_id_le_bytes]` */
export function bountyPda(
  creator: PublicKey,
  bountyId: BN | number | bigint,
  programId: PublicKey = PROGRAM_ID,
): [PublicKey, number] {
  const id = new BN(bountyId.toString());
  return PublicKey.findProgramAddressSync(
    [Buffer.from(BOUNTY_SEED), creator.toBuffer(), id.toArrayLike(Buffer, "le", 8)],
    programId,
  );
}

/** `[b"sub", bounty, solver]` */
export function submissionPda(
  bounty: PublicKey,
  solver: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SUBMISSION_SEED), bounty.toBuffer(), solver.toBuffer()],
    programId,
  );
}

export function statusName(s: BountyStatus | SubmissionStatus): string {
  return Object.keys(s)[0];
}

/** Indices of verifiers whose bit is set in an approvals/rejections mask. */
export function votedIndices(mask: number): number[] {
  return [0, 1, 2].filter((i) => (mask >> i) & 1);
}

export function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}
export function explorerAddress(addr: PublicKey | string): string {
  return `https://explorer.solana.com/address/${addr.toString()}?cluster=devnet`;
}

// ---------------------------------------------------------------------------
// getProgramAccounts filters. Offsets include the 8-byte discriminator and
// match the constants in lib.rs (strings are stored last in each account).
// ---------------------------------------------------------------------------

export const BOUNTY_STATUS_OFFSET = 8 + 32 + 8 + 32 + 8 + 8 + 32 * 3; // 192
export const SUBMISSION_BOUNTY_OFFSET = 8;
export const SUBMISSION_STATUS_OFFSET = 8 + 32 + 32 + 32 + 1 + 1; // 106

/** Borsh enum tags. */
export const BOUNTY_STATUS_TAG = { open: 0, solved: 1, refunded: 2 } as const;
export const SUBMISSION_STATUS_TAG = { pending: 0, accepted: 1, rejected: 2 } as const;

// base58 of a single byte 0..57 is one character of the alphabet.
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const byteFilter = (offset: number, tag: number) => ({ memcmp: { offset, bytes: B58[tag] } });

export function bountyStatusFilter(status: keyof typeof BOUNTY_STATUS_TAG) {
  return byteFilter(BOUNTY_STATUS_OFFSET, BOUNTY_STATUS_TAG[status]);
}
export function submissionStatusFilter(status: keyof typeof SUBMISSION_STATUS_TAG) {
  return byteFilter(SUBMISSION_STATUS_OFFSET, SUBMISSION_STATUS_TAG[status]);
}
export function submissionBountyFilter(bounty: PublicKey) {
  return { memcmp: { offset: SUBMISSION_BOUNTY_OFFSET, bytes: bounty.toBase58() } };
}

// ---------------------------------------------------------------------------
// Vote memos. The program does not store checker reasons, so each verifier
// adds an SPL Memo instruction to its vote transaction; the UI reads it back.
// ---------------------------------------------------------------------------

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
export const VOTE_MEMO_PREFIX = "proofbounty-vote:";
const MAX_MEMO_REASON = 180;

export interface VoteMemo {
  /** Verifier index 0..2. */
  v: number;
  ok: boolean;
  reason: string;
}

export function encodeVoteMemo(memo: VoteMemo): string {
  const reason = memo.reason.length > MAX_MEMO_REASON ? memo.reason.slice(0, MAX_MEMO_REASON - 1) + "…" : memo.reason;
  return VOTE_MEMO_PREFIX + JSON.stringify({ v: memo.v, ok: memo.ok, reason });
}

/** Parses a memo string; returns null for anything that is not a vote memo. */
export function decodeVoteMemo(text: string): VoteMemo | null {
  const start = text.indexOf(VOTE_MEMO_PREFIX);
  if (start < 0) return null;
  try {
    const value = JSON.parse(text.slice(start + VOTE_MEMO_PREFIX.length));
    if (![0, 1, 2].includes(value?.v) || typeof value.ok !== "boolean" || typeof value.reason !== "string") return null;
    return { v: value.v, ok: value.ok, reason: value.reason };
  } catch {
    return null;
  }
}
