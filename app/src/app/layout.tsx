import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";
import { useMock } from "../../lib/client";
import { WalletProviders } from "../components/wallet-provider";
import { Header } from "../components/header";

export const metadata = {
  title: "ProofBounty",
  description: "Paid only for proofs Lean accepts. A Solana proof bounty market.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProviders>
          <Header />
          <main className="mx-auto max-w-6xl px-5 py-10">{children}</main>
          <footer className="mx-auto max-w-6xl px-5 pb-8 text-xs text-slate-500">{useMock ? "Mock demo · No SOL moves. Explorer links point to simulated devnet addresses and transactions." : "Solana devnet · Rewards are held in on-chain escrow."}</footer>
        </WalletProviders>
      </body>
    </html>
  );
}
