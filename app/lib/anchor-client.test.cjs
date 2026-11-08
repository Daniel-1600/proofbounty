const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
};
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { BN, Program } = require("@coral-xyz/anchor");
const { Connection, Keypair, PublicKey, Transaction } = require("@solana/web3.js");
const idl = require("./idl/proof_bounty.json");

test("real Anchor IDL decodes accounts, filters proofs, uploads exact bytes and signs escrow creation", async (t) => {
  process.env.NEXT_PUBLIC_PROGRAM_ID = idl.address;
  const creator = Keypair.generate();
  const verifiers = [Keypair.generate(), Keypair.generate(), Keypair.generate()].map((key) => key.publicKey);
  process.env.NEXT_PUBLIC_VERIFIERS = verifiers.join(",");
  const program = new Program(idl, { connection: new Connection("http://localhost:8899") });
  const { anchorClient } = require("./anchor-client.ts");
  const statement = "  ∀ (n : Nat), n + 0 = n\n";
  const proof = "by intro n; exact Nat.add_zero n";
  const hash = (text) => [...createHash("sha256").update(text).digest()];
  const bountyAddress = Keypair.generate().publicKey;
  const submissionAddress = Keypair.generate().publicKey;
  const bounty = {
    creator: creator.publicKey, bountyId: new BN(7), theoremHash: hash(statement),
    statementUri: "http://localhost:8787/blob/statement", reward: new BN(1000),
    deadline: new BN(Math.floor(Date.now() / 1000) + 3600), verifiers,
    status: { open: {} }, winner: null, bump: 254,
  };
  const submission = {
    bounty: bountyAddress, solver: Keypair.generate().publicKey, proofHash: hash(proof),
    proofUri: "http://localhost:8787/blob/proof", approvals: 5, rejections: 2,
    status: { accepted: {} }, bump: 253,
  };
  const info = async (name, account) => ({
    data: await program.coder.accounts.encode(name, account), owner: program.programId,
    executable: false, lamports: 10000, rentEpoch: 0,
  });
  let created;
  t.mock.method(Connection.prototype, "getAccountInfoAndContext", async function (key) {
    const value = key.equals(bountyAddress) ? bounty : created?.address.equals(key) ? created.account : null;
    return { context: { slot: 1 }, value: value ? await info("bounty", value) : null };
  });
  t.mock.method(Connection.prototype, "getProgramAccounts", async function (key, options) {
    assert.equal(key.toBase58(), idl.address);
    if (options.filters.length === 1) return [{ pubkey: bountyAddress, account: await info("bounty", bounty) }];
    assert.deepEqual(options.filters[1], { memcmp: { offset: 8, bytes: bountyAddress.toBase58() } });
    return [{ pubkey: submissionAddress, account: await info("submission", submission) }];
  });
  let upload;
  t.mock.method(globalThis, "fetch", async (uri, options) => {
    if (options?.method === "POST") {
      upload = options.body;
      const digest = createHash("sha256").update(upload).digest("hex");
      return Response.json({ hash: digest, uri: `http://localhost:8787/blob/${digest}` });
    }
    return new Response(uri.endsWith("/proof") ? proof : statement);
  });
  const [view] = await anchorClient.listBounties();
  assert.equal(view.statement, statement);
  assert.ok(BN.isBN(view.reward));
  assert.equal(view.transaction, "");
  assert.equal(await anchorClient.getBounty(Keypair.generate().publicKey.toBase58()), null);
  const [proofView] = await anchorClient.listSubmissions(bountyAddress.toBase58());
  assert.equal(proofView.proof, proof);
  assert.deepEqual(proofView.votes.map((vote) => vote.approve), [true, false, true]);
  assert.deepEqual(proofView.votes.map((vote) => vote.verifier.toBase58()), verifiers.map((key) => key.toBase58()));

  const blockhash = Keypair.generate().publicKey.toBase58();
  t.mock.method(Connection.prototype, "getLatestBlockhash", async () => ({ blockhash, lastValidBlockHeight: 100 }));
  t.mock.method(Connection.prototype, "sendRawTransaction", async (bytes) => {
    const tx = Transaction.from(bytes);
    assert.ok(tx.verifySignatures());
    assert.ok(tx.feePayer.equals(creator.publicKey));
    const instruction = tx.instructions[0];
    const decoded = program.coder.instruction.decode(instruction.data);
    assert.equal(decoded.name, "createBounty");
    assert.deepEqual(decoded.data.theoremHash, hash(statement));
    assert.equal(decoded.data.reward.toString(), "1000");
    assert.equal(decoded.data.deadline.toString(), bounty.deadline.toString());
    assert.deepEqual(decoded.data.verifiers.map((key) => key.toBase58()), verifiers.map((key) => key.toBase58()));
    const [address] = PublicKey.findProgramAddressSync([
      Buffer.from("bounty"), creator.publicKey.toBuffer(), decoded.data.bountyId.toArrayLike(Buffer, "le", 8),
    ], program.programId);
    assert.ok(instruction.keys[1].pubkey.equals(address));
    created = { address, account: { ...bounty, bountyId: decoded.data.bountyId, statementUri: decoded.data.statementUri } };
    return "confirmed-signature";
  });
  t.mock.method(Connection.prototype, "confirmTransaction", async (strategy) => {
    assert.equal(strategy.signature, "confirmed-signature");
    assert.equal(strategy.blockhash, blockhash);
    return { value: { err: null } };
  });
  const input = {
    creator: creator.publicKey, statement, reward: bounty.reward, deadline: bounty.deadline,
    signTransaction: async (tx) => { tx.partialSign(creator); return tx; },
  };
  const result = await anchorClient.createBounty(input);
  assert.equal(upload, statement);
  assert.equal(result.transaction, "confirmed-signature");
  assert.ok(result.createdAt > 0);
  await assert.rejects(anchorClient.createBounty({ ...input, reward: new BN(0) }), /positive u64/);
  await assert.rejects(anchorClient.createBounty({ ...input, signTransaction: undefined }), /transaction signing/);

  t.mock.timers.enable({ apis: ["setTimeout"] });
  const updates = [];
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const stop = anchorClient.subscribe(bountyAddress.toBase58(), (update) => updates.push(update));
  await settle(); await settle();
  assert.equal(updates.length, 1);
  t.mock.timers.tick(3000); await settle(); await settle();
  assert.equal(updates.length, 2);
  stop(); t.mock.timers.tick(6000); await settle();
  assert.equal(updates.length, 2);
  const errors = [];
  const cleanup = anchorClient.subscribe(Keypair.generate().publicKey.toBase58(), (update) => errors.push(update));
  await settle(); await settle();
  assert.ok(errors[0] instanceof Error);
  cleanup();
});
