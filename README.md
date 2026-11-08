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

**Current status:** the checker, store, verifier daemon and three-process launcher are implemented. Four core-Lean examples and checker/store/daemon tests are included. The Anchor accounts and instruction interfaces exist, but all escrow handlers return `NotImplemented`. Agents, funding and `scripts/demo.sh` are stubs; `app/` is absent. The diagram describes the intended complete flow. There is no verified devnet deployment or payout yet.

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

Each bounty specifies three verifier public keys. The launcher runs one process per key with `VERIFIER_INDEX=0`, `1` or `2`. Each daemon polls three seconds after the previous cycle, skips finalized/already-voted submissions and logs the decision, reason, axioms, vote signature and devnet Explorer link. Reasons are off-chain logs; the on-chain interface stores approval/rejection bitmasks.

The intended escrow rules require two approvals to accept the submission, mark the bounty solved and pay its full reward to the solver while preserving rent exemption. Two rejections reject the submission without paying it. Only designated verifiers may vote, and each gets one vote per submission. Those on-chain rules still need handler implementation.

With correct escrow logic and independently operated checkers, one dishonest checker cannot authorize a payout alone, and two available agreeing checkers can decide. Two compromised or colluding checkers can authorize a false result. All three currently share the same implementation and Lean version, so a common bug can affect every vote. Checkers remain trusted; three processes alone do not establish independent operators.

## Tech stack

| Layer | Technology and status |
| --- | --- |
| Escrow | Solana devnet; Anchor 0.31.1 / Rust scaffold |
| Proof checking | Lean **4.22.0**, core only, no Mathlib; elan, Bubblewrap, util-linux `prlimit` |
| Services and clients | TypeScript, Node.js 20+, Express, `@coral-xyz/anchor`, `@solana/web3.js` |
| Frontend | **Next.js** with Solana wallet adapter — TODO: build `app/` |
| Honest agent | **Azure OpenAI gpt-6-luna** — TODO: integrate; the current agent scaffold and dependency still refer to Anthropic/Claude |

## How to run it

Run from the repository root on Linux with Node.js 20+, npm, elan, Bubblewrap (`bwrap`), enabled user namespaces and `prlimit` installed. Solana CLI and Anchor are needed for the future on-chain flow.

The following commands exercise the implemented checker and store:

```sh
npm install --ignore-scripts --package-lock=false
elan toolchain install leanprover/lean4:v4.22.0
npm -w checker test
npx tsc -p checker/tsconfig.json --noEmit
# Direct compilation of a known-good example:
(cd lean && lean demo/nat_add_zero.lean)
# Keep the store running in its own terminal:
npm -w checker run store
```

Elan must be on `PATH`; `ELAN_BIN` can select its executable. The checker resolves and verifies the pinned Lean binary. Tests that execute Lean require a working Bubblewrap sandbox.

The store listens at `http://localhost:8787` on loopback. `POST /blob` accepts raw UTF-8 text and returns `{hash, uri}`; `GET /blob/:hash` retrieves it. Configure `STORE_DIR`, `STORE_PORT` and `STORE_URL` as needed. Use a reverse proxy for external access and set the daemon's `BLOB_ORIGINS` allowlist accordingly. Keep API credentials and wallet keypairs out of Git.

**Devnet program ID: TODO — `<DEPLOYED_PROGRAM_ID>`.** The address currently in the scaffold is a placeholder, not deployment evidence. TODO: implement and test escrow, deploy it, update the program configuration and generate `target/idl/proof_bounty.json` before attempting live votes.

After deployment, with funded `keys/verifier-0.json`, `keys/verifier-1.json` and `keys/verifier-2.json` matching the bounty's verifier slots, the existing launcher is:

```sh
PROGRAM_IDL=target/idl/proof_bounty.json \
SOLANA_RPC_URL=https://api.devnet.solana.com \
STORE_URL=http://localhost:8787 \
bash scripts/run-verifiers.sh
```

For a single process, use `VERIFIER_INDEX` and optionally `VERIFIER_KEYPAIR` with `npm -w checker run verifier`. The daemon reads the program address from the supplied IDL.

The remaining commands are **TODO**, not runnable end-to-end features:

```sh
# TODO: implement key creation and devnet funding (currently a stub).
npx tsx scripts/fund-agents.ts
# TODO: implement the bounty-posting command; interface to be defined.
# <POST_BOUNTY_COMMAND> <STATEMENT> <REWARD_SOL> <DEADLINE>
# TODO: implement agents and define bounty arguments (currently stubs).
npm -w agents run cheater -- <BOUNTY_ADDRESS>
npm -w agents run honest -- <BOUNTY_ADDRESS>
# TODO: implement the Next.js workspace and its dev script (app/ absent).
npm -w app run dev
# TODO: implement the complete demo (currently exits with an error).
bash scripts/demo.sh
```

TODO: configure Azure OpenAI credentials and the gpt-6-luna deployment when the honest-agent integration is built; its environment-variable interface is not defined yet.

## Roadmap

1. Complete escrow handlers, devnet deployment, agents, Next.js UI and the one-command demo; record actual rejection and payout transactions.
2. Move to **SNARK-verified Lean**: prove execution of proof verification and verify the resulting certificate on-chain to remove trusted checkers.
3. Write passed proofs to the **Solana Agent Registry's validation registry**, linking agent identity to the statement, proof and validation evidence.
4. Offer bounties on **Solana program properties** through **Solanalib or qedsvm**, starting with properties such as lamport-transfer conservation.

See [SUBMISSION.md](SUBMISSION.md) for submission materials and [DEMO_SCRIPT.md](DEMO_SCRIPT.md) for the two-minute recording plan.
