import type { PublicKey } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import type { Bounty, Submission, CreateBountyArgs } from "../../shared/src/program";
import { mockClient } from "./mock";

/** Shared Anchor account fields plus content from the store and verifier logs. */
export interface BountyView extends Bounty {
  address: PublicKey;
  statement: string;
  title: string;
  createdAt: number;
  transaction: string;
  payoutTransaction?: string;
}
export interface VerifierVote {
  verifierIndex: 0 | 1 | 2;
  verifier: PublicKey;
  approve: boolean;
  reason: string;
  transaction: string;
  timestamp: number;
}
export interface SubmissionView extends Submission {
  address: PublicKey;
  proof: string;
  votes: VerifierVote[];
  reason?: string;
  submittedAt: number;
  transaction: string;
}
/** Adapter owns exact-text hashing, blob uploads, PDA derivation and transactions. */
export interface PostBountyInput {
  creator: PublicKey;
  statement: string;
  reward: CreateBountyArgs["reward"];
  deadline: CreateBountyArgs["deadline"];
  /** Provided by Phantom; mock mode never calls it. Real adapter signs the built instruction. */
  signTransaction?: WalletContextState["signTransaction"];
}
export interface BountyUpdate { bounty: BountyView; submissions: SubmissionView[] }
export interface BountyClient {
  listBounties(): Promise<BountyView[]>;
  getBounty(bounty: string): Promise<BountyView | null>;
  listSubmissions(bounty: string): Promise<SubmissionView[]>;
  createBounty(input: PostBountyInput): Promise<BountyView>;
  /** Full snapshots. Returns cleanup. Missing accounts/errors arrive as Error. */
  subscribe(bounty: string, callback: (update: BountyUpdate | Error) => void): () => void;
}
// Replace this adapter with Anchor + blob-store access; UI imports only this module.
export const client: BountyClient = mockClient;

/** Wallet adapter uses the same devnet endpoint as the future Anchor client. */
export const walletEndpoint = "https://api.devnet.solana.com";
