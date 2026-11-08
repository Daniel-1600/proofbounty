import type { CheckProof, CheckResult } from "@proofbounty/shared";

/** Hardened Lean checker. Implemented in Milestone 2. */
export const checkProof: CheckProof = async (_statement, _proof): Promise<CheckResult> => {
  throw new Error("checkProof: not implemented");
};
