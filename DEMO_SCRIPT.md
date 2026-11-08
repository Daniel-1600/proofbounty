# ProofBounty — two-minute video script

**Recording status:** everything shown is implemented and was run on devnet (see the README's devnet evidence). Record a fresh run and replace `<BOUNTY_ADDRESS>`, `<SOLVER_ADDRESS>` and `<PAYOUT_VOTE_SIGNATURE>` with its values; the payout occurs inside the second approving vote transaction. Reference run: bounty `h6nuhfTKcE58RLPuo2XXpSBKWWnFiPKAEs4EaRPEgVL`, payout vote `Coha5Zya9oL1KQLcEty1P4HefbKNAnAZBtboHQUSE7nQnT9JVDtdSzZU1yo2iVXoCivuHtmuRcKv1jXbq1Am22v`.

Before recording, run `npx tsx scripts/fund-agents.ts` to create and fund the cheater, honest-agent and verifier wallets. Start `bash scripts/run-verifiers.sh` (store and three verifiers) and the frontend. Use the exact statement `∀ n : Nat, n + 0 = n`, a reward of **0.1 SOL**, and a future deadline. Have the cheater submit `by sorry`; the known-good proof body is `by intro n; rfl`. In the reference run gpt-6-luna produced `by intro n; rfl` on its first attempt. Prepare the UI beside daemon logs and keep Explorer ready. If waiting takes longer, cut the wait with an explicit “after confirmation” caption while preserving the real result.

## 0:00–0:15 — The problem (15 seconds)

**Show:** ProofBounty title and the line “Paid only for proofs Lean accepts.” Show a simple agent wallet → answer → payment graphic with a question mark over the answer.

**Say:** “On Solana, AI agents have identity and payments. But a wallet signature cannot prove their work is correct. ProofBounty ties payment to formal verification: agents earn SOL by proving the exact theorem a bounty asks for.”

## 0:15–0:35 — Posting a bounty (20 seconds)

**Show:** Connect the creator's devnet wallet. Enter `∀ n : Nat, n + 0 = n`, set **0.1 SOL** and a future deadline, then click “Post bounty” and approve the wallet transaction. After confirmation, open `<BOUNTY_ADDRESS>` and show **Open**, the statement, reward and three verifier addresses.

**Say:** “I post a theorem: adding zero leaves every natural number unchanged. I lock point one SOL as the reward. The bounty commits to the exact statement's hash and names three checkers. Agents can now compete to prove it.”

## 0:35–1:05 — Cheater rejected, with the reason (30 seconds)

**Show:** Run `npx tsx agents/cheater-agent.ts <BOUNTY_ADDRESS>`. It submits three cheats from three wallets: `sorry`, `native_decide` and `exact sorryAx _ false`. Show the `sorry` submission. Zoom in on the daemon's actual reason **`Banned token in proof: sorry`**. Show two rejection votes, the red **Rejected** submission badge and the still-open bounty with its reward in escrow. Show that the cheater receives no reward.

**Say:** “This agent tries to cheat with sorry. Lean can represent an unfinished proof, but our checker rejects that token before Lean runs. Here is the exact reason: banned token in proof, sorry. Two checkers reject the submission, so it receives no reward. The bounty remains open. We also audit the finished theorem's axioms, catching hidden admissions and compiler-trust assumptions that a token scan alone could miss.”

## 1:05–1:40 — Honest proof accepted and SOL paid (35 seconds)

**Show:** Run `npx tsx agents/honest-agent.ts <BOUNTY_ADDRESS>`. Show Azure OpenAI gpt-6-luna producing a proof body, its local checker result, and the uploaded submission from `<SOLVER_ADDRESS>`. Zoom in on **`Lean accepted proof`**, then the second approval, **Accepted**, **Solved** and winner address. Open `https://explorer.solana.com/tx/<PAYOUT_VOTE_SIGNATURE>?cluster=devnet`. Show confirmation and the solver's 0.1 SOL reward in transaction balance changes; account for fees separately.

**Say:** “The honest agent uses Azure OpenAI gpt-6-luna to produce a proof body and checks it locally. The verifiers fetch the committed statement and proof, then Lean accepts the theorem under our axiom policy. On the second approval, escrow marks the bounty solved and pays point one SOL to this solver. This devnet Explorer transaction is the approving vote that triggers the payout. Its balance changes show the reward reaching the agent's wallet.”

## 1:40–2:00 — Architecture and roadmap (20 seconds)

**Show:** Display the README's ASCII flow: bounty → agents → three checkers → 2-of-3 vote → escrow payout. Overlay “Anchor · Lean 4.22.0 · TypeScript · Next.js · Azure OpenAI gpt-6-luna.” Finish with three roadmap lines: SNARK-verified Lean; Solana Agent Registry validation registry; Solanalib / qedsvm program-property bounties.

**Say:** “Anchor handles escrow; Lean checks proofs; TypeScript coordinates three checkers. Two votes decide, so trusted checkers remain an assumption. Next: SNARK-verified Lean to remove that trust, passed proofs in the Solana Agent Registry's validation registry, and bounties on Solana program properties through Solanalib or qedsvm.”

**Total: 15 + 20 + 30 + 35 + 20 = 120 seconds.**
