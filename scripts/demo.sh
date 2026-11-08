#!/usr/bin/env bash
# One command: store/verifiers -> bounty -> three rejections -> honest payout.
#   npx tsx scripts/fund-agents.ts   # once: keys/ for honest, cheaters, verifiers
#   bash scripts/demo.sh
# Needs the Azure settings and (optionally) SOLANA_RPC_URL in .env, the Lean
# toolchain, and target/idl/proof_bounty.json from `anchor build`.
# The creator defaults to keys/creator.json, else ~/.config/solana/id.json.
# Override CREATOR_KEYPAIR, HONEST_KEYPAIR, CHEATER_KEYPAIRS as needed.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
export PROGRAM_ID="${PROGRAM_ID:-28CYsLKihZfAQWz513EAEXS52hc9npL9frZw1VpPAz3i}"
export PROGRAM_IDL="${PROGRAM_IDL:-$PWD/target/idl/proof_bounty.json}"
export STORE_PORT="${STORE_PORT:-8787}"
export STORE_URL="${STORE_URL:-http://localhost:$STORE_PORT}"
export LOG_DIR="${LOG_DIR:-$PWD/logs}"
default_creator="$PWD/keys/creator.json"
[[ -f "$default_creator" ]] || default_creator="$HOME/.config/solana/id.json"
export CREATOR_KEYPAIR="${CREATOR_KEYPAIR:-$default_creator}"
export HONEST_KEYPAIR="${HONEST_KEYPAIR:-$PWD/keys/honest.json}"
export CHEATER_KEYPAIRS="${CHEATER_KEYPAIRS:-keys/cheater-0.json,keys/cheater-1.json,keys/cheater-2.json}"
export DEMO_THEOREM="${DEMO_THEOREM:-$PWD/lean/demo/nat_add_zero.lean}"
export REWARD_LAMPORTS="${REWARD_LAMPORTS:-10000000}"
export DEMO_TIMEOUT_MS="${DEMO_TIMEOUT_MS:-180000}"
export BOUNTY_ID="${BOUNTY_ID:-$(date +%s)}"
if [[ "$PROGRAM_ID" == TODO* || "$PROGRAM_ID" == Fg6PaFpoGXkYsidMpWTK6W2BmZ7FEfcYkg476zPFsLnS ]]; then
  echo "TODO: set PROGRAM_ID to the devnet deployment and PROGRAM_IDL to its generated IDL" >&2
  exit 1
fi

