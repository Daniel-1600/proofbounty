// Checker interface (SPEC.md Milestone 2).

export interface CheckResult {
  ok: boolean;
  reason: string;
  axioms: string[];
  leanOutput: string;
}

/** `checkProof(statement, proof)`; implemented in checker/src/checkProof.ts. */
export type CheckProof = (statement: string, proof: string) => Promise<CheckResult>;

/** The only axioms `#print axioms target` may report. */
export const ALLOWED_AXIOMS = ["propext", "Classical.choice", "Quot.sound"] as const;

/** Proof text containing any of these tokens is rejected before Lean runs. */
export const BANNED_TOKENS = [
  "sorry", "admit", "axiom", "native_decide", "implemented_by", "extern",
  "unsafe", "partial", "opaque", "@[", "set_option", "macro", "syntax",
  "elab", "run_cmd", "#eval", "import", "open private", "attribute",
  "local instance",
] as const;

/** Declarations that may not appear inside a proof body. */
export const BANNED_DECLARATIONS = ["theorem", "def", "instance"] as const;

export const LEAN_TIMEOUT_MS = 60_000;

/** The checker, never the agent, builds the Lean file. */
export function buildLeanFile(statement: string, proof: string): string {
  return `theorem target : ${statement} := ${proof}\n#print axioms target\n`;
}
