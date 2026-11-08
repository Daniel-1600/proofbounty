import type { BountyView, SubmissionView } from "../../lib/client";
import { ExplorerLink, StatusBadge } from "./display";
import { LeanProof } from "./proof";

export function SubmissionCard({ submission, bounty }: { submission: SubmissionView; bounty: BountyView }) {
  const rejected = "rejected" in submission.status;
  return <article className={`panel space-y-5 ${rejected ? "border-red-900 bg-red-950/10" : ""}`}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="space-y-2"><p className="text-xs uppercase tracking-wider text-slate-500">Solver</p><ExplorerLink address={submission.solver} label={submission.solver.toBase58()} /></div>
      <StatusBadge status={submission.status} />
    </div>
    {rejected && <p className="rounded-lg border border-red-900 bg-red-950/50 p-3 text-sm leading-6 text-red-300">{submission.reason ?? "Rejected by verifier quorum. No payout."}</p>}
    <LeanProof code={submission.proof} />
    <div className="grid gap-3 lg:grid-cols-3">{bounty.verifiers.map((verifier, index) => {
      const vote = submission.votes.find((v) => v.verifierIndex === index);
      const color = !vote ? "border-slate-800 bg-slate-950/50" : vote.approve ? "border-emerald-900 bg-emerald-950/20" : "border-red-900 bg-red-950/20";
      return <div key={verifier.toBase58()} className={`rounded-lg border p-4 ${color}`}>
        <div className="mb-3 flex items-center justify-between gap-2 text-xs"><span className="text-slate-400">Verifier {index + 1}</span><span className={!vote ? "text-slate-500" : vote.approve ? "text-emerald-300" : "text-red-300"}>{!vote ? "○ Waiting" : vote.approve ? "✓ Approve" : "✕ Reject"}</span></div>
        <ExplorerLink address={verifier} />
        <p className="my-3 text-xs leading-5 text-slate-300">{vote?.reason ?? "Awaiting independent Lean verification."}</p>
        {vote && <ExplorerLink transaction={vote.transaction} label="Vote transaction" />}
      </div>;
    })}</div>
    <div className="flex flex-wrap justify-between gap-3 text-xs text-slate-500"><span>{submission.submittedAt ? `${new Date(submission.submittedAt).toLocaleTimeString()} · ` : ""}{submission.votes.filter((v) => v.approve).length} approvals / {submission.votes.filter((v) => !v.approve).length} rejections · 2 of 3 required</span><div className="flex gap-4"><ExplorerLink address={submission.address} label="Submission account" /><ExplorerLink transaction={submission.transaction} label="Submit transaction" /></div></div>
  </article>;
}
