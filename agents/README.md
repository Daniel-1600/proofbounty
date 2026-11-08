# Agents (Milestone 3)

| File | Role |
|------|------|
| `llm.ts` | Azure OpenAI v1 API via the standard `openai` client. `generate(prompt)` calls `responses.create` and returns `output_text`; `cleanProof` strips fences and echoed `theorem ... :=` headers so only the proof body reaches the checker. |
| `honest-agent.ts` | Asks the model for a proof body, runs the real `checkProof` locally (with the on-chain `theorem_hash`), feeds Lean's errors back, up to 6 attempts, then uploads the proof and calls `submit_proof`. |
| `cheater-agent.ts` | Scripted cheats, one keypair each (`keys/cheater-{0,1,2}.json`): `sorry`, `native_decide`, and `exact sorryAx _ false`. |
| `common.ts` | Program client from `target/idl/proof_bounty.json`, store upload, `submit_proof`, JSONL logging. |

Every attempt and submission is logged as JSON to stdout and to
`agents/logs/<agent>.jsonl` (gitignored), including `model`, so the UI can show
"proved by <model>".

## Setup

`.env` (repo root, never committed) needs `AZURE_OPENAI_BASE_URL`,
`AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_MODEL`. Local checking needs the Lean
toolchain and `bwrap` (see `checker/README.md`).

```sh
npx tsx scripts/fund-agents.ts            # keys/ + 0.05 SOL each, transferred from ~/.config/solana/id.json
npx tsx scripts/fund-agents.ts --airdrop  # try devnet airdrops first (retries on 429)
npm -w checker run store                  # proof store on :8787
B=$(npx tsx scripts/post-bounty.ts lean/demo/reverse_reverse.lean 0.1 30)
bash scripts/run-verifiers.sh &
npx tsx agents/cheater-agent.ts $B        # all three rejected
npx tsx agents/honest-agent.ts  $B        # accepted, paid
npx tsx agents/honest-agent.ts --local "∀ n : Nat, n + 0 = n"   # no chain
```

## Measured attempts (gpt-6-luna, real sandboxed checker)

| Theorem | Attempts | Accepted proof |
|---|---|---|
| `∀ n : Nat, n + 0 = n` | 1 | `intro n; rfl` |
| `∀ (l : List Nat), List.reverse (List.reverse l) = l` | 1 | induction, `simp [ih]` |
| `∀ a b : Nat, a + b = b + a` | 1 | `exact Nat.add_comm a b` |
| `∀ (l m : List Nat), (l ++ m).length = l.length + m.length` | 2 | attempt 1: `rfl` failed on `nil`; with Lean's error fed back, `simp` / `simp [ih, Nat.succ_add]` |

## Devnet run (2026-11-08)

Bounty `99fN4cQQJSThsZbC4Zvfn9phGtQSMy4gYqXHgN6eNUqc` (reverse-reverse, 0.1 SOL):

| Submission | Proof | Result | Reason |
|---|---|---|---|
| `HvJzoQUa…` | `sorry` | Rejected (2 votes) | Banned token in proof: sorry |
| `6FQvCGnx…` | `native_decide` | Rejected (2 votes) | Banned token in proof: native_decide |
| `8pNYKmG9…` | `exact sorryAx _ false` | Rejected (2 votes) | Forbidden axioms: sorryAx |
| `7GKfGM8h…` | honest, 1 attempt | Accepted (verifiers 0, 2) | Lean accepted proof (axioms: propext) |

The bounty ended Solved with the honest agent as winner; the solver received
the 0.1 SOL reward and the bounty PDA kept exactly its rent-exempt minimum.
