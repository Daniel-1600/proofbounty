# Build "ProofBounty": a Solana market where AI agents get paid only when Lean accepts their proof

This is for the MLH Solana Hackathon, AI track. The deadlines are hard:
- Initial submission at 18:00 Nairobi time (UTC+3) today
- Final submission at 19:45 Nairobi time today

Work through the milestones below in order. Each milestone must leave the project in a working, demoable state before you start the next. If something blocks you for more than 15 minutes, pick the simpler option and keep moving. A working demo beats a complete feature.

## The idea
1. Anyone can post a theorem written in Lean 4 and lock SOL in an escrow program as the reward.
2. AI agents, each with its own Solana keypair, compete to prove it.
3. A hardened checker verifies each proof with Lean.
4. Three independent checker processes vote on-chain. When 2 of 3 approve, the escrow pays the solver's wallet.
5. A cheating agent that tries to slip an axiom or `sorry` past the checker is rejected and paid nothing. This rejection is the key moment in the demo.

Pitch: "Solana agents have identity and payments, but nothing proves they did their work correctly. ProofBounty pays agents only for work that Lean has checked."

## Stack
- Solana **devnet**. The on-chain program uses **Anchor** (Rust).
- Checker, agents and scripts use **TypeScript** (Node 20+), with `@coral-xyz/anchor` and `@solana/web3.js`.
- **Lean 4 core only, no Mathlib** (Mathlib is too large and slow to build in time). Install with `elan` and pin the toolchain in `lean-toolchain`.
- Agents use the **Anthropic API** (`@anthropic-ai/sdk`), with the key read from `ANTHROPIC_API_KEY`.
- The frontend uses **Next.js** with `@solana/wallet-adapter`.
- Use a monorepo layout: `programs/proof_bounty`, `checker/`, `agents/`, `app/`, `lean/`, `scripts/`.

## Milestone 1: escrow program
Accounts:
- `Bounty`, a PDA with seeds `[b"bounty", creator, bounty_id_le_bytes]`. Fields: `creator`, `bounty_id: u64`, `theorem_hash: [u8;32]` (the sha256 of the exact statement text), `statement_uri: String` (max 200 chars), `reward: u64`, `deadline: i64`, `verifiers: [Pubkey; 3]`, `status: enum {Open, Solved, Refunded}`, `winner: Option<Pubkey>`, `bump`. The bounty PDA holds the reward in lamports.
- `Submission`, a PDA with seeds `[b"sub", bounty, solver]`. Fields: `bounty`, `solver`, `proof_hash: [u8;32]`, `proof_uri: String`, `approvals: u8` (a bitmask), `rejections: u8` (a bitmask), `status: enum {Pending, Accepted, Rejected}`, `bump`.

Instructions:
- `create_bounty(bounty_id, theorem_hash, statement_uri, reward, deadline, verifiers)` transfers `reward` lamports into the bounty PDA.
- `submit_proof(proof_hash, proof_uri)` is only allowed while the bounty is Open and the deadline hasn't passed.
- `vote(approve: bool)` can only be signed by one of the 3 verifiers, and each verifier gets one vote per submission. When a submission reaches 2 approvals: mark it Accepted, mark the bounty Solved, set the winner, and pay the full reward to the solver while keeping the bounty PDA rent-exempt. When it reaches 2 rejections: mark it Rejected.
- `refund()` lets the creator take the reward back after the deadline if the bounty is still Open.

Emit events for each of these steps. Write Anchor tests covering: the happy path, a rejected submission, a vote from a non-verifier failing, a double vote failing, a vote on an already-solved bounty failing, and refund. Deploy to devnet and record the program ID in `Anchor.toml` and `app/`.

## Milestone 2: hardened Lean checker (`checker/`)
A function `checkProof(statement: string, proof: string) → {ok, reason, axioms, leanOutput}`:
1. **Reject before running Lean** if the proof text contains any of: `sorry`, `admit`, `axiom`, `native_decide`, `implemented_by`, `extern`, `unsafe`, `partial`, `opaque`, `@[`, `set_option`, `macro`, `syntax`, `elab`, `run_cmd`, `#eval`, `import`, `open private`, `attribute`, `local instance`, or a `theorem`, `def` or `instance` declaration. Match on tokens, not raw substrings.
2. The checker builds the Lean file itself, so the agent can never change the statement:
   ```lean
   theorem target : <STATEMENT> := <PROOF>
   #print axioms target
   ```
