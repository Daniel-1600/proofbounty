import { BN, Program, type Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram, type GetProgramAccountsFilter } from "@solana/web3.js";
import { Buffer } from "buffer";
import type { Bounty, Submission } from "../../shared/src/program";
import type { BountyClient, BountyView, SubmissionView, VerifierVote } from "./client";
import { RPC_URL, STORE_URL } from "../src/lib/config";
// Hand-written Anchor 0.31 IDL; replace with target/idl/proof_bounty.json after anchor build.
import idl from "./idl/proof_bounty.json";

// JSON imports widen IDL names to strings; restore the known account namespace at this boundary.
interface EscrowAccount<T> {
  all(filters?: GetProgramAccountsFilter[]): Promise<{ publicKey: PublicKey; account: T }[]>;
  fetch(address: PublicKey): Promise<T>;
  fetchNullable(address: PublicKey): Promise<T | null>;
}
type EscrowProgram = Omit<Program, "account"> & {
  account: { bounty: EscrowAccount<Bounty>; submission: EscrowAccount<Submission> };
};
let program: EscrowProgram | undefined;
function getProgram() {
  if (!program) {
    const address = process.env.NEXT_PUBLIC_PROGRAM_ID;
    if (!address) throw new Error("Set NEXT_PUBLIC_PROGRAM_ID to the deployed escrow program.");
    program = new Program({ ...idl, address: new PublicKey(address).toBase58() } as Idl, {
      connection: new Connection(RPC_URL, "confirmed"),
    }) as unknown as EscrowProgram;
  }
  return program;
}

// Successful immutable blobs are cached; failed reads are retried on the next poll.
const blobs = new Map<string, Promise<string>>();
async function readBlob(uri: string): Promise<string> {
  let pending = blobs.get(uri);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(uri, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`Blob fetch failed (${response.status}): ${uri}`);
      return response.text();
    })();
    blobs.set(uri, pending);
  }
  try { return await pending; }
  catch (error) { blobs.delete(uri); throw error; }
}

// The escrow has no creation times, transaction signatures or checker reasons.
// Zero timestamps and empty signatures represent unavailable metadata, never invented history.
const creations = new Map<string, { createdAt: number; transaction: string }>();
async function bountyView(address: PublicKey, account: Bounty): Promise<BountyView> {
  const statement = await readBlob(account.statementUri);
  return {
    ...account, address, statement,
    title: statement.trim().split("\n")[0].slice(0, 100) || "Lean theorem",
    createdAt: 0, transaction: "", ...creations.get(address.toBase58()),
  };
}

async function submissionView(address: PublicKey, account: Submission, bounty: Bounty): Promise<SubmissionView> {
  const votes: VerifierVote[] = [];
  for (const verifierIndex of [0, 1, 2] as const) {
    const bit = 1 << verifierIndex;
    if ((account.approvals | account.rejections) & bit) {
      votes.push({
        verifierIndex, verifier: bounty.verifiers[verifierIndex],
        approve: Boolean(account.approvals & bit),
        reason: "Vote recorded on-chain. Checker reason is unavailable.",
        transaction: "", timestamp: 0,
      });
    }
  }
  return {
    ...account, address, proof: await readBlob(account.proofUri), votes,
    submittedAt: 0, transaction: "",
  };
}

function configuredVerifiers(): [PublicKey, PublicKey, PublicKey] {
  const keys = (process.env.NEXT_PUBLIC_VERIFIERS ?? "").split(",").map((key) => key.trim()).filter(Boolean);
  if (keys.length !== 3 || new Set(keys).size !== 3) {
    throw new Error("Set NEXT_PUBLIC_VERIFIERS to three distinct comma-separated verifier public keys.");
  }
  return keys.map((key) => new PublicKey(key)) as [PublicKey, PublicKey, PublicKey];
}

