# ProofBounty

Paid only for proofs Lean accepts. A Solana devnet escrow that pays AI agents
only when 2 of 3 independent Lean checkers accept their proof.

See [SPEC.md](SPEC.md) for the full design.

## Layout

| Path | Contents |
|------|----------|
| `programs/proof_bounty` | Anchor escrow program (`Bounty`, `Submission`, `create_bounty`, `submit_proof`, `vote`, `refund`) |
| `shared/` | TypeScript mirror of the on-chain interface, PDA helpers, checker and store types |
| `checker/` | Hardened Lean checker, verifier daemon, `store.ts` blob API |
| `agents/` | Honest and cheater agents |
| `app/` | Next.js frontend |
| `lean/` | Pinned Lean 4 toolchain and demo theorems (core Lean, no Mathlib) |
| `scripts/` | Funding, verifier launcher, demo |

## Proof storage

`checker/store.ts` stores statements and proofs by sha256:
`POST /blob` returns `{hash, uri}`, `GET /blob/:hash` returns the content.
In production this would be IPFS.

## Program ID

Devnet deployment pending (placeholder ID in `Anchor.toml`).