3. Run `lean` on the file in a fresh temp directory with a 60-second timeout and no network. Treat a non-zero exit code or any `error:` in the output as a failure.
4. Parse the `#print axioms` output. Only `propext`, `Classical.choice` and `Quot.sound` are allowed. Anything else is rejected, and the reason names the axiom.
5. The checker recomputes `sha256(statement)`, compares it to the on-chain `theorem_hash`, and rejects on a mismatch.

Write unit tests for: a valid proof, a wrong proof, `sorry`, a hidden axiom, `native_decide`, a tampered statement, and a timeout.

**Verifier daemon:** one process per verifier keypair (`VERIFIER_INDEX=0|1|2`). It polls the program's Submission accounts every 3 seconds, fetches the statement and proof from their URIs, runs `checkProof`, and calls `vote`. It logs the reason for each decision, and each decision is linked to the on-chain transaction. Add `scripts/run-verifiers.sh` to start all three.

**Proof storage:** add a tiny Express API in `checker/store.ts` that stores statements and proofs by content hash (`POST /blob` returns `{hash, uri}`, and `GET /blob/:hash` returns the content). Its URIs go on-chain. Mention IPFS in the README as the production option.

## Milestone 3: agents (`agents/`)
- `honest-agent.ts` takes a bounty, calls Claude with the statement, and asks for a proof body only (the text after `:=`, usually `by ...`). It runs `checkProof` locally and, on failure, sends Lean's errors back to Claude. It tries up to 6 times, then uploads the proof and calls `submit_proof` from its own keypair. It logs every attempt.
- `cheater-agent.ts` is scripted to submit something that looks plausible but cheats: first a proof that uses `sorry`, then one with `native_decide`, and one that tries to sneak in an axiom. The verifiers must reject all of them.
- `scripts/fund-agents.ts` creates keypairs for the agents and verifiers and airdrops devnet SOL to them, retrying on rate limits.
- `lean/demo/` contains 4 theorems that Claude reliably proves in core Lean, for example `List.reverse (List.reverse l) = l`, `n + 0 = n`, `a + b = b + a` on Nat, and a theorem about `List.length (l ++ m)`. Test each one beforehand and record how many attempts it took.

## Milestone 4: frontend (`app/`)
- Wallet connect (Phantom on devnet).
- A form to post a bounty: the Lean statement, the reward in SOL and the deadline. The app uploads the statement to the store, hashes it and calls `create_bounty`.
- A bounty list with status badges (Open / Solved / Refunded).
- A bounty detail page with a live feed of submissions. Each shows the solver's address, the proof (syntax highlighted), the votes from the 3 verifiers with their reasons, the status, and Solana Explorer links (`?cluster=devnet`). Highlight a rejected cheating attempt in red with its reason.
- A header line: "Paid only for proofs Lean accepts."
- Keep the styling clean and simple. Function first.

## Milestone 5: demo and submission
- `scripts/demo.sh` runs the whole flow from one command: post a bounty, start the cheater (rejected), start the honest agent (accepted), and show the payout.
- README sections: the problem (AI agent outputs on Solana can't be verified); how it works, with an ASCII diagram; the threat model, meaning what the checker blocks and why, with reference to the Lean community's discussions about AI-written proofs exploiting Lean quirks; the 2-of-3 checker design; the roadmap (checking proofs inside SNARKs to remove trusted checkers, writing passed proofs to the Solana Agent Registry's validation registry, and bounties on properties of Solana programs built on Solanalib or qedsvm); how to run it; and the deployed program ID.
- `SUBMISSION.md`: a 150-word project summary, what's built, the tech stack, the challenges we hit, and what's next.
- A 2-minute demo video script in `DEMO_SCRIPT.md`.

## Stretch goals (only if Milestones 1–5 are done)
- A bounty on a Solana property, adapting the lamport-transfer conservation theorem from Solanalib into core Lean.
- Agents competing on speed, with the leaderboard showing time-to-proof and SOL earned per agent.

## Rules
- Commit after every milestone. Commit messages must be short (under 50 characters), with no body, and signed off: `git commit -s -m "Add escrow program and tests"`.
- Never commit keypairs or `.env` files. Add them to `.gitignore` in the first commit.
- After each milestone, print a short status update: what works, what's left, and the time taken.
- If devnet airdrops are rate-limited, use one funded wallet to transfer SOL to the others.
