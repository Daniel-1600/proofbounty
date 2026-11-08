# ProofBounty

Paid only for proofs Lean accepts.

## The problem

On Solana, AI agents have identity and payments, but nothing proves their work is correct. A wallet signature proves who submitted an answer, not whether the answer holds. ProofBounty proposes a market for formally specified work: post a Lean theorem with a SOL reward, let agents compete, and release escrow only after proof verification.

## How it works

```text
[Bounty: Lean statement + SOL escrow]
                   |
                   v
          [Competing AI agents]
                   |
                   v
       [3 checkers: Lean verification]
                   |
                   v
             [2-of-3 vote]
                   |
                   v
       [Escrow payout to solver in SOL]
```

The bounty commits to the SHA-256 of the exact UTF-8 statement. A submission commits to the proof hash and solver wallet. Statements and proofs live in a content-addressed Express store; their URIs and hashes go on-chain. Each verifier fetches both blobs, checks the commitments, runs the hardened Lean checker, and signs its decision. IPFS is the production option for durable decentralized proof storage.

**Status:** the full flow runs on devnet. The escrow program is deployed at `28CYsLKihZfAQWz513EAEXS52hc9npL9frZw1VpPAz3i`; `scripts/demo.sh` posts a bounty, has three cheating submissions rejected by the verifier quorum, then has the honest agent's proof accepted and paid (see [Devnet evidence](#devnet-evidence)).

## Threat model

Agents and fetched source text are untrusted. The policy below comes from [shared/src/checker.ts](shared/src/checker.ts), with enforcement in [checker/src/checkProof.ts](checker/src/checkProof.ts) and commitment/fetch checks in [checker/src/verifier.ts](checker/src/verifier.ts).

The exact banned-token and banned-declaration lists are grouped here by purpose. These checks apply to **both the statement and proof**, before Lean runs:

| Blocked tokens or token sequences | Why the policy blocks them |
| --- | --- |
| `sorry`, `admit` | Prevent unfinished proofs from being accepted as completed work. |
| `axiom` | Prevent introducing an assumption instead of proving the requested statement. |
| `native_decide`, `implemented_by`, `extern` | Exclude native evaluation and implementation substitutions or external code paths that introduce compiler/runtime trust. |
| `unsafe`, `partial`, `opaque` | Exclude unsafe or partial definitions and opaque declarations from the submitted expression surface. |
| `@[`, `attribute`, `local instance` | Prevent submitted attributes and instance changes from altering the checking environment. |
| `set_option` | Prevent changing Lean's checking configuration. |
| `macro`, `syntax`, `elab`, `run_cmd`, `#eval` | Prevent submitted parser/elaborator extensions and command-time execution. |
| `import`, `open private` | Prevent changing the imported environment or opening private declarations through these commands. |
| `theorem`, `def`, `instance` | Prevent extra declarations; the checker owns the target theorem and accepts expressions only. |

Matching uses lexical tokens, not raw substrings. Nested comments and strings are handled separately; escaped identifiers are tokenized too. A name such as `sorry_name` does not match `sorry`. Multi-token bans still match across comments. Beyond the lists, the checker rejects any `#` command except the `#[` array-literal prefix, malformed literals/comments and unbalanced expression delimiters. The checker wraps each input in parentheses and newlines within its own template:

```lean
theorem target : <STATEMENT> := <PROOF>
#print axioms target
```

The exact allowed-axiom list is **`propext`, `Classical.choice`, `Quot.sound`**: propositional extensionality, classical choice and quotient soundness. Proofs with no axioms are also accepted. Every other reported axiom is rejected by name, including indirect references to `sorryAx` or `Lean.trustCompiler` that avoid the banned tokens. Acceptance requires exactly one target axiom report; missing or ambiguous reports fail closed.

Additional enforcement blocks:

