#!/usr/bin/env bash
# Store + three verifier daemons. Requires generated deployment IDL and funded keys.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
export PROGRAM_IDL="${PROGRAM_IDL:-$PWD/target/idl/proof_bounty.json}"
export STORE_PORT="${STORE_PORT:-8787}"
export STORE_URL="${STORE_URL:-http://localhost:$STORE_PORT}"
export LOG_DIR="${LOG_DIR:-$PWD/logs}"
export STORE_DIR="${STORE_DIR:-$LOG_DIR/blobs}"
command -v setsid >/dev/null || { echo "setsid (util-linux) is required" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
node -e 'require.resolve("tsx/cjs")' >/dev/null
[[ -r "$PROGRAM_IDL" ]] || { echo "TODO: deploy the program and set PROGRAM_IDL to its generated IDL" >&2; exit 1; }
for i in 0 1 2; do
  [[ -r "keys/verifier-$i.json" ]] || { echo "Missing keys/verifier-$i.json; run the funding script first" >&2; exit 1; }
done
mkdir -p "$LOG_DIR"
pids=()
cleanup() {
  trap - EXIT INT TERM
  if ((${#pids[@]})); then
    # Each child owns a session, including tsx descendants and active Lean jobs.
    for pid in "${pids[@]}"; do kill -TERM -- "-$pid" 2>/dev/null || true; done
    for _ in {1..50}; do
      alive=false
      for pid in "${pids[@]}"; do kill -0 -- "-$pid" 2>/dev/null && alive=true; done
      [[ "$alive" == true ]] || break
      sleep 0.1
    done
    for pid in "${pids[@]}"; do kill -KILL -- "-$pid" 2>/dev/null || true; done
    for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Refuse to use or stop a store owned by another session.
probe="$STORE_URL/blob/$(printf '%064d' 0)"
if curl -s --max-time 2 -o /dev/null "$probe"; then
  echo "A service already uses STORE_URL=$STORE_URL; choose another STORE_PORT/STORE_URL" >&2
  exit 1
fi
setsid node --require tsx/cjs checker/store.ts >"$LOG_DIR/store.log" 2>&1 &
pids+=("$!")
ready=false
for _ in {1..100}; do
  kill -0 "${pids[0]}" 2>/dev/null || { echo "Store exited; see $LOG_DIR/store.log" >&2; exit 1; }
  if [[ "$(curl -s --max-time 1 -o /dev/null -w '%{http_code}' "$probe" || true)" == 404 ]]; then ready=true; break; fi
  sleep 0.1
done
[[ "$ready" == true ]] || { echo "Store did not become ready; see $LOG_DIR/store.log" >&2; exit 1; }
for i in 0 1 2; do
  VERIFIER_INDEX="$i" VERIFIER_KEYPAIR="$PWD/keys/verifier-$i.json" \
    setsid node --require tsx/cjs checker/src/verifier.ts >"$LOG_DIR/verifier-$i.log" 2>&1 &
  pids+=("$!")
done
echo "Store and verifiers 0, 1, 2 started. Logs: $LOG_DIR. Ctrl+C stops all processes."
# A failed child stops the group; do not leave a partially running quorum.
status=0
wait -n "${pids[@]}" || status=$?
echo "A store/verifier process exited (status=$status); stopping all processes" >&2
((status != 0)) || status=1
exit "$status"
