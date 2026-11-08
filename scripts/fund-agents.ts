// Creates keypairs for the agents and verifiers under keys/ (gitignored) and
// tops each up to TARGET_SOL on devnet.
//
// Default: transfer from the funded wallet (FUNDER_KEYPAIR, default
// ~/.config/solana/id.json). With --airdrop, request devnet airdrops first,
// retrying with backoff on rate limits, and fall back to a transfer.
//
//   npx tsx scripts/fund-agents.ts [--airdrop]
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, SystemProgram, Transaction,
} from "@solana/web3.js";
import { connection, keyPath, loadEnv, loadKeypair, ROOT } from "../agents/common";

const NAMES = ["honest", "cheater-0", "cheater-1", "cheater-2", "verifier-0", "verifier-1", "verifier-2"];
const TARGET_SOL = Number(process.env.TARGET_SOL ?? 0.05);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ensureKeypair(name: string): Keypair {
  const path = keyPath(name);
  if (existsSync(path)) return loadKeypair(path);
  const kp = Keypair.generate();
  writeFileSync(path, JSON.stringify([...kp.secretKey]), { mode: 0o600 });
  return kp;
}

async function airdrop(to: PublicKey, lamports: number): Promise<boolean> {
  const conn = connection();
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const sig = await conn.requestAirdrop(to, lamports);
      await conn.confirmTransaction(sig, "confirmed");
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`  airdrop attempt ${attempt} failed: ${msg.slice(0, 120)}`);
      await sleep(2_000 * 2 ** attempt);
    }
  }
  return false;
}

async function main(): Promise<void> {
  loadEnv();
  const useAirdrop = process.argv.includes("--airdrop");
  mkdirSync(resolve(ROOT, "keys"), { recursive: true, mode: 0o700 });
  const conn = connection();
  const funder = loadKeypair(process.env.FUNDER_KEYPAIR ?? resolve(homedir(), ".config/solana/id.json"));
  const target = Math.round(TARGET_SOL * LAMPORTS_PER_SOL);

  for (const name of NAMES) {
    const kp = ensureKeypair(name);
    const balance = await conn.getBalance(kp.publicKey);
    const need = target - balance;
    if (need <= 0) {
      console.log(`${name.padEnd(11)} ${kp.publicKey.toBase58()}  ${balance / LAMPORTS_PER_SOL} SOL (ok)`);
      continue;
    }
    if (useAirdrop && (await airdrop(kp.publicKey, need))) {
      console.log(`${name.padEnd(11)} ${kp.publicKey.toBase58()}  +${need / LAMPORTS_PER_SOL} SOL (airdrop)`);
      continue;
    }
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: kp.publicKey, lamports: need }),
    );
    const sig = await sendAndConfirmTransaction(conn, tx, [funder], { commitment: "confirmed" });
    console.log(`${name.padEnd(11)} ${kp.publicKey.toBase58()}  +${need / LAMPORTS_PER_SOL} SOL (transfer ${sig.slice(0, 16)}…)`);
  }
  console.log(`funder ${funder.publicKey.toBase58()} now has ${(await conn.getBalance(funder.publicKey)) / LAMPORTS_PER_SOL} SOL`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
