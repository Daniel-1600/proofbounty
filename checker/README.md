# Milestone 2

The checker imports its banned tokens, allowed axioms, timeout and Lean template
from `shared/`. `checkProof(statement, proof)` performs local preflight;
`checkProof(statement, proof, { theoremHash })` also validates the exact UTF-8
statement commitment. The daemon always supplies the on-chain hash and also
checks the proof hash.

Requires Node 20+, elan, the toolchain in `lean/lean-toolchain`, Linux
Bubblewrap (`bwrap`) with user namespaces enabled, and `prlimit` (util-linux). Lean runs in a fresh directory,
with no network, no home/keypair mounts, read-only runtime/toolchain mounts,
one worker, a 2 GiB OS address-space limit, a 1 MB output cap, and a 60-second
execution deadline. Failure to create the sandbox rejects the proof. The whole
process group is killed on timeout. Only a single target axiom report is accepted.
Strings and nested comments are lexed separately; token matching does not reject
names merely containing a banned word. Inputs are restricted to balanced
expressions within the shared template. This is defense in depth, not a claim
that Lean or the Linux kernel is free of vulnerabilities.

Install elan normally, then run `elan toolchain install leanprover/lean4:v4.22.0`.
For this development environment elan is installed at `/tmp/pb-elan`.
GitHub's normal release redirect failed, so the official Lean archive was fetched
through the asset API, checked against its published SHA-256, and registered
using `elan toolchain link leanprover/lean4:v4.22.0`. Elan resolves the pinned
version to that installation:

```sh
export ELAN_HOME=/tmp/pb-elan
export PATH="$ELAN_HOME/bin:$PATH"
npm install --ignore-scripts --package-lock=false
npm -w checker test
npx tsc -p checker/tsconfig.json --noEmit
npm -w checker run store
```

`ELAN_BIN` can select an alternate elan executable. Do not run the verifier in an
environment that prevents Bubblewrap from creating its network namespace.

The store persists exact text by sha256 under `checker/blobs/` (gitignored).
`POST /blob` accepts raw UTF-8 text and returns `{hash, uri}`;
`GET /blob/:hash` returns that text. `STORE_DIR`, `STORE_PORT` and `STORE_URL`
configure disk location, local listening port and public URI respectively.
It binds to loopback; use a reverse proxy for external access. IPFS is the
production option for durable decentralized proof storage.

After program deployment and generation of its Anchor IDL:

```sh
PROGRAM_IDL=target/idl/proof_bounty.json \
SOLANA_RPC_URL=https://api.devnet.solana.com \
STORE_URL=http://localhost:8787 \
bash scripts/run-verifiers.sh
```

The existing launcher starts indices 0, 1 and 2. Each daemon defaults to
`keys/verifier-<index>.json`; `VERIFIER_KEYPAIR` overrides it for an individual
process. Keypairs must match the bounty's verifier slots. The program address
comes from the deployed IDL. Polls occur three seconds after the previous cycle.
`BLOB_ORIGINS` is a comma-separated allowlist of URI origins (defaults to
`STORE_URL`); redirects are rejected and downloads have time/size limits.

`VerifierChain` isolates account reads and the vote transaction. Tests use a stub
and verify approvals, rejections, commitment checks, duplicate prevention,
transport/RPC retries and transaction-linked logs. The live Anchor vote adapter
requires deployment for integration testing. Successful transactions are logged
with reason, axiom report, signature and Solana Explorer devnet link. Failed
fetches and RPC calls are retried, and finalized/already-voted accounts are skipped.

The four core-Lean demo files are compiled by the checker test suite.
