"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { client, useMock, type BountyView } from "../../lib/client";
import { ErrorMessage, sol, StatusBadge, statusName } from "../components/display";
import { LeanProof } from "../components/proof";

export default function Home() {
  const [bounties, setBounties] = useState<BountyView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("All");
  useEffect(() => {
    let active = true;
    client.listBounties().then((rows) => { if (active) setBounties(rows); })
      .catch((e: Error) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const visible = bounties.filter((b) => filter === "All" || statusName(b.status) === filter);
  return <div className="space-y-8">
    <div className="flex flex-wrap items-end justify-between gap-5">
      <div><p className="mb-3 text-xs uppercase tracking-widest text-emerald-400">Lean 4 · Solana · 2 of 3 verifiers</p><h1 className="text-3xl font-semibold text-white">Proofs worth solving.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">Explore theorem rewards and watch independent verifiers reject cheats and approve valid proofs.</p></div>
      <Link href="/bounties/new" className="button-primary">+ Post a bounty</Link>
    </div>
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm text-slate-400">{useMock ? "Mock demo. Open a bounty to watch submissions and verifier votes arrive live." : "Solana devnet. Open a bounty to watch on-chain submissions and votes."}</div>
    <div className="flex flex-wrap gap-2" aria-label="Filter by status">{["All", "Open", "Solved", "Refunded"].map((name) => <button key={name} onClick={() => setFilter(name)} aria-pressed={filter === name} className={`rounded-lg border px-4 py-2 text-sm ${filter === name ? "border-emerald-700 bg-emerald-950/50 text-emerald-300" : "border-slate-800 text-slate-400 hover:border-slate-600"}`}>{name}</button>)}</div>
    {error && <ErrorMessage message={error} />}
    {loading && <p role="status" className="text-slate-400">Loading bounties…</p>}
    {!loading && !error && visible.length === 0 && <p className="panel text-slate-400">No bounties with this status.</p>}
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{visible.map((b) => <article key={b.address.toBase58()} className="panel flex flex-col gap-5">
      <div className="flex items-center justify-between"><StatusBadge status={b.status} /><span className="text-lg font-semibold text-white">{sol(b.reward)} <span className="text-xs text-slate-500">SOL</span></span></div>
      <h2 className="text-lg font-medium text-white"><Link href={`/bounties/${b.address.toBase58()}`} className="hover:text-emerald-300">{b.title}</Link></h2>
      <LeanProof code={b.statement} />
      <p className="text-xs text-slate-500">Deadline · {new Date(Number(b.deadline.toString()) * 1000).toLocaleString()}</p>
      <Link href={`/bounties/${b.address.toBase58()}`} className="button-secondary mt-auto">View bounty & live feed →</Link>
    </article>)}</div>
  </div>;
}
