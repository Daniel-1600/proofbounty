import type { BountyView, SubmissionView } from "../../lib/client";
import type { PublicKey } from "@solana/web3.js";

export function statusName(status: BountyView["status"] | SubmissionView["status"]) {
  const value = Object.keys(status)[0];
  return value[0].toUpperCase() + value.slice(1);
}
export function StatusBadge({ status }: { status: BountyView["status"] | SubmissionView["status"] }) {
  const name = statusName(status);
  const color = name === "Rejected" ? "border-red-800 bg-red-950/50 text-red-300"
    : name === "Solved" || name === "Accepted" ? "border-emerald-800 bg-emerald-950/50 text-emerald-300"
    : name === "Open" || name === "Pending" ? "border-amber-800 bg-amber-950/50 text-amber-300"
    : "border-slate-700 bg-slate-800 text-slate-400";
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${color}`}>{name}</span>;
}
export function sol(lamports: { toString(): string }) {
  const value = BigInt(lamports.toString());
  const fraction = (value % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return `${value / 1_000_000_000n}${fraction ? `.${fraction}` : ""}`;
}
export function short(address: string) { return `${address.slice(0, 5)}…${address.slice(-5)}`; }
export function ExplorerLink({ address, transaction, label }: { address?: PublicKey; transaction?: string; label?: string }) {
  const value = transaction ?? address?.toBase58() ?? "";
  return <a className="explorer" href={`https://explorer.solana.com/${transaction ? "tx" : "address"}/${value}?cluster=devnet`} target="_blank" rel="noopener noreferrer" title={value}>{label ?? short(value)} ↗</a>;
}
export function ErrorMessage({ message }: { message: string }) {
  return <p role="alert" className="rounded-lg border border-red-900 bg-red-950/30 p-4 text-sm text-red-300">{message}</p>;
}
