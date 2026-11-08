// Account listing that tolerates undecodable accounts. Program.account.x.all()
// rejects the whole list if any single account fails to decode (for example an
// account written by an older layout), so decode one by one and skip failures.
import type { Program } from "@coral-xyz/anchor";
import type { GetProgramAccountsFilter, PublicKey } from "@solana/web3.js";

export interface Decoded<T> {
  publicKey: PublicKey;
  account: T;
}

export async function listAccounts<T>(
  program: Program,
  /** Account name as the Program's coder knows it (Program camelCases IDL names). */
  kind: "bounty" | "submission",
  filters: GetProgramAccountsFilter[] = [],
): Promise<Decoded<T>[]> {
  const name = kind;
  const coder = program.coder.accounts;
  const raw = await program.provider.connection.getProgramAccounts(program.programId, {
    filters: [{ memcmp: coder.memcmp(name) }, ...filters],
  });
  const out: Decoded<T>[] = [];
  for (const { pubkey, account } of raw) {
    try {
      out.push({ publicKey: pubkey, account: coder.decode<T>(name, account.data) });
    } catch {
      // Not decodable with the current layout; ignore.
    }
  }
  return out;
}
