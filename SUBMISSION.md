# ProofBounty submission

## Project summary (150 words)

Solana gives AI agents identity and payments, but a signature cannot prove their work is correct. ProofBounty connects theorem bounties to formal verification: a creator specifies a Lean statement and escrows SOL, agents submit proof bodies, and three checkers evaluate them. The intended escrow pays the solver after two approvals; cheating submissions receive nothing. Our implemented checker pins Lean 4.22.0, blocks dangerous tokens, audits theorem axioms, checks content commitments, and runs Lean inside a networkless Linux sandbox. A content-addressed store preserves statements and proofs, while verifier daemons produce decisions linked to vote transactions. Four core-Lean examples support demonstrations. Escrow handlers, agents, deployment, and the frontend remain unfinished. The planned stack combines Anchor, TypeScript, Next.js, and Azure OpenAI gpt-6-luna. Next, we will complete the devnet flow, pursue SNARK-verified Lean to remove trusted checkers, publish validations to the Solana Agent Registry, and expand bounties to Solana program properties using Solanalib or qedsvm.

## What's built

- Hardened Lean checker with exact statement-hash checking, lexical bans, an explicit axiom allowlist and a resource-limited networkless sandbox.
- Immutable content-addressed Express store with UTF-8 validation and integrity checks.
- Verifier daemon with proof-hash checks, restricted fetching, retry handling and transaction-linked decision logs; launcher for three verifier processes.
- Tests for valid/wrong proofs, every banned token/declaration, hidden axioms, tampering, timeout, store behavior and daemon behavior. Daemon transaction tests use a stub chain; they are not devnet payout evidence.
- Four core-Lean demo proofs: Nat addition by zero, Nat addition commutativity, list reversal twice and append length. Recorded attempts are hand-written, not AI measurements.
- Anchor account/PDA definitions, instruction interfaces, events and errors, plus shared TypeScript interfaces. All escrow handlers still return `NotImplemented`.

TODO: complete escrow logic, live integration tests, devnet deployment, AI agents, funding, Next.js frontend and the one-command demo. No deployed program ID or verified payout is available yet.

## Tech stack

Anchor 0.31.1 / Rust on Solana devnet; Lean 4.22.0 core without Mathlib; TypeScript / Node.js 20+; Express; Solana web3.js; elan; Linux Bubblewrap and util-linux `prlimit`. Next.js with wallet adapter and Azure OpenAI **gpt-6-luna** are planned integrations. The existing agent scaffold references Anthropic/Claude; Azure integration has not been implemented.

## Challenges

AI proof checking must distinguish kernel-checked evidence from admissions and extra trust assumptions. The checker combines token filtering with an axiom audit, including tests for indirect `sorryAx` and `Lean.trustCompiler` references. Owning the target template and checking exact content hashes bind the proof to the posted statement.

Running untrusted Lean safely requires working Linux namespaces and bounded resources; sandbox failure rejects the submission. Blob and RPC failures need retries without falsely labelling unavailable content as an invalid proof. The development setup also encountered a failed Lean release redirect; the checker notes document fetching the official archive through the asset API, checking its published SHA-256 and linking it through elan.

Three checkers still share common software and require trusted operators. The complete escrow and frontend flow remains the main integration work.

## What's next

Complete the devnet bounty-to-payout flow and record real Explorer evidence. Then pursue SNARK-verified Lean to remove trusted checkers, write passed proofs to the Solana Agent Registry's validation registry, and add bounties on Solana program properties through Solanalib or qedsvm. Use IPFS for durable decentralized proof storage.
