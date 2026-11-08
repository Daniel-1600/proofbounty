import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  bountyStatusFilter, encodeVoteMemo, explorerTx, listAccounts, MEMO_PROGRAM_ID, sha256Hex,
  statusName, submissionStatusFilter,
} from "@proofbounty/shared";
import type { Bounty, Submission, CheckResult } from "@proofbounty/shared";
import { checkProof } from "./checkProof";

export const POLL_INTERVAL_MS = 5_000;
export const MAX_BACKOFF_MS = 60_000;
export const ALREADY_DECIDED = "already decided, skipping";

export interface SubmissionAccount { publicKey: PublicKey; account: Submission }
/** The daemon is testable independently of deployment and transaction signing. */
export interface VerifierChain {
  /** Pending submissions on Open bounties this verifier is assigned to. */
  listSubmissions(): Promise<SubmissionAccount[]>;
  getBounty(address: PublicKey): Promise<Bounty>;
  /**
   * Fresh on-chain re-check just before voting. Returns why the submission no
   * longer needs a vote (e.g. "submission rejected", "bounty solved"), or null.
   */
  decided?(submission: SubmissionAccount): Promise<string | null>;
  /** `memo` carries the checker reason so the UI can show it. */
  vote(submission: SubmissionAccount, approve: boolean, memo?: string): Promise<string>;
}
export interface VerifierOptions {
  index: number;
  publicKey: PublicKey;
  chain: VerifierChain;
  fetchText?: (uri: string) => Promise<string>;
  check?: typeof checkProof;
  log?: (entry: Record<string, unknown>) => void;
}

export function isRateLimit(error: unknown): boolean {
  return /\b429\b|too many requests|rate.?limit/i.test(error instanceof Error ? error.message : String(error));
}

/** Program errors meaning someone else's votes already settled the outcome. */
function isDecidedError(error: unknown): boolean {
  return /SubmissionNotPending|BountyNotOpen/.test(error instanceof Error ? error.message : String(error));
}

/** Restrict remote reads, bound response size and time, preserve exact UTF-8. */
export async function fetchText(uri: string): Promise<string> {
  const url = new URL(uri);
  const allowed = (process.env.BLOB_ORIGINS ?? process.env.STORE_URL ?? "http://localhost:8787").split(",").map(s => new URL(s).origin);
  if (!allowed.includes(url.origin) || !["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Blob URI origin not allowed");
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "error" });
  if (!response.ok || !response.body) throw new Error(`Blob fetch failed: ${response.status}`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 262_144) throw new Error("Blob size limit exceeded");
    chunks.push(chunk);
  }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
}