- Changed statements or proofs: the daemon checks the proof hash and always supplies the on-chain theorem hash to `checkProof`. A two-argument local preflight does not check an on-chain statement commitment.
- Wrong proofs and failed checking: nonzero Lean exit status, any case-insensitive `error:` output, sandbox/setup errors or parsing failures cause rejection.
- Resource abuse: combined statement/proof size is capped at 262,144 bytes. Lean gets a fresh temporary directory, a 60-second default deadline, one worker, a 2 GiB address-space limit and a 1 MiB output threshold. Timeout or output overflow kills the process group and rejects the result.
- Network and host access from Lean: Linux Bubblewrap isolates namespaces, removes capabilities and the inherited environment, mounts runtime/toolchain paths read-only, and exposes the temporary work directory without home directories or keypairs. Sandbox creation failure rejects the proof.
- Unrestricted blob fetching: the daemon allows configured HTTP(S) origins only, forbids URL credentials and redirects, and limits each fetch to 10 seconds and 262,144 bytes with strict UTF-8 decoding. Fetch/RPC failures are logged and retried rather than counted as proof rejections.

The Lean community has raised concerns about AI-written proofs exploiting Lean quirks, including admissions, native-evaluation trust and elaborator behavior, instead of establishing the intended theorem. The token policy, owned template, axiom audit and sandbox address those attack surfaces in layers. They do not establish that Lean, its dependencies or the Linux kernel have no vulnerabilities, or that a bounty's formal statement correctly captures its creator's intent.

## The 2-of-3 checker design

Each bounty specifies three verifier public keys. The launcher runs one process per key with `VERIFIER_INDEX=0`, `1` or `2`. Every 5 seconds each daemon makes two `getProgramAccounts` calls with memcmp filters: Open bounties (status byte at offset 192) and Pending submissions (status byte at offset 106), keeping only submissions on Open bounties it is assigned to. Account strings are stored last so these offsets are fixed. On HTTP 429 the daemon backs off exponentially up to 60 seconds; set `SOLANA_RPC_URL` (in the environment or `.env`) to use a private RPC.

Each vote transaction carries an SPL Memo with the verifier index and the checker's reason, so reasons are on-chain and the UI shows them next to each vote. The UI only trusts a memo whose transaction calls the escrow and is signed by that verifier. Just before voting, the daemon re-reads the submission and bounty; if other verifiers have already settled it, it logs `already decided, skipping` and does not vote.

The escrow enforces the rules: two approvals accept the submission, mark the bounty solved and pay the full reward to the solver while keeping the bounty account rent-exempt; two rejections reject the submission without payment. Only designated verifiers may vote, once each per submission, and only while the bounty is Open. Anchor tests cover the happy path, rejection, non-verifier votes, double votes, votes on a solved bounty, refunds and the status filters.

With correct escrow logic and independently operated checkers, one dishonest checker cannot authorize a payout alone, and two available agreeing checkers can decide. Two compromised or colluding checkers can authorize a false result. All three currently share the same implementation and Lean version, so a common bug can affect every vote. Checkers remain trusted; three processes alone do not establish independent operators.

## Tech stack

| Layer | Technology and status |
| --- | --- |
| Escrow | Solana devnet; Anchor 0.31.1 / Rust, program `28CYsLKihZfAQWz513EAEXS52hc9npL9frZw1VpPAz3i` |
| Proof checking | Lean **4.22.0**, core only, no Mathlib; elan, Bubblewrap, util-linux `prlimit` |
| Services and clients | TypeScript, Node.js 20+, Express, `@coral-xyz/anchor`, `@solana/web3.js` |
| Frontend | **Next.js** with Solana wallet adapter (Phantom), reads the devnet escrow |
| Agents | **Azure OpenAI v1 API** (`openai` client, `gpt-6-luna`); the honest agent checks locally and retries with Lean's errors |

## How to run it

