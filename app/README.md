# ProofBounty frontend

Next.js App Router, TypeScript, Tailwind, and Phantom via Solana wallet-adapter on devnet.

```sh
cd app
npm install
npm run dev
```

Open http://localhost:3000. `npm run build` creates a production build.
When installing this app independently inside the npm workspace, use
`npm install --workspaces=false` to keep the lockfile and dependencies in `app/`.

The frontend defaults to a mock client (`NEXT_PUBLIC_USE_MOCK=true`). Connect Phantom to supply the creator address
when posting. No signing, airdrops, store server, or deployed program is needed.
User-created bounties survive refresh in browser storage; the three seed bounties
are regenerated with realistic deadlines. Explorer links use `?cluster=devnet`;
mock signatures and addresses have valid base58 encodings but no real transactions.

Open bounties receive a new rejected cheat and three checker decisions in timed
steps. The solved bounty initially shows both rejected cheats and the accepted
proof with all three checker reasons, then replays that history. Refunded bounties
remain closed. The replay includes all checker outcomes, even though on-chain
settlement happens at two approvals and later vote instructions may be disallowed.

## Anchor client

UI components import only `lib/client.ts`, which selects `lib/anchor-client.ts`
when `NEXT_PUBLIC_USE_MOCK=false`. Configure these values in `app/.env.local`
before starting or building Next.js (public settings are embedded in the build):

```dotenv
NEXT_PUBLIC_USE_MOCK=false
NEXT_PUBLIC_PROGRAM_ID=28CYsLKihZfAQWz513EAEXS52hc9npL9frZw1VpPAz3i
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_STORE_URL=http://localhost:8787
NEXT_PUBLIC_VERIFIERS=<verifier-0-public-key>,<verifier-1-public-key>,<verifier-2-public-key>
```

Use the actual deployed program ID and three distinct funded verifier public
keys. No private keys belong in frontend configuration. The RPC endpoint must
permit browser requests; the blob store and on-chain blob URIs must also be
browser-accessible, with CORS enabled or exposed through a same-origin proxy.
The current checker store needs that deployment configuration for browser access.

`lib/idl/proof_bounty.json` is hand-written from the escrow Rust program in Anchor
0.31 format. Replace it with `target/idl/proof_bounty.json` after `anchor build`.
The deployed address always comes from `NEXT_PUBLIC_PROGRAM_ID`; it overrides the
IDL address. Program initialization is lazy so an absent real-mode configuration
does not affect the mock demo. Both clients implement:

- `listBounties(): Promise<BountyView[]>`
- `getBounty(bounty: string): Promise<BountyView | null>`
- `listSubmissions(bounty: string): Promise<SubmissionView[]>`
- `createBounty(input: PostBountyInput): Promise<BountyView>`
- `subscribe(bounty: string, callback): () => void`

`bounty` is the bounty PDA in base58. Subscription callbacks receive complete
`{ bounty, submissions }` snapshots or an `Error`. The Anchor client polls every
three seconds after each request completes; cleanup stops polling and suppresses
in-flight callbacks. Failed polls report errors and retry on the next interval.
Views retain the shared Anchor account fields (`PublicKey`, `BN`, enum objects,
approval/rejection bitmasks), adding blob text, transaction signatures, timestamps,
and verifier reasons. Times added to views are milliseconds; account deadlines
are Unix seconds. Verifier indices are 0–2.

The app imports account and instruction argument types from `shared/src/program.ts`.
Statements and proofs are loaded from their exact on-chain URIs. Successful blob
reads are cached; failures surface as errors and are retried on subsequent reads.

Posting supplies `{ creator, statement, reward, deadline, signTransaction }`: `reward` is a `BN`
in lamports, and `deadline` is a `BN` in Unix seconds. The Anchor adapter hashes the
exact untrimmed UTF-8 statement, uploads it to `POST /blob`, checks the returned
hash, selects the three configured verifiers, allocates a random u64 bounty ID,
derives the escrow PDA, then invokes `create_bounty` with the shared argument order. Supply
the connected Phantom `signTransaction` callback to sign the constructed transaction
in the real adapter; the mock never calls it. The transaction is confirmed before
the created bounty is returned. Real vote displays come from the approval/rejection
bitmasks. Checker reasons are unavailable because the escrow does not store them.
Historical timestamps and signatures are also unavailable: views use zero times
and empty signatures, and the UI hides those fields. A bounty created in the current
session retains its actual creation transaction and local timestamp in memory.

Run `npm test` for mock and Anchor integration checks. The Anchor checks use actual
IDL coders and wallet signatures against intercepted RPC/store calls; they do not
spend SOL. `NEXT_PUBLIC_USE_MOCK=true npm run build` verifies the demo build.

No proof-submission or refund transaction UI is included in Milestone 4.
