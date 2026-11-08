"use client";

import Link from "next/link";
import dynamic from "next/dynamic";

const WalletButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false, loading: () => <button className="button-secondary" disabled>Connect wallet</button> },
);

export function Header() {
  return (
    <header className="border-b border-slate-800">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-5 px-5 py-6">
        <Link href="/" className="space-y-1">
          <div className="text-xl font-semibold tracking-tight text-white">ProofBounty <span className="ml-2 rounded border border-slate-700 px-2 py-1 text-xs font-normal text-slate-400">devnet</span></div>
          <p className="text-sm text-slate-400">Paid only for proofs Lean accepts.</p>
        </Link>
        <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-4 text-sm">
          <Link href="/" className="text-slate-300 hover:text-white">Bounties</Link>
          <Link href="/bounties/new" className="text-slate-300 hover:text-white">Post a bounty</Link>
          <WalletButton />
        </nav>
      </div>
    </header>
  );
}