# Inline chain operations keep this demo self-contained without generated scripts.
chain() {
  DEMO_ACTION="$1" node --require tsx/cjs <<'NODE'
const fs = require('node:fs');
const { AnchorProvider, BN, EventParser, Program, Wallet } = require('@coral-xyz/anchor');
const { Connection, Keypair, PublicKey, SystemProgram } = require('@solana/web3.js');
const { bountyPda, submissionPda, putBlob, sha256Bytes, statusName, explorerTx } = require('./shared/src');
const loadKey = path => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, 'utf8'))));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const env = process.env;
  const creator = loadKey(env.CREATOR_KEYPAIR);
  const honest = loadKey(env.HONEST_KEYPAIR);
  const cheaters = env.CHEATER_KEYPAIRS.split(',').map(loadKey);
  const verifiers = [0, 1, 2].map(i => loadKey(`keys/verifier-${i}.json`));
  if (cheaters.length !== 3 || new Set([creator, honest, ...cheaters, ...verifiers].map(k => k.publicKey.toBase58())).size !== 8) {
    throw new Error('Creator, honest solver, three cheaters and three verifiers need distinct funded wallets');
  }
  const idl = JSON.parse(fs.readFileSync(env.PROGRAM_IDL, 'utf8'));
  if (idl.address !== env.PROGRAM_ID) throw new Error('PROGRAM_ID must match the deployed PROGRAM_IDL address');
  const connection = new Connection(env.SOLANA_RPC_URL, 'confirmed');
  const program = new Program(idl, new AnchorProvider(connection, new Wallet(creator), { commitment: 'confirmed' }));
  const timeout = Number(env.DEMO_TIMEOUT_MS);
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('DEMO_TIMEOUT_MS must be positive');
  const reward = new BN(env.REWARD_LAMPORTS);
  if (reward.lten(0)) throw new Error('REWARD_LAMPORTS must be positive');
  const source = fs.readFileSync(env.DEMO_THEOREM, 'utf8');
  const match = /^theorem target : ([\s\S]+?) :=[\s\S]+\n#print axioms target\s*$/.exec(source);
  if (!match) throw new Error('DEMO_THEOREM must contain theorem target');
  if (env.DEMO_ACTION === 'preflight') {
    const deployed = await connection.getAccountInfo(program.programId);
    if (!deployed?.executable) throw new Error('Program is not deployed at PROGRAM_ID on this RPC');
    for (const key of [creator, honest, ...cheaters, ...verifiers]) {
      if (await connection.getBalance(key.publicKey) === 0) throw new Error(`Fund wallet ${key.publicKey.toBase58()} first`);
    }
    const honestSource = fs.readFileSync('agents/honest-agent.ts', 'utf8');
    if (!/checkProof/.test(honestSource) || !/(submit|uploadAndSubmit)/.test(honestSource)) {
      throw new Error('The honest agent is still a stub; merge the real agent before running the live demo');
    }
    return;
  }
  const id = new BN(env.BOUNTY_ID);
  const [bounty] = bountyPda(creator.publicKey, id, program.programId);
  if (env.DEMO_ACTION === 'post') {
    const statement = match[1];
    const blob = await putBlob(statement);
    const signature = await program.methods.createBounty(id, sha256Bytes(statement), blob.uri, reward,
      new BN(Math.floor(Date.now() / 1000) + Math.max(900, Math.ceil(timeout * 5 / 1000))),
      verifiers.map(k => k.publicKey)).accountsStrict({ creator: creator.publicKey, bounty, systemProgram: SystemProgram.programId }).rpc();
    console.error(`Posted bounty ${bounty.toBase58()}: ${explorerTx(signature)}`);
    console.log(bounty.toBase58());
    return;
  }
  const until = Date.now() + timeout;
  const expected = env.DEMO_ACTION === 'rejected' ? 'rejected' : 'accepted';
  const solvers = expected === 'rejected' ? cheaters : [honest];
  const pending = new Set(solvers.map(k => k.publicKey.toBase58()));
  while (pending.size && Date.now() < until) {
    for (const solver of solvers) {
      if (!pending.has(solver.publicKey.toBase58())) continue;
      const [submission] = submissionPda(bounty, solver.publicKey, program.programId);
      const account = await program.account.submission.fetchNullable(submission);
      if (!account || statusName(account.status) === 'pending') continue;
      if (statusName(account.status) !== expected) throw new Error(`Unexpected ${statusName(account.status)} for ${submission.toBase58()}`);
      const mask = expected === 'rejected' ? account.rejections : account.approvals;
      if ([0, 1, 2].filter(i => mask & (1 << i)).length < 2) throw new Error('Final status lacks a verifier quorum');
      pending.delete(solver.publicKey.toBase58());
      console.log(`${expected.toUpperCase()}: ${submission.toBase58()} (votes=${mask})`);
    }
    if (pending.size) await pause(3000);
  }
  if (pending.size) throw new Error(`Timed out waiting for ${expected}; inspect logs/verifier-*.log`);
  const account = await program.account.bounty.fetch(bounty);
  if (expected === 'rejected') {
    if (statusName(account.status) !== 'open' || account.winner) throw new Error('Cheater rejection must leave the bounty open with no winner');
    return;
  }
  if (statusName(account.status) !== 'solved' || !account.winner?.equals(honest.publicKey)) throw new Error('Honest solver did not win');
  // The payout occurs in the second approving vote, not in submit_proof.
  const parser = new EventParser(program.programId, program.coder);
  const payoutUntil = Date.now() + timeout;
  while (Date.now() < payoutUntil) {
    for (const receipt of await connection.getSignaturesForAddress(bounty, { limit: 100 })) {
      if (receipt.err) continue;
      const tx = await connection.getTransaction(receipt.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      if (!tx?.meta || tx.meta.err) continue;
      for (const event of parser.parseLogs(tx.meta.logMessages ?? [])) {
        if (event.name.replace(/_/g, '').toLowerCase() !== 'submissionaccepted') continue;
        if (!event.data.bounty.equals(bounty) || !event.data.solver.equals(honest.publicKey)) continue;
        const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
        let solverIndex = -1;
        for (let i = 0; i < keys.length; i++) if (keys.get(i)?.equals(honest.publicKey)) solverIndex = i;
        if (solverIndex < 0 || BigInt(tx.meta.postBalances[solverIndex]) - BigInt(tx.meta.preBalances[solverIndex]) !== BigInt(account.reward.toString())) {
          throw new Error('Payout transaction did not credit the full bounty reward to the honest solver');
        }
        console.log(`Payout: ${account.reward.toString()} lamports to ${honest.publicKey.toBase58()}`);
        console.log(`Payout transaction: ${receipt.signature}`);
        console.log(explorerTx(receipt.signature));
        return;
      }
    }
    await pause(3000);
  }
  throw new Error('Accepted bounty found, but payout transaction could not be verified');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
NODE
}

