"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { BN } from "@coral-xyz/anchor";
import Link from "next/link";
import { client } from "../../../../lib/client";
import { ErrorMessage } from "../../../components/display";

export default function NewBounty() {
  const router = useRouter();
  const { publicKey, signTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const [statement, setStatement] = useState("∀ (n : Nat), n + 0 = n");
  const [reward, setReward] = useState("0.25");
  const [deadline, setDeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!publicKey) { setVisible(true); return; }
    try {
      if (!/^\d+(?:\.\d{1,9})?$/.test(reward)) throw new Error("Enter a positive SOL amount with up to 9 decimal places.");
      const [whole, fraction = ""] = reward.split(".");
      const lamports = new BN(whole).mul(new BN(1_000_000_000)).add(new BN(fraction.padEnd(9, "0")));
      const unixDeadline = Math.floor(new Date(deadline).getTime() / 1000);
      if (!Number.isFinite(unixDeadline) || unixDeadline <= Math.floor(Date.now() / 1000)) throw new Error("Choose a deadline in the future.");
      setBusy(true);
      const bounty = await client.createBounty({ creator: publicKey, statement, reward: lamports, deadline: new BN(unixDeadline), signTransaction });
      router.push(`/bounties/${bounty.address.toBase58()}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create bounty.");
    } finally { setBusy(false); }
  }

  return <div className="mx-auto max-w-2xl space-y-6">
    <Link href="/" className="text-sm text-slate-400 hover:text-white">← All bounties</Link>
    <div><h1 className="text-3xl font-semibold text-white">Post a bounty</h1><p className="mt-3 text-sm leading-6 text-slate-400">Write the exact Lean 4 proposition you want proved. Two independent approvals release the reward to the solver.</p></div>
    <p className="rounded-lg border border-amber-900 bg-amber-950/20 p-4 text-sm text-amber-200">Mock mode: this saves a demo bounty in your browser. Connect Phantom for the creator address. No transaction is signed and no SOL is transferred.</p>
    <form onSubmit={submit} className="panel space-y-6">
      <div><label className="label" htmlFor="statement">Lean statement</label><textarea id="statement" className="field min-h-40 font-mono leading-7" required maxLength={20000} value={statement} onChange={(e) => setStatement(e.target.value)} spellCheck={false} aria-describedby="statement-help" /><p id="statement-help" className="mt-2 text-xs text-slate-500">Proposition only, without theorem name or proof. Lean 4 core; no Mathlib. Exact text, including whitespace, is SHA-256 hashed.</p></div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div><label className="label" htmlFor="reward">Reward in SOL</label><input id="reward" className="field" required inputMode="decimal" value={reward} onChange={(e) => setReward(e.target.value)} aria-describedby="reward-help" /><p id="reward-help" className="mt-2 text-xs text-slate-500">Up to 9 decimal places; 1 SOL = 10⁹ lamports.</p></div>
        <div><label className="label" htmlFor="deadline">Deadline</label><input id="deadline" className="field [color-scheme:dark]" type="datetime-local" required value={deadline} onChange={(e) => setDeadline(e.target.value)} aria-describedby="deadline-help" /><p id="deadline-help" className="mt-2 text-xs text-slate-500">Your local time. Stored as Unix seconds.</p></div>
      </div>
      {error && <ErrorMessage message={error} />}
      <button className="button-primary w-full" disabled={busy} type="submit">{busy ? "Hashing & creating…" : publicKey ? "Create demo bounty" : "Connect Phantom to create"}</button>
    </form>
  </div>;
}
