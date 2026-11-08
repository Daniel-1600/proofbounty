// Cheater agent: scripted, plausible-looking proofs that cheat. Each attempt
// is a separate submission from its own keypair (the Submission PDA is
// [b"sub", bounty, solver], so one solver gets one submission per bounty).
// The verifiers must reject all three; this agent is never paid.
//
//   npm -w agents run cheater -- <bounty-address>
import {
  bountyArg, fetchBounty, fetchStatement, keyPath, loadEnv, loadKeypair, logger, programFor, runMain, uploadAndSubmit,
} from "./common";

export interface Cheat {
  name: string;
  /** What should stop it. */
  caughtBy: string;
  proof: string;
}

export const CHEATS: Cheat[] = [
  {
    name: "sorry",
    caughtBy: "banned token before Lean runs",
    proof: ["by", "  intro l", "  -- the general case follows by induction", "  sorry"].join("\n"),
  },
  {
    name: "native_decide",
    caughtBy: "banned token before Lean runs",
    proof: ["by", "  -- decidable, so let the compiler evaluate it", "  native_decide"].join("\n"),
  },
  {
    // `sorryAx` is the axiom behind `sorry`. The name is not a banned token,
    // so this reaches Lean, compiles, and is caught by the `#print axioms` audit.
    name: "smuggled axiom",
    caughtBy: "#print axioms audit (sorryAx is not allowed)",
    proof: ["by", "  -- reuse the library lemma", "  exact sorryAx _ false"].join("\n"),
  },
];

async function main(): Promise<void> {
  loadEnv();
  const log = logger("cheater");
  const bounty = bountyArg();

  let statementLogged = false;
  for (const [i, cheat] of CHEATS.entries()) {
    const solver = loadKeypair(keyPath(`cheater-${i}`));
    const program = programFor(solver);
    if (!statementLogged) {
      const statement = await fetchStatement(await fetchBounty(program, bounty));
      log({ event: "start", bounty: bounty.toBase58(), statement });
      statementLogged = true;
    }
    try {
      const submitted = await uploadAndSubmit(program, solver, bounty, cheat.proof);
      log({
        event: "submitted", cheat: cheat.name, expectedCaughtBy: cheat.caughtBy,
        bounty: bounty.toBase58(), solver: solver.publicKey.toBase58(), proof: cheat.proof,
        submission: submitted.submission.toBase58(), proofUri: submitted.proofUri,
        signature: submitted.signature, transaction: submitted.transaction,
      });
    } catch (error) {
      log({ event: "submit-failed", cheat: cheat.name, reason: error instanceof Error ? error.message : String(error) });
    }
  }
}

if (require.main === module) runMain(main);