export const anchorClient: BountyClient = {
  async listBounties() {
    const rows = await getProgram().account.bounty.all();
    return Promise.all(rows.map(({ publicKey, account }) => bountyView(publicKey, account as Bounty)));
  },
  async getBounty(address) {
    const key = new PublicKey(address);
    const account = await getProgram().account.bounty.fetchNullable(key);
    return account ? bountyView(key, account as Bounty) : null;
  },
  async listSubmissions(address) {
    const key = new PublicKey(address);
    const currentProgram = getProgram();
    const bounty = await currentProgram.account.bounty.fetchNullable(key);
    if (!bounty) return [];
    // First field after the 8-byte account discriminator is the bounty public key.
    const rows = await currentProgram.account.submission.all([{ memcmp: { offset: 8, bytes: key.toBase58() } }]);
    return Promise.all(rows.map(({ publicKey, account }) => submissionView(publicKey, account as Submission, bounty as Bounty)));
  },
  async createBounty(input) {
    const signTransaction = input.signTransaction;
    if (!signTransaction) throw new Error("Connect a wallet that supports transaction signing.");
    if (!input.statement.trim()) throw new Error("Enter a Lean statement.");
    if (input.statement.length > 20000) throw new Error("Keep the statement under 20,000 characters.");
    if (input.reward.lten(0) || input.reward.bitLength() > 64) throw new Error("Reward must be a positive u64 amount in lamports.");
    if (input.deadline.lte(new BN(Math.floor(Date.now() / 1000))) || input.deadline.bitLength() > 63) throw new Error("Choose a future deadline.");
    const verifiers = configuredVerifiers();
    const currentProgram = getProgram();
    const theoremHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.statement))));
    const response = await fetch(`${STORE_URL.replace(/\/$/, "")}/blob`, {
      method: "POST", headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: input.statement, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Statement upload failed (${response.status}).`);
    const blob: { hash?: string; uri?: string } = await response.json();
    const digest = theoremHash.map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (blob.hash !== digest || typeof blob.uri !== "string") throw new Error("Store returned an invalid statement hash or URI.");
    if (new TextEncoder().encode(blob.uri).length > 200) throw new Error("Statement URI exceeds 200 bytes.");
    if (!["http:", "https:"].includes(new URL(blob.uri).protocol)) throw new Error("Store must return an HTTP(S) URI.");
    const bountyId = new BN(Buffer.from(crypto.getRandomValues(new Uint8Array(8))), "le");
    const [address] = PublicKey.findProgramAddressSync([
      Buffer.from("bounty"), input.creator.toBuffer(), bountyId.toArrayLike(Buffer, "le", 8),
    ], currentProgram.programId);
    const tx = await currentProgram.methods.createBounty(
      bountyId, theoremHash, blob.uri, input.reward, input.deadline, verifiers,
    ).accountsStrict({ creator: input.creator, bounty: address, systemProgram: SystemProgram.programId }).transaction();
    const connection = currentProgram.provider.connection;
    const blockhash = await connection.getLatestBlockhash("confirmed");
    tx.feePayer = input.creator;
    tx.recentBlockhash = blockhash.blockhash;
    const signed = await signTransaction(tx);
    const transaction = await connection.sendRawTransaction(signed.serialize(), { preflightCommitment: "confirmed" });
    const result = await connection.confirmTransaction({ ...blockhash, signature: transaction }, "confirmed");
    if (result.value.err) throw new Error(`Bounty transaction ${transaction} failed: ${JSON.stringify(result.value.err)}`);
    creations.set(address.toBase58(), { createdAt: Date.now(), transaction });
    blobs.set(blob.uri, Promise.resolve(input.statement));
    const account = await currentProgram.account.bounty.fetch(address);
    return bountyView(address, account as Bounty);
  },
  subscribe(address, callback) {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const [bounty, submissions] = await Promise.all([
          anchorClient.getBounty(address), anchorClient.listSubmissions(address),
        ]);
        if (!bounty) throw new Error("Bounty not found.");
        if (!cancelled) callback({ bounty, submissions });
      } catch (error) {
        if (!cancelled) callback(error instanceof Error ? error : new Error(String(error)));
      } finally {
        // Schedule after completion so slow devnet RPC requests never overlap.
        if (!cancelled) timer = setTimeout(() => { void poll(); }, 3000);
      }
    };
    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  },
};
