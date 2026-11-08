# ProofBounty submission

## Project summary (150 words)

Solana gives AI agents identity and payments, but a signature cannot prove their work is correct. ProofBounty connects theorem bounties to formal verification: a creator specifies a Lean statement and escrows SOL, agents submit proof bodies, and three checkers evaluate them. The Anchor escrow pays the solver after two approvals; cheating submissions receive nothing. Our implemented checker pins Lean 4.22.0, blocks dangerous tokens, audits theorem axioms, checks content commitments, and runs Lean inside a networkless Linux sandbox. A content-addressed store preserves statements and proofs, while verifier daemons produce decisions linked to vote transactions. On devnet, three cheats were rejected and an Azure OpenAI gpt-6-luna agent's proof was accepted and paid. A Next.js frontend shows every submission with each verifier's vote, reason and Explorer link. Next, we will pursue SNARK-verified Lean to remove trusted checkers, publish validations to the Solana Agent Registry, and expand bounties to Solana program properties using Solanalib or qedsvm.

## What's built

- Hardened Lean checker with exact statement-hash checking, lexical bans, an explicit axiom allowlist and a resource-limited networkless sandbox.
- Immutable content-addressed Express store with UTF-8 validation and integrity checks.
- Verifier daemon with proof-hash checks, restricted fetching, status-filtered polling with 429 backoff, reasons in on-chain vote memos, and skipping of already-decided submissions; launcher for three verifier processes.
- Tests for valid/wrong proofs, every banned token/declaration, hidden axioms, tampering, timeout, store behavior and daemon behavior. Daemon transaction tests use a stub chain; they are not devnet payout evidence.
- Four core-Lean demo theorems: Nat addition by zero, Nat addition commutativity, list reversal twice and append length. gpt-6-luna proved the first three on attempt 1 and append length on attempt 2, after Lean's error was fed back.
- Anchor escrow deployed on devnet at `28CYsLKihZfAQWz513EAEXS52hc9npL9frZw1VpPAz3i`: `create_bounty`, `submit_proof`, 2-of-3 `vote` with payout, and `refund`, with events and Anchor tests.
- Agents: an honest agent (Azure OpenAI gpt-6-luna, local checking, up to 6 attempts with Lean feedback) and a scripted cheater (`sorry`, `native_decide`, `sorryAx`); funding and bounty-posting scripts.
- Next.js frontend with Phantom: post bounties, list them by status, and watch submissions with per-verifier votes, reasons and Explorer links.
- `scripts/demo.sh` runs the whole flow and verifies the payout. A devnet run rejected all three cheats and paid the honest agent; see the README's devnet evidence.

## Tech stack

Anchor 0.31.1 / Rust on Solana devnet; Lean 4.22.0 core without Mathlib; TypeScript / Node.js 20+; Express; Solana web3.js; elan; Linux Bubblewrap and util-linux `prlimit`. Next.js with Solana wallet adapter; Azure OpenAI **gpt-6-luna** through the v1 API and the `openai` client.

## Challenges

AI proof checking must distinguish kernel-checked evidence from admissions and extra trust assumptions. The checker combines token filtering with an axiom audit, including tests for indirect `sorryAx` and `Lean.trustCompiler` references. Owning the target template and checking exact content hashes bind the proof to the posted statement.

Running untrusted Lean safely requires working Linux namespaces and bounded resources; sandbox failure rejects the submission. Blob and RPC failures need retries without falsely labelling unavailable content as an invalid proof. The development setup also encountered a failed Lean release redirect; the checker notes document fetching the official archive through the asset API, checking its published SHA-256 and linking it through elan.

On-chain, the public devnet RPC rate-limited three polling verifiers; the fix was to store strings last in each account so status sits at a fixed offset, poll with memcmp status filters and back off on 429s. The program stores no reasons, so verifiers attach them as SPL memos on their vote transactions. Devnet confirmations sometimes time out after the transaction has landed, so agents check for the account before treating a timeout as failure. Three checkers still share common software and require trusted operators.

## What's next

Pursue SNARK-verified Lean to remove trusted checkers, write passed proofs to the Solana Agent Registry's validation registry, and add bounties on Solana program properties through Solanalib or qedsvm. Use IPFS for durable decentralized proof storage.
