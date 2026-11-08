"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { client, useMock, type BountyView, type SubmissionView } from "../../../../lib/client";
import { ErrorMessage, ExplorerLink, sol, StatusBadge } from "../../../components/display";
import { LeanProof } from "../../../components/proof";
import { SubmissionCard } from "../../../components/submission-card";

export default function BountyDetail() {
  const { address } = useParams<{ address: string }>();
  const [bounty, setBounty] = useState<BountyView | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    setLoading(true); setError(""); setBounty(null); setSubmissions([]); setUpdated(null);
    void Promise.all([client.getBounty(address), client.listSubmissions(address)]).then(([row, proofs]) => {
      if (!active) return;
      if (!row) { setError("Bounty not found. Return to the list to choose a demo bounty."); return; }
      setBounty(row); setSubmissions(proofs);
      unsubscribe = client.subscribe(address, (update) => {
        if (!active) return;
        if (update instanceof Error) { setError(update.message); return; }
        setBounty(update.bounty); setSubmissions(update.submissions); setUpdated(Date.now());
      });
    }).catch((e: Error) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; unsubscribe?.(); };
  }, [address]);

  return <div className="space-y-7">
    <Link href="/" className="text-sm text-slate-400 hover:text-white">← All bounties</Link>
    {error && <ErrorMessage message={error} />}
    {loading && <p role="status" className="text-slate-400">Loading bounty…</p>}
    {bounty && <>
      <section className="panel space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="mb-3 text-2xl font-semibold text-white">{bounty.title}</h1><StatusBadge status={bounty.status} /></div><p className="text-3xl font-semibold text-white">{sol(bounty.reward)} <span className="text-sm font-normal text-slate-400">SOL reward</span></p></div>
        <LeanProof code={bounty.statement} />
        <div className="grid gap-4 text-sm sm:grid-cols-2"><div><p className="mb-2 text-slate-500">Creator</p><ExplorerLink address={bounty.creator} /></div><div><p className="mb-2 text-slate-500">Deadline</p><p>{new Date(Number(bounty.deadline.toString()) * 1000).toLocaleString()}</p></div></div>
        <div className="flex flex-wrap gap-5"><ExplorerLink address={bounty.address} label="Bounty account" /><ExplorerLink transaction={bounty.transaction} label={"refunded" in bounty.status ? "Refund transaction" : "Creation transaction"} /></div>
        {bounty.winner && <div className="space-y-3 rounded-lg border border-emerald-900 bg-emerald-950/30 p-4"><p className="text-sm text-emerald-300">Accepted proof · {sol(bounty.reward)} SOL paid to the winning solver{useMock ? " (simulated)" : ""}.</p><div className="flex flex-wrap gap-5"><ExplorerLink address={bounty.winner} label="Winning solver" />{bounty.payoutTransaction && <ExplorerLink transaction={bounty.payoutTransaction} label="Payout transaction" />}</div></div>}
      </section>
      <section className="space-y-5" aria-label="Submission live feed">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold text-white">Submission live feed <span className="ml-2 text-sm font-normal text-slate-500">{submissions.length}</span></h2><p className="flex items-center gap-2 text-xs text-slate-400"><span className={`h-2 w-2 rounded-full ${"refunded" in bounty.status ? "bg-slate-600" : "animate-pulse bg-emerald-400"}`} />{"refunded" in bounty.status ? "Closed" : !useMock ? "Devnet polling" : "solved" in bounty.status ? "Mock historical replay" : "Mock live updates"}{updated && <span>· {new Date(updated).toLocaleTimeString()}</span>}</p></div>
        <p className="text-xs leading-5 text-slate-500">{!useMock ? "Accounts refresh every three seconds. Checker reasons and transaction history are unavailable from escrow account data." : "solved" in bounty.status ? "Recorded demo submissions replay every few seconds. All three checker outcomes are shown; on-chain settlement requires two approvals. This solved bounty receives no new on-chain submissions." : "refunded" in bounty.status ? "The deadline passed and the creator reclaimed the reward. Submissions are closed." : "New demo submissions and verifier decisions arrive every few seconds. Rejected cheats receive no reward."}</p>
        <p role="status" aria-live="polite" className="sr-only">{submissions.length} submissions. {submissions.reduce((n, s) => n + s.votes.length, 0)} verifier votes.</p>
        {submissions.length === 0 && <p className="panel text-sm text-slate-400">{"refunded" in bounty.status ? "No proofs were submitted before the deadline." : "Waiting for the next solver submission…"}</p>}
        {submissions.map((submission) => <SubmissionCard key={submission.address.toBase58()} submission={submission} bounty={bounty} />)}
      </section>
    </>}
  </div>;
}
