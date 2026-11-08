import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { explorerTx, getBlob, putBlob, sha256Hex, statusName, submissionPda } from "@proofbounty/shared";
import type { Bounty, PutBlobResponse, Submission } from "@proofbounty/shared";
import { checkProof } from "../checker/src/checkProof";

// agents/submitter.ts does not exist in this checkout. Keep this small contract
// here until the real adapter lands; callers can inject it without chain access.
export interface Submitter {
  upload(proof: string): Promise<PutBlobResponse>;
  submit(bounty: string, proofHash: string, uri: string): Promise<unknown>;
}

export function cheatingProofs(statement: string) {
  return [
    { name: "sorry", token: "sorry", proof: "by\n  sorry" },
    { name: "native_decide", token: "native_decide", proof: "by\n  native_decide" },
    // Try to escape the proof body and insert a new trusted declaration.
    { name: "smuggled axiom", token: "axiom", proof: `by\n  exact injected\naxiom /- trusted shortcut -/ injected : (${statement})` },
  ];
}

/** Deliberately submit rejected proofs so independent verifiers can reject them. */
export async function runCheater(
  bounty: string,
  statement: string,
  submitter?: Submitter | ((index: number) => Promise<Submitter>),
  options: { dryRun?: boolean; theoremHash?: readonly number[]; log?: (line: string) => void } = {},
): Promise<void> {
  const log = options.log ?? console.log;
  for (const [index, cheat] of cheatingProofs(statement).entries()) {
    const result = await checkProof(statement, cheat.proof, { theoremHash: options.theoremHash });
    log(`[${index + 1}/3] ${cheat.name}: ${result.ok ? "ACCEPTED" : "REJECTED"} locally — ${result.reason}`);
    // A sandbox outage or a different failure is not evidence that the cheat was caught.
    if (result.ok || result.reason !== `Banned token in proof: ${cheat.token}`) {
      throw new Error(`Unexpected checker result for ${cheat.name}: ${result.reason}`);
    }
    if (options.dryRun) continue;
    if (!submitter) throw new Error("A Submitter is required unless --dry-run is set");
    const adapter = typeof submitter === "function" ? await submitter(index) : submitter;
    const blob = await adapter.upload(cheat.proof);
    if (blob.hash !== sha256Hex(cheat.proof)) throw new Error("Uploaded proof hash mismatch");
    log(`${cheat.name}: uploaded ${blob.hash}`);
    const receipt = await adapter.submit(bounty, blob.hash, blob.uri);
    log(`${cheat.name}: submitted ${typeof receipt === "string" ? explorerTx(receipt) : JSON.stringify(receipt) ?? ""}`);
  }
}

const root = resolve(__dirname, "..");
const placeholderId = "Fg6PaFpoGXkYsidMpWTK6W2BmZ7FEfcYkg476zPFsLnS";

async function loadKeypair(path: string): Promise<Keypair> {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(path, "utf8"))));
}

