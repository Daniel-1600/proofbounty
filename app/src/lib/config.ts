// The Anchor client validates this only when real mode makes a request.
export const PROGRAM_ID = process.env.NEXT_PUBLIC_PROGRAM_ID;
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";
export const STORE_URL = process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:8787";
