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

The frontend uses a mock client. Connect Phantom to supply the creator address
when posting. No signing, airdrops, store server, or deployed program is needed.
User-created bounties survive refresh in browser storage; the three seed bounties
are regenerated with realistic deadlines. Explorer links use `?cluster=devnet`;
mock signatures and addresses have valid base58 encodings but no real transactions.

Open bounties receive a new rejected cheat and three checker decisions in timed
steps. The solved bounty initially shows both rejected cheats and the accepted
proof with all three checker reasons, then replays that history. Refunded bounties
remain closed. The replay includes all checker outcomes, even though on-chain
settlement happens at two approvals and later vote instructions may be disallowed.

## Real-client handoff

UI components import only `lib/client.ts`. Replace its `mockClient` binding with
the Anchor/store implementation. Keep the following `BountyClient` methods:

- `listBounties(): Promise<BountyView[]>`
- `getBounty(bounty: string): Promise<BountyView | null>`
- `listSubmissions(bounty: string): Promise<SubmissionView[]>`
- `createBounty(input: PostBountyInput): Promise<BountyView>`
- `subscribe(bounty: string, callback): () => void`

`bounty` is the bounty PDA in base58. Subscription callbacks receive complete
`{ bounty, submissions }` snapshots or an `Error`; cleanup releases listeners.
Views retain the shared Anchor account fields (`PublicKey`, `BN`, enum objects,
approval/rejection bitmasks), adding blob text, transaction signatures, timestamps,
and verifier reasons. Times added to views are milliseconds; account deadlines
are Unix seconds. Verifier indices are 0–2.

The supplied checkout has `shared/src/program.ts` rather than the requested
`shared/interface.ts`; the app imports its account and instruction argument types
and PDA seed constants directly. Check against `shared/interface.ts` when that
file is supplied before wiring the real client.

Posting supplies `{ creator, statement, reward, deadline, signTransaction }`: `reward` is a `BN`
in lamports, and `deadline` is a `BN` in Unix seconds. The adapter must hash the
exact untrimmed UTF-8 statement, upload it to the blob store, select the three
configured verifiers, allocate a creator-unique u64 bounty ID, derive the shared
PDA, then invoke `create_bounty` with the shared instruction argument order. Supply
the connected Phantom `signTransaction` callback to sign the constructed transaction
in the real adapter; the mock never calls it. Verifier reasons are off-chain logs and must be joined with
on-chain vote masks/signatures. Do not invent reasons from the masks alone.

No proof-submission or refund transaction UI is included in Milestone 4.
