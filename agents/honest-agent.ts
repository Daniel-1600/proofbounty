// Honest agent: asks the model for a proof body, checks it locally with the
// hardened checker, feeds Lean's errors back on failure (up to 6 attempts),
// then uploads the proof and calls `submit_proof` from its own keypair.
//
//   npm -w agents run honest -- <bounty-address>
//   npm -w agents run honest -- --local "<lean statement>"   (no chain, no store)
import { checkProof } from "../checker/src/checkProof";
import {
  bountyArg, fetchBounty, fetchStatement, keyPath, loadEnv, loadKeypair, logger,
  programFor, uploadAndSubmit,
} from "./common";
import { cleanProof, generate, modelName } from "./llm";

export const MAX_ATTEMPTS = 6;
const MAX_FEEDBACK_CHARS = 4_000;

type Log = (entry: Record<string, unknown>) => void;

export interface Solved {
  proof: string;
  attempts: number;
  model: string;
}

function firstPrompt(statement: string): string {
  return [
    "You are proving a theorem in Lean 4 core (no Mathlib, no imports).",
    "The checker compiles exactly:",
    "",
    `theorem target : ${statement} := <YOUR PROOF>`,
    "",
    "Reply with ONLY the proof body that replaces <YOUR PROOF>, usually starting with `by`.",
    "Do not repeat the theorem statement. Do not use sorry, admit, axiom, native_decide,",
    "set_option, attributes, or any new declarations. No explanation.",
  ].join("\n");
}

function retryPrompt(statement: string, proof: string, reason: string, leanOutput: string): string {
  return [
    firstPrompt(statement),
    "",
    "Your previous proof was rejected.",
    "Previous proof:",
    proof,
    "",
    `Checker reason: ${reason}`,
    "Lean output:",
    leanOutput.slice(0, MAX_FEEDBACK_CHARS) || "(none)",
    "",
    "Reply with a corrected proof body only.",
  ].join("\n");
}

/** Model + checker loop. Returns the accepted proof, or null after MAX_ATTEMPTS. */
export async function solve(
  statement: string,
  log: Log,
  theoremHash?: readonly number[],
): Promise<Solved | null> {
  const model = modelName();
  let prompt = firstPrompt(statement);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let raw: string;
    try {
      raw = await generate(prompt);
    } catch (error) {
      log({ event: "llm-error", attempt, model, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const proof = cleanProof(raw);
    const result = await checkProof(statement, proof, theoremHash ? { theoremHash } : {});
    log({
      event: "attempt", attempt, model, proof, ok: result.ok, reason: result.reason,
      axioms: result.axioms, leanOutput: result.ok ? undefined : result.leanOutput.slice(0, MAX_FEEDBACK_CHARS),
    });
    if (result.ok) return { proof, attempts: attempt, model };
    prompt = retryPrompt(statement, proof, result.reason, result.leanOutput);
  }
  return null;
}

async function main(): Promise<void> {
  loadEnv();
  const log = logger("honest");

  if (process.argv[2] === "--local") {
    const statement = process.argv[3];
    if (!statement) throw new Error('usage: honest-agent --local "<statement>"');
    const solved = await solve(statement, log);
    log({ event: solved ? "solved-local" : "gave-up", statement, ...solved });
    if (!solved) process.exitCode = 1;
    return;
  }

  const bounty = bountyArg();
  const solver = loadKeypair(process.env.AGENT_KEYPAIR ?? keyPath("honest"));
  const program = programFor(solver);
  const account = await fetchBounty(program, bounty);
  const statement = await fetchStatement(account);
  log({ event: "start", bounty: bounty.toBase58(), solver: solver.publicKey.toBase58(), statement, model: modelName() });

  const solved = await solve(statement, log, account.theoremHash);
  if (!solved) {
    log({ event: "gave-up", bounty: bounty.toBase58(), attempts: MAX_ATTEMPTS });
    process.exitCode = 1;
    return;
  }
  const submitted = await uploadAndSubmit(program, solver, bounty, solved.proof);
  log({
    event: "submitted", bounty: bounty.toBase58(), solver: solver.publicKey.toBase58(),
    model: solved.model, attempts: solved.attempts, proof: solved.proof,
    submission: submitted.submission.toBase58(), proofUri: submitted.proofUri,
    signature: submitted.signature, transaction: submitted.transaction,
  });
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
