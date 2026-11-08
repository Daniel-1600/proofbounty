// Posts a bounty: uploads the statement to the store, hashes it and calls
// `create_bounty` with keys/verifier-{0,1,2}.json as the verifiers.
// Prints the bounty address on the last line of stdout.
//
//   npx tsx scripts/post-bounty.ts <statement-or-.lean-file> [reward SOL=0.1] [deadline minutes=60]
//
// A .lean file from lean/demo/ is accepted: the statement is the text between
// "theorem target : " and " :=".
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { bountyPda, explorerTx, putBlob, sha256Bytes } from "@proofbounty/shared";
import {
  keyPath, loadEnv, loadKeypair, programFor, runMain,
} from "../agents/common";

export function statementFrom(arg: string): string {
  if (!arg.endsWith(".lean") || !existsSync(arg)) return arg;
  const source = readFileSync(arg, "utf8");
  const match = /theorem\s+target\s*:\s*([\s\S]*?)\s*:=/.exec(source);
  if (!match) throw new Error(`no "theorem target : ... :=" in ${arg}`);
  return match[1];
}

async function main(): Promise<void> {
  loadEnv();
  const [arg, rewardSol = "0.1", minutes = "60"] = process.argv.slice(2);
  if (!arg) throw new Error("usage: post-bounty <statement|file.lean> [rewardSol] [deadlineMinutes]");
  const statement = statementFrom(arg);
  const creator = loadKeypair(process.env.CREATOR_KEYPAIR ?? resolve(homedir(), ".config/solana/id.json"));
  const program = programFor(creator);
  const verifiers = [0, 1, 2].map((i) => loadKeypair(keyPath(`verifier-${i}`)).publicKey) as [PublicKey, PublicKey, PublicKey];

  const { uri } = await putBlob(statement);
  const bountyId = new BN(Date.now());
  const [bounty] = bountyPda(creator.publicKey, bountyId, program.programId);
  const signature = await program.methods
    .createBounty(
      bountyId,
      sha256Bytes(statement),
      uri,
      new BN(Math.round(Number(rewardSol) * LAMPORTS_PER_SOL)),
      new BN(Math.floor(Date.now() / 1000) + Number(minutes) * 60),
      verifiers,
    )
    .accountsPartial({ creator: creator.publicKey, bounty, systemProgram: SystemProgram.programId })
    .rpc();

  console.error(`statement: ${statement}`);
  console.error(`reward:    ${rewardSol} SOL, deadline in ${minutes} min`);
  console.error(`tx:        ${explorerTx(signature)}`);
  console.log(bounty.toBase58());
}

runMain(main);