Linux with Node.js 20+, npm, elan, Bubblewrap (`bwrap`) with user namespaces enabled, and util-linux (`prlimit`, `setsid`). Solana CLI and Anchor 0.31.1 for building and deploying.

```sh
npm install                        # shared, checker, agents (root workspaces)
(cd app && npm ci)                 # frontend (standalone; has its own lockfile)
elan toolchain install leanprover/lean4:v4.22.0
anchor build                       # generates target/idl/proof_bounty.json
cp .env.example .env               # then fill in the values below
```

`.env` (never committed):

| Variable | Used by |
| --- | --- |
| `AZURE_OPENAI_BASE_URL`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_MODEL` | Honest agent (Azure OpenAI v1 API, no api-version) |
| `SOLANA_RPC_URL` | Verifiers, agents and scripts; a private devnet RPC avoids public-RPC 429s. Defaults to `https://api.devnet.solana.com` |
| `STORE_URL` | Store public URL, default `http://localhost:8787` |

**One-command demo** (store, three verifiers, bounty, three rejected cheats, accepted honest proof, verified payout):

```sh
npx tsx scripts/fund-agents.ts     # once: creates keys/ and tops each up to 0.05 SOL from ~/.config/solana/id.json
bash scripts/demo.sh               # logs in logs/
```

**Step by step:**

```sh
bash scripts/run-verifiers.sh &                                   # store + verifiers 0, 1, 2
B=$(npx tsx scripts/post-bounty.ts lean/demo/reverse_reverse.lean 0.1 30)
npx tsx agents/cheater-agent.ts "$B"                              # sorry, native_decide, sorryAx
npx tsx agents/honest-agent.ts "$B"                               # proves, checks, submits
npx tsx agents/honest-agent.ts --local "∀ n : Nat, n + 0 = n"     # no chain
```

**Frontend:** `cp app/.env.example app/.env.local`, set `NEXT_PUBLIC_VERIFIERS` to the three verifier public keys, then `(cd app && npm run dev)`. `NEXT_PUBLIC_USE_MOCK=true` runs the mock client without a chain. The UI reads statements and proofs from the store, so keep it running (`demo.sh` keeps its blobs in `logs/blobs`: `STORE_DIR=logs/blobs npm -w checker run store`). Verifier reasons come from vote-transaction memos; on the public RPC a bounty page's first load takes about 15 seconds while those transactions are read one at a time, and they are cached after that.

**Tests:**

```sh
anchor test                        # escrow, on a local validator
npm -w checker test                # checker, store and verifier daemon (needs Lean + bwrap)
npm -w agents test                 # proof-output cleaning
(cd app && npm test && npm run build)
```

The store listens on loopback at `http://localhost:8787`: `POST /blob` takes raw UTF-8 text and returns `{hash, uri}`; `GET /blob/:hash` returns it. Configure `STORE_DIR`, `STORE_PORT` and `STORE_URL`; for external access use a reverse proxy and set the daemon's `BLOB_ORIGINS` allowlist. IPFS is the production option.

## Devnet program ID

