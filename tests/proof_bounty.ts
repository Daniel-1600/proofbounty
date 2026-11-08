import * as anchor from "@coral-xyz/anchor";

describe("proof_bounty", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  it.skip("happy path pays the solver", async () => {});
  it.skip("rejects a submission on 2 rejections", async () => {});
  it.skip("fails a vote from a non-verifier", async () => {});
  it.skip("fails a double vote", async () => {});
  it.skip("fails a vote on a solved bounty", async () => {});
  it.skip("refunds the creator after the deadline", async () => {});
});
