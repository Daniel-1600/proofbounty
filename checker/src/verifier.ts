import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { explorerTx, sha256Hex, statusName } from "@proofbounty/shared";
import type { Bounty, Submission, CheckResult } from "@proofbounty/shared";
import { checkProof } from "./checkProof";

export const POLL_INTERVAL_MS = 3_000;
export interface SubmissionAccount { publicKey: PublicKey; account: Submission }
/** The daemon is testable independently of deployment and transaction signing. */
export interface VerifierChain {
  listSubmissions(): Promise<SubmissionAccount[]>;
  getBounty(address: PublicKey): Promise<Bounty>;
  vote(submission: SubmissionAccount, approve: boolean): Promise<string>;
}
export interface VerifierOptions {
  index: number;
  publicKey: PublicKey;
  chain: VerifierChain;
  fetchText?: (uri: string) => Promise<string>;
  check?: typeof checkProof;
  log?: (entry: Record<string, unknown>) => void;
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
  async pollOnce(): Promise<void> {
    const { chain, index, publicKey } = this.options;
    const log = this.options.log ?? (entry => console.log(JSON.stringify(entry)));
    for (const submission of await chain.listSubmissions()) {
      const address = submission.publicKey.toBase58();
      const account = submission.account;
      if (this.voted.has(address) || statusName(account.status) !== "pending" || ((account.approvals | account.rejections) & (1 << index))) continue;
      try {
        const bounty = await chain.getBounty(account.bounty);
        if (statusName(bounty.status) !== "open" || !bounty.verifiers[index].equals(publicKey)) continue;
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
        const signature = await chain.vote(submission, decision.ok);
        this.voted.add(address);
        log({ event: "vote", verifier: index, submission: address, ...decision, signature, transaction: explorerTx(signature) });
      } catch (error) {
        log({ event: "retry", verifier: index, submission: address, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try { await this.pollOnce(); }
      catch (error) { (this.options.log ?? console.log)({ event: "poll-error", reason: String(error) }); }
      try { await delay(POLL_INTERVAL_MS, undefined, { signal }); } catch { break; }
    }
  }
}

/** Live adapter: use the generated deployment IDL, never a guessed instruction ABI. */
export class AnchorVerifierChain implements VerifierChain {
  constructor(private readonly program: Program, private readonly verifier: PublicKey) {}
  async listSubmissions(): Promise<SubmissionAccount[]> {
    return (this.program.account as any).submission.all();
  }
  async getBounty(address: PublicKey): Promise<Bounty> {
    return (this.program.account as any).bounty.fetch(address);
  }
  async vote(submission: SubmissionAccount, approve: boolean): Promise<string> {
    return this.program.methods.vote(approve).accountsStrict({
      verifier: this.verifier,
      bounty: submission.account.bounty,
      submission: submission.publicKey,
      solver: submission.account.solver,
    }).rpc();
  }
}

export async function main(): Promise<void> {
  const index = Number(process.env.VERIFIER_INDEX ?? "invalid");
  if (![0, 1, 2].includes(index)) throw new Error("VERIFIER_INDEX must be 0, 1 or 2");
  const keyPath = process.env.VERIFIER_KEYPAIR ?? resolve(__dirname, `../../keys/verifier-${index}.json`);
  const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(keyPath, "utf8"))));
  const idl = JSON.parse(await readFile(process.env.PROGRAM_IDL ?? resolve(__dirname, "../../target/idl/proof_bounty.json"), "utf8")) as Idl;
  const provider = new AnchorProvider(new Connection(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com", "confirmed"), new Wallet(keypair), { commitment: "confirmed" });
  const chain = new AnchorVerifierChain(new Program(idl, provider), keypair.publicKey);
  const daemon = new VerifierDaemon({ index, publicKey: keypair.publicKey, chain });
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  await daemon.run(controller.signal);
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