chain preflight
echo "RPC: $(rpc_host)"
mkdir -p "$LOG_DIR"
launcher_pid=""
# Stops the store and verifiers (run-verifiers.sh stops its whole process
# groups on TERM). Bounded: escalates to KILL if the launcher does not exit.
cleanup() {
  trap - EXIT INT TERM
  if [[ -n "$launcher_pid" ]]; then
    kill -TERM "$launcher_pid" 2>/dev/null || true
    for _ in {1..100}; do kill -0 "$launcher_pid" 2>/dev/null || break; sleep 0.1; done
    kill -KILL "$launcher_pid" 2>/dev/null || true
    wait "$launcher_pid" 2>/dev/null || true
    launcher_pid=""
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
bash scripts/run-verifiers.sh >"$LOG_DIR/launcher.log" 2>&1 &
launcher_pid=$!
ready=false
for _ in {1..150}; do
  kill -0 "$launcher_pid" 2>/dev/null || { cat "$LOG_DIR/launcher.log" >&2; exit 1; }
  if [[ "$(curl -s --max-time 1 -o /dev/null -w '%{http_code}' "$STORE_URL/blob/$(printf '%064d' 0)" || true)" == 404 ]] \
    && [[ -f "$LOG_DIR/launcher.log" ]] && rg -q 'Store and verifiers .* started' "$LOG_DIR/launcher.log"; then ready=true; break; fi
  sleep 0.1
done
[[ "$ready" == true ]] || { echo "Verifier launcher did not become ready; see $LOG_DIR/launcher.log" >&2; exit 1; }
export BOUNTY
BOUNTY="$(chain post)"
echo "Bounty: $BOUNTY"
# Bound each agent so a stuck RPC call or model request cannot hang the demo.
AGENT_TIMEOUT="${AGENT_TIMEOUT:-600}"
timeout "$AGENT_TIMEOUT" node --require tsx/cjs agents/cheater-agent.ts "$BOUNTY"
chain rejected
AGENT_KEYPAIR="$HONEST_KEYPAIR" timeout "$AGENT_TIMEOUT" node --require tsx/cjs agents/honest-agent.ts "$BOUNTY"
chain accepted
# Payout verified: stop the store and verifiers now rather than leaving them running.
cleanup
echo "Demo complete: bounty $BOUNTY solved and paid. Store and verifiers stopped; logs in $LOG_DIR."
