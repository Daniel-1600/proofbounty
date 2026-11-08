import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { createHash } from "crypto";
import { expect } from "chai";
import type { ProofBounty } from "../target/types/proof_bounty";
import {
  bountyStatusFilter, listAccounts, submissionBountyFilter, submissionStatusFilter,
} from "../shared/src";

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const program = anchor.workspace.ProofBounty as Program<ProofBounty>;
const connection = provider.connection;

const STATEMENT = "∀ (n : Nat), n + 0 = n";
const sha = (s: string) => [...createHash("sha256").update(s, "utf8").digest()];
const REWARD = new BN(0.5 * LAMPORTS_PER_SOL);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function funded(sol = 2): Promise<Keypair> {
  const kp = Keypair.generate();
  const sig = await connection.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
  return kp;
}

const bountyPda = (creator: PublicKey, id: BN) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("bounty"), creator.toBuffer(), id.toArrayLike(Buffer, "le", 8)],
    program.programId,
  )[0];
const submissionPda = (bounty: PublicKey, solver: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("sub"), bounty.toBuffer(), solver.toBuffer()],
    program.programId,
  )[0];

async function expectError(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e: any) {
    const got = e?.error?.errorCode?.code ?? String(e);
    expect(got).to.include(code);
    return;
  }
  expect.fail(`expected ${code}`);
}

let nextId = 1;
interface Ctx {
  creator: Keypair;
  verifiers: Keypair[];
  bounty: PublicKey;
}

async function newBounty(deadlineSecs = 3600): Promise<Ctx> {
  const creator = await funded(3);
  const verifiers = await Promise.all([funded(1), funded(1), funded(1)]);
  const id = new BN(nextId++);
  const bounty = bountyPda(creator.publicKey, id);
  const deadline = new BN(Math.floor(Date.now() / 1000) + deadlineSecs);
  await program.methods
    .createBounty(
      id,
      sha(STATEMENT),
      "http://localhost:8787/blob/x",
      REWARD,
      deadline,
      verifiers.map((v) => v.publicKey) as [PublicKey, PublicKey, PublicKey],
    )
    .accountsPartial({ creator: creator.publicKey, bounty, systemProgram: SystemProgram.programId })
    .signers([creator])
    .rpc();
  return { creator, verifiers, bounty };
}

async function submit(ctx: Ctx, solver: Keypair): Promise<PublicKey> {
  const submission = submissionPda(ctx.bounty, solver.publicKey);
  await program.methods
    .submitProof(sha("by simp"), "http://localhost:8787/blob/y")
    .accountsPartial({ solver: solver.publicKey, bounty: ctx.bounty, submission })
    .signers([solver])
    .rpc();
  return submission;
}

function vote(ctx: Ctx, verifier: Keypair, submission: PublicKey, solver: PublicKey, approve: boolean) {
  return program.methods
    .vote(approve)
    .accountsPartial({ verifier: verifier.publicKey, bounty: ctx.bounty, submission, solver })
    .signers([verifier])
    .rpc();
}

