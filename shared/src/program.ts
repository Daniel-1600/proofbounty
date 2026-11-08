// On-chain interface, mirroring programs/proof_bounty/src/lib.rs (see SPEC.md).
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

/** Replaced with the devnet deployment ID in Milestone 1 (also Anchor.toml, app/). */
export const PROGRAM_ID = new PublicKey(
  "Fg6PaFpoGXkYsidMpWTK6W2BmZ7FEfcYkg476zPFsLnS",
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