export class VerifierDaemon {
  private readonly voted = new Set<string>();
  constructor(private readonly options: VerifierOptions) {
    if (![0, 1, 2].includes(options.index)) throw new Error("VERIFIER_INDEX must be 0, 1 or 2");
  }
  /** Throws on rate limiting so run() can back off. */
  async pollOnce(): Promise<void> {
    const { chain, index, publicKey } = this.options;
    const log = this.options.log ?? (entry => console.log(JSON.stringify(entry)));
    for (const submission of await chain.listSubmissions()) {
      const address = submission.publicKey.toBase58();
      const account = submission.account;
      if (this.voted.has(address) || statusName(account.status) !== "pending" || ((account.approvals | account.rejections) & (1 << index))) continue;
      const skip = (state: string) => {
        this.voted.add(address);
        log({ event: "skip", verifier: index, submission: address, reason: ALREADY_DECIDED, state });
      };
      try {
        const bounty = await chain.getBounty(account.bounty);
        if (!bounty.verifiers[index].equals(publicKey)) continue;
        if (statusName(bounty.status) !== "open") { skip(`bounty ${statusName(bounty.status)}`); continue; }
        let decision: CheckResult;
        const get = this.options.fetchText ?? fetchText;
        // Transport failures are retried; unavailable content is not a false proof.
        const statement = await get(bounty.statementUri);
        const proof = await get(account.proofUri);
        if (sha256Hex(proof) !== Buffer.from(account.proofHash).toString("hex")) {
          decision = { ok: false, reason: "Proof hash mismatch", axioms: [], leanOutput: "" };
        } else {
          decision = await (this.options.check ?? checkProof)(statement, proof, { theoremHash: bounty.theoremHash });
        }
        log({ event: "decision", verifier: index, submission: address, ...decision });
        // Other verifiers may have settled it while Lean was running.
        const settled = chain.decided ? await chain.decided(submission) : null;
        if (settled) { skip(settled); continue; }
        const memo = encodeVoteMemo({ v: index, ok: decision.ok, reason: decision.reason });
        const signature = await chain.vote(submission, decision.ok, memo);
        this.voted.add(address);
        log({ event: "vote", verifier: index, submission: address, ...decision, signature, transaction: explorerTx(signature) });
      } catch (error) {
        if (isRateLimit(error)) throw error;
        if (isDecidedError(error)) { skip("program reported decided"); continue; }
        log({ event: "retry", verifier: index, submission: address, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  async run(signal: AbortSignal): Promise<void> {
    const log = this.options.log ?? (entry => console.log(JSON.stringify(entry)));
    let wait = POLL_INTERVAL_MS;
    while (!signal.aborted) {
      try {
        await this.pollOnce();
        wait = POLL_INTERVAL_MS;
      } catch (error) {
        const limited = isRateLimit(error);
        wait = limited ? Math.min(wait * 2, MAX_BACKOFF_MS) : POLL_INTERVAL_MS;
        log({ event: limited ? "rate-limited" : "poll-error", verifier: this.options.index, reason: String(error).slice(0, 200), retryInMs: wait });
      }
      try { await delay(wait, undefined, { signal }); } catch { break; }
    }
  }
}

/** Live adapter: use the generated deployment IDL, never a guessed instruction ABI. */
export class AnchorVerifierChain implements VerifierChain {
  /** Open bounties from the latest listSubmissions(), reused by getBounty(). */
  private openBounties = new Map<string, Bounty>();
  constructor(private readonly program: Program, private readonly verifier: PublicKey) {}

  async listSubmissions(): Promise<SubmissionAccount[]> {
    // Two filtered getProgramAccounts calls per poll, regardless of history.
    const open = await listAccounts<Bounty>(this.program, "bounty", [bountyStatusFilter("open")]);
    this.openBounties = new Map(
      open.filter(b => b.account.verifiers.some(v => v.equals(this.verifier)))
        .map(b => [b.publicKey.toBase58(), b.account]),
    );
    if (this.openBounties.size === 0) return [];
    const pending = await listAccounts<Submission>(this.program, "submission", [submissionStatusFilter("pending")]);
    return pending.filter(s => this.openBounties.has(s.account.bounty.toBase58()));
  }
  async getBounty(address: PublicKey): Promise<Bounty> {
    return this.openBounties.get(address.toBase58()) ?? (this.program.account as any).bounty.fetch(address);
  }
  async decided(submission: SubmissionAccount): Promise<string | null> {
    const [sub, bounty] = await Promise.all([
      (this.program.account as any).submission.fetch(submission.publicKey) as Promise<Submission>,
      (this.program.account as any).bounty.fetch(submission.account.bounty) as Promise<Bounty>,
    ]);
    if (statusName(sub.status) !== "pending") return `submission ${statusName(sub.status)}`;
    if (statusName(bounty.status) !== "open") return `bounty ${statusName(bounty.status)}`;
    return null;
  }
  async vote(submission: SubmissionAccount, approve: boolean, memo?: string): Promise<string> {
    const builder = this.program.methods.vote(approve).accountsStrict({
      verifier: this.verifier,
      bounty: submission.account.bounty,
      submission: submission.publicKey,
      solver: submission.account.solver,
    });
    if (memo) {
      builder.postInstructions([new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(memo, "utf8") })]);
    }
    return builder.rpc();
  }
}

export async function main(): Promise<void> {
  const index = Number(process.env.VERIFIER_INDEX ?? "invalid");
  if (![0, 1, 2].includes(index)) throw new Error("VERIFIER_INDEX must be 0, 1 or 2");
  const keyPath = process.env.VERIFIER_KEYPAIR ?? resolve(__dirname, `../../keys/verifier-${index}.json`);
  const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(keyPath, "utf8"))));
  const idl = JSON.parse(await readFile(process.env.PROGRAM_IDL ?? resolve(__dirname, "../../target/idl/proof_bounty.json"), "utf8")) as Idl;
  const rpc = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  // The daemon backs off on 429 itself; web3.js's built-in retry would hammer the RPC.
  const connection = new Connection(rpc, { commitment: "confirmed", disableRetryOnRateLimit: true });
  const provider = new AnchorProvider(connection, new Wallet(keypair), { commitment: "confirmed" });
  const chain = new AnchorVerifierChain(new Program(idl, provider), keypair.publicKey);
  // Log only the host: private RPC URLs often embed an API key.
  console.log(JSON.stringify({ event: "start", verifier: index, publicKey: keypair.publicKey.toBase58(), rpcHost: new URL(rpc).host, pollMs: POLL_INTERVAL_MS }));
  const daemon = new VerifierDaemon({ index, publicKey: keypair.publicKey, chain });
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  await daemon.run(controller.signal);
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
