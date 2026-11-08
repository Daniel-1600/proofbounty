#!/usr/bin/env bash
# Starts verifier daemons 0, 1 and 2.
set -euo pipefail
cd "$(dirname "$0")/.."
pids=()
for i in 0 1 2; do
  VERIFIER_INDEX=$i npm -w checker run verifier &
  pids+=($!)
done
trap 'kill "${pids[@]}" 2>/dev/null' EXIT INT TERM
wait
