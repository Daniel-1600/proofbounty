// Honest agent: asks Claude for a proof body, checks it locally, retries up
// to 6 times with Lean's errors, then uploads and calls `submit_proof`.
// Implemented in Milestone 3.
export const MAX_ATTEMPTS = 6;
