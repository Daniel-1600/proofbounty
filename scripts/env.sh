# Sourced by the demo scripts. Reads settings from the repo-root .env without
# executing it. As with Node's process.loadEnvFile, the last occurrence of a
# key wins and variables already set in the environment take precedence.
dotenv_get() {
  [[ -f .env ]] || return 0
  grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- | sed -E "s/^([\"'])(.*)\\1\$/\\2/"
}
# Private RPC (e.g. QuickNode) from .env, else public devnet.
export SOLANA_RPC_URL="${SOLANA_RPC_URL:-$(dotenv_get SOLANA_RPC_URL)}"
export SOLANA_RPC_URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
# Never print the URL itself: private RPC URLs embed an API token.
rpc_host() { local h="${SOLANA_RPC_URL#*://}"; echo "${h%%/*}"; }