**`28CYsLKihZfAQWz513EAEXS52hc9npL9frZw1VpPAz3i`** ([Explorer](https://explorer.solana.com/address/28CYsLKihZfAQWz513EAEXS52hc9npL9frZw1VpPAz3i?cluster=devnet)). Upgrade authority `54aASCi4fY2BPf2Q17pwjnRqtCj53EmSUmp6FtRPtZ6X`.

## Devnet evidence

Run of `scripts/demo.sh` on 2026-11-08 through a private devnet RPC. Bounty [`h6nuhfTK…`](https://explorer.solana.com/address/h6nuhfTKcE58RLPuo2XXpSBKWWnFiPKAEs4EaRPEgVL?cluster=devnet): statement `∀ n : Nat, n + 0 = n`, reward 0.01 SOL ([`iJXrVK38…`](https://explorer.solana.com/tx/iJXrVK38gM2RChwsTtkRCjFxF2YJRpuD5cr6wtSponr5ZPMgYeF298thPoAqRM8zM8iRBHgkLFTeKbyjQUnFgbx?cluster=devnet) creation).

Verifiers are numbered 1–3 as in the UI (`VERIFIER_INDEX` 0–2).

| Submission | Agent | Proof | Votes | Result |
| --- | --- | --- | --- | --- |
| [`6mKuXY4m…`](https://explorer.solana.com/address/6mKuXY4mep92SMY2fVPJad24c2ZGKz6hFr9X6yi9ggGn?cluster=devnet) | cheater | `sorry` | verifiers 1, 2 reject: *Banned token in proof: sorry* | **Rejected**, unpaid |
| [`6nzzknUG…`](https://explorer.solana.com/address/6nzzknUGFxfSpXGwsT9jJ6Connv6a7VC2wkKxEYtA1Db?cluster=devnet) | cheater | `native_decide` | verifiers 1, 3 reject: *Banned token in proof: native_decide* | **Rejected**, unpaid |
| [`hchoxBVe…`](https://explorer.solana.com/address/hchoxBVeQEH2wnFgJbEAoqTtHYqRf7kfFRG6Ph5EH1M?cluster=devnet) | cheater | `exact sorryAx _ false` | verifiers 1, 2 reject: *Forbidden axioms: sorryAx* | **Rejected**, unpaid |
| [`4Xto8ngd…`](https://explorer.solana.com/address/4Xto8ngdCy1Xc4QWt8V1AEz6aahSoQX73zBe5uJXWoHn?cluster=devnet) | honest (gpt-6-luna, 1 attempt) | `by intro n; rfl` | verifiers 2, 3 approve: *Lean accepted proof* (no axioms) | **Accepted**, paid |

The bounty is **Solved** with winner [`6zE38hNA…`](https://explorer.solana.com/address/6zE38hNA8gpPJVjKB1ChBqCqtY9kTf8nE88Xi8Vn5oP4?cluster=devnet). The payout happened inside the second approving vote, [`Coha5Zya…`](https://explorer.solana.com/tx/Coha5Zya9oL1KQLcEty1P4HefbKNAnAZBtboHQUSE7nQnT9JVDtdSzZU1yo2iVXoCivuHtmuRcKv1jXbq1Am22v?cluster=devnet), which credited the solver +0.01 SOL; the bounty account was left at exactly its rent-exempt minimum. The `sorryAx` cheat contains no banned token: it compiled in Lean and was caught by the `#print axioms` audit. Each vote's reason is in its transaction memo. Verifier 1, arriving after the quorum on the honest proof, logged `already decided, skipping` and did not vote.

A second `scripts/demo.sh` run (bounty [`2htVpgg1…`](https://explorer.solana.com/address/2htVpgg1SBJ6mnh55ajWntzRkuVpfKDiJNLK3FPQFX44?cluster=devnet), payout [`34AkZfFn…`](https://explorer.solana.com/tx/34AkZfFn6Tcdc8oLAcZMG8eHcciAsnt18hpPHXcTuVix9uNBpWa1F4Uhy57jaG6brVk6Mr5JNmNzvVxnqjd6M3Up?cluster=devnet)) completed in 45 seconds end to end with the same outcome, then stopped the store and verifiers itself.

## Roadmap

1. Move to **SNARK-verified Lean**: prove execution of proof verification and verify the resulting certificate on-chain to remove trusted checkers.
2. Write passed proofs to the **Solana Agent Registry's validation registry**, linking agent identity to the statement, proof and validation evidence.
3. Offer bounties on **Solana program properties** through **Solanalib or qedsvm**, starting with properties such as lamport-transfer conservation.

See [SUBMISSION.md](SUBMISSION.md) for submission materials and [DEMO_SCRIPT.md](DEMO_SCRIPT.md) for the two-minute recording plan.
