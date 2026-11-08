// Chain, store and logging helpers shared by the honest and cheater agents.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  explorerTx, getBlob, putBlob, sha256Bytes, sha256Hex, submissionPda,
} from "@proofbounty/shared";
import type { Bounty } from "@proofbounty/shared";

export const ROOT = resolve(__dirname, "..");
export const LOG_DIR = resolve(ROOT, "agents/logs");

/** Loads the repo-root .env into process.env (existing values win). */
export function loadEnv(): void {
  const file = resolve(ROOT, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}

export function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

export function keyPath(name: string): string {
  return resolve(ROOT, "keys", `${name}.json`);
}

export function connection(): Connection {
  return new Connection(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
}

/** Program client from the deployed IDL, signing as `keypair`. */
export function programFor(keypair: Keypair): Program {
  const idlPath = process.env.PROGRAM_IDL ?? resolve(ROOT, "target/idl/proof_bounty.json");
  const idl = JSON.parse(readFileSync(idlPath, "utf8")) as Idl;
  const provider = new AnchorProvider(connection(), new Wallet(keypair), { commitment: "confirmed" });
  return new Program(idl, provider);
}

export async function fetchBounty(program: Program, address: PublicKey): Promise<Bounty> {
  return (program.account as any).bounty.fetch(address);
}

/** Fetches the statement and confirms it matches the on-chain theorem_hash. */
export async function fetchStatement(bounty: Bounty): Promise<string> {
  const statement = await getBlob(bounty.statementUri);
  const expected = Buffer.from(bounty.theoremHash).toString("hex");
  if (sha256Hex(statement) !== expected) throw new Error("Statement does not match on-chain theorem_hash");
  return statement;
}

export interface Submitted {
  submission: PublicKey;
  signature: string;
  proofUri: string;
  transaction: string;
}

/** Uploads the proof to the store and calls `submit_proof` from `solver`. */
export async function uploadAndSubmit(
  program: Program,
  solver: Keypair,
  bounty: PublicKey,
  proof: string,
): Promise<Submitted> {
  const { uri } = await putBlob(proof);
  const [submission] = submissionPda(bounty, solver.publicKey, program.programId);
  const signature = await program.methods
    .submitProof(sha256Bytes(proof), uri)
    .accountsPartial({ solver: solver.publicKey, bounty, submission })
    .signers([solver])
    .rpc();
  return { submission, signature, proofUri: uri, transaction: explorerTx(signature) };
}

/** Prints a JSON log line and appends it to agents/logs/<agent>.jsonl. */
export function logger(agent: string): (entry: Record<string, unknown>) => void {
  mkdirSync(LOG_DIR, { recursive: true });
  const file = resolve(LOG_DIR, `${agent}.jsonl`);
  return (entry) => {
    const line = JSON.stringify({ time: new Date().toISOString(), agent, ...entry });
    console.log(line);
    appendFileSync(file, line + "\n");
  };
}

/** Bounty address from argv[2] or BOUNTY. */
export function bountyArg(): PublicKey {
  const value = process.argv[2] ?? process.env.BOUNTY;
  if (!value) throw new Error("usage: <agent> <bounty-address>  (or set BOUNTY)");
  return new PublicKey(value);
}