/** Fallback adapter; each submit waits for a quorum rejection before returning. */
function anchorSubmitter(program: Program, solver: Keypair, timeoutMs: number): Submitter {
  return {
    upload: proof => putBlob(proof),
    async submit(address, proofHash, uri) {
      if (!/^[a-f0-9]{64}$/.test(proofHash)) throw new Error("Invalid proof hash");
      const bounty = new PublicKey(address);
      const [submission] = submissionPda(bounty, solver.publicKey, program.programId);
      const signature = await program.methods.submitProof([...Buffer.from(proofHash, "hex")], uri).accountsStrict({
        solver: solver.publicKey, bounty, submission, systemProgram: SystemProgram.programId,
      }).rpc();
      console.log(`Submission: ${submission.toBase58()} ${explorerTx(signature)}`);
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const account = await (program.account as any).submission.fetch(submission) as Submission;
        const status = statusName(account.status);
        if (status === "rejected" && [0, 1, 2].filter(i => account.rejections & (1 << i)).length >= 2) {
          console.log(`REJECTED on-chain: ${submission.toBase58()} (rejections=${account.rejections})`);
          return signature;
        }
        if (status !== "pending") throw new Error(`Cheat unexpectedly ${status} on-chain`);
        await delay(3_000);
      }
      throw new Error(`Timed out waiting for rejection of ${submission.toBase58()}; inspect logs/verifier-*.log`);
    },
  };
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  let bounty = process.env.BOUNTY ?? "";
  let statementFile: string | undefined;
  let demoTheorem: string | undefined;
  let dryRun = false;
  let keyPaths = (process.env.CHEATER_KEYPAIRS ?? "keys/cheater-0.json,keys/cheater-1.json,keys/cheater-2.json").split(",");
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--help") {
      console.log("Usage: cheater-agent <bounty> [--keypairs file0,file1,file2]\n       cheater-agent --dry-run --demo-theorem lean/demo/nat_add_zero.lean\n       cheater-agent --dry-run --statement-file statement.txt\nLive mode needs three distinct funded solver wallets and a deployed PROGRAM_IDL.");
      return;
    } else if (["--bounty", "--statement-file", "--demo-theorem", "--keypairs"].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      if (arg === "--bounty") bounty = value;
      else if (arg === "--statement-file") statementFile = value;
      else if (arg === "--demo-theorem") demoTheorem = value;
      else keyPaths = value.split(",");
    } else if (!arg.startsWith("-") && !bounty) bounty = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (statementFile && demoTheorem) throw new Error("Choose --statement-file or --demo-theorem");
  if (!dryRun && (statementFile || demoTheorem)) throw new Error("Live mode fetches the committed statement from the bounty");
  if (dryRun && (statementFile || demoTheorem)) {
    let statement = await readFile(resolve(statementFile ?? demoTheorem!), "utf8");
    if (demoTheorem) {
      const match = /^theorem target : ([\s\S]+?) :=[\s\S]+\n#print axioms target\s*$/.exec(statement);
      if (!match) throw new Error("Demo file must contain theorem target : <statement> := <proof>");
      statement = match[1];
    }
    await runCheater(bounty || "local-demo", statement, undefined, { dryRun: true });
    return;
  }
  if (!bounty) throw new Error("Provide a bounty, or use --dry-run --demo-theorem <file>");
  const timeoutMs = Number(process.env.DEMO_TIMEOUT_MS ?? 180_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("DEMO_TIMEOUT_MS must be positive");
  if (keyPaths.length !== 3 || keyPaths.some(path => !path)) throw new Error("--keypairs requires three keypair files");
  // Dry-run against a live bounty is read-only and does not require solver secrets.
  const solvers = dryRun ? [] : await Promise.all(keyPaths.map(path => loadKeypair(resolve(root, path))));
  if (!dryRun && new Set(solvers.map(key => key.publicKey.toBase58())).size !== 3) {
    throw new Error("Three distinct wallets are required: submission PDA is seeded by bounty and solver");
  }
  const idl = JSON.parse(await readFile(process.env.PROGRAM_IDL ?? resolve(root, "target/idl/proof_bounty.json"), "utf8")) as Idl;
  if (!idl.address || idl.address === placeholderId) throw new Error("TODO: deploy the program and set PROGRAM_IDL to its generated IDL");
  const connection = new Connection(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
  const programFor = (solver: Keypair) => new Program(idl, new AnchorProvider(connection, new Wallet(solver), { commitment: "confirmed" }));
  const program = programFor(solvers[0] ?? Keypair.generate());
  const account = await (program.account as any).bounty.fetch(new PublicKey(bounty)) as Bounty;
  const statement = await getBlob(account.statementUri);
  if (sha256Hex(statement) !== Buffer.from(account.theoremHash).toString("hex")) throw new Error("Statement hash mismatch");
  if (!dryRun && statusName(account.status) !== "open") throw new Error("Bounty is not open");
  // Optional runtime adapter contract: createSubmitter({keypair, program, storeUrl}).
  const modulePath = process.env.SUBMITTER_MODULE ?? resolve(root, "agents/submitter.ts");
  const factory = !dryRun && existsSync(modulePath) ? require(resolve(modulePath)).createSubmitter : undefined;
  if (!dryRun && existsSync(modulePath) && typeof factory !== "function") {
    throw new Error("SUBMITTER_MODULE must export createSubmitter({keypair, program, storeUrl})");
  }
  await runCheater(bounty, statement, async index => {
    const solver = solvers[index];
    const client = programFor(solver);
    if (factory) return await factory({ keypair: solver, program: client, storeUrl: process.env.STORE_URL }) as Submitter;
    return anchorSubmitter(client, solver, timeoutMs);
  }, { dryRun, theoremHash: account.theoremHash });
}

if (require.main === module) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