describe("proof_bounty", () => {
  it("happy path pays the solver", async () => {
    const ctx = await newBounty();
    const escrowed = await connection.getBalance(ctx.bounty);
    const solver = await funded(1);
    const sub = await submit(ctx, solver);
    const before = await connection.getBalance(solver.publicKey);

    await vote(ctx, ctx.verifiers[0], sub, solver.publicKey, true);
    await vote(ctx, ctx.verifiers[2], sub, solver.publicKey, true);

    const s = await program.account.submission.fetch(sub);
    const b = await program.account.bounty.fetch(ctx.bounty);
    expect(s.status).to.deep.equal({ accepted: {} });
    expect(s.approvals).to.equal(0b101);
    expect(b.status).to.deep.equal({ solved: {} });
    expect(b.winner!.toBase58()).to.equal(solver.publicKey.toBase58());
    expect(await connection.getBalance(solver.publicKey)).to.equal(before + REWARD.toNumber());

    // Bounty PDA keeps exactly its rent-exempt minimum.
    const info = await connection.getAccountInfo(ctx.bounty);
    const rent = await connection.getMinimumBalanceForRentExemption(info!.data.length);
    expect(info!.lamports).to.equal(rent);
    expect(escrowed).to.equal(rent + REWARD.toNumber());
  });

  it("rejects a submission on 2 rejections", async () => {
    const ctx = await newBounty();
    const solver = await funded(1);
    const sub = await submit(ctx, solver);
    const before = await connection.getBalance(solver.publicKey);

    await vote(ctx, ctx.verifiers[0], sub, solver.publicKey, false);
    await vote(ctx, ctx.verifiers[1], sub, solver.publicKey, false);

    const s = await program.account.submission.fetch(sub);
    expect(s.status).to.deep.equal({ rejected: {} });
    expect(s.rejections).to.equal(0b011);
    expect((await program.account.bounty.fetch(ctx.bounty)).status).to.deep.equal({ open: {} });
    expect(await connection.getBalance(solver.publicKey)).to.equal(before);
  });

  it("fails a vote from a non-verifier", async () => {
    const ctx = await newBounty();
    const solver = await funded(1);
    const sub = await submit(ctx, solver);
    const outsider = await funded(1);
    await expectError(vote(ctx, outsider, sub, solver.publicKey, true), "NotVerifier");
  });

  it("fails a double vote", async () => {
    const ctx = await newBounty();
    const solver = await funded(1);
    const sub = await submit(ctx, solver);
    await vote(ctx, ctx.verifiers[1], sub, solver.publicKey, true);
    await expectError(vote(ctx, ctx.verifiers[1], sub, solver.publicKey, true), "AlreadyVoted");
    await expectError(vote(ctx, ctx.verifiers[1], sub, solver.publicKey, false), "AlreadyVoted");
  });

  it("fails a vote on an already-solved bounty", async () => {
    const ctx = await newBounty();
    const winner = await funded(1);
    const loser = await funded(1);
    const winSub = await submit(ctx, winner);
    const loseSub = await submit(ctx, loser);
    await vote(ctx, ctx.verifiers[0], winSub, winner.publicKey, true);
    await vote(ctx, ctx.verifiers[1], winSub, winner.publicKey, true);
    await expectError(vote(ctx, ctx.verifiers[0], loseSub, loser.publicKey, true), "BountyNotOpen");
    await expectError(vote(ctx, ctx.verifiers[2], winSub, winner.publicKey, true), "BountyNotOpen");
  });

  it("refunds the creator after the deadline", async () => {
    const ctx = await newBounty(2);
    const refund = () =>
      program.methods
        .refund()
        .accountsPartial({ creator: ctx.creator.publicKey, bounty: ctx.bounty })
        .signers([ctx.creator])
        .rpc();

    await expectError(refund(), "DeadlineNotReached");
    await sleep(4000);
    const before = await connection.getBalance(ctx.creator.publicKey);
    await refund();
    const b = await program.account.bounty.fetch(ctx.bounty);
    expect(b.status).to.deep.equal({ refunded: {} });
    // Creator pays the tx fee, so allow for it.
    const after = await connection.getBalance(ctx.creator.publicKey);
    expect(after).to.be.greaterThan(before + REWARD.toNumber() - 10_000);
    await expectError(refund(), "BountyNotOpen");
  });

  it("filters accounts by status with memcmp at fixed offsets", async () => {
    const ctx = await newBounty();
    const a = await funded(1);
    const b = await funded(1);
    const subA = await submit(ctx, a);
    const subB = await submit(ctx, b);
    await vote(ctx, ctx.verifiers[0], subA, a.publicKey, false);
    await vote(ctx, ctx.verifiers[1], subA, a.publicKey, false);

    const keys = (rows: { publicKey: PublicKey }[]) => rows.map((r) => r.publicKey.toBase58());
    const forBounty = submissionBountyFilter(ctx.bounty);
    expect(keys(await listAccounts(program as any, "submission", [forBounty, submissionStatusFilter("pending")]))).to.deep.equal([subB.toBase58()]);
    expect(keys(await listAccounts(program as any, "submission", [forBounty, submissionStatusFilter("rejected")]))).to.deep.equal([subA.toBase58()]);
    expect(keys(await listAccounts(program as any, "bounty", [bountyStatusFilter("open")]))).to.include(ctx.bounty.toBase58());

    await vote(ctx, ctx.verifiers[0], subB, b.publicKey, true);
    await vote(ctx, ctx.verifiers[1], subB, b.publicKey, true);
    expect(keys(await listAccounts(program as any, "bounty", [bountyStatusFilter("open")]))).not.to.include(ctx.bounty.toBase58());
    expect(keys(await listAccounts(program as any, "bounty", [bountyStatusFilter("solved")]))).to.include(ctx.bounty.toBase58());
  });
});
