import { expect } from "chai";
import { cleanProof } from "./llm";

describe("cleanProof", () => {
  it("keeps a bare proof body", () => {
    expect(cleanProof("by simp")).to.equal("by simp");
  });
  it("strips ```lean fences", () => {
    expect(cleanProof("```lean\nby\n  intro l\n  simp\n```")).to.equal("by\n  intro l\n  simp");
  });
  it("strips plain fences and surrounding prose", () => {
    expect(cleanProof("Here is the proof:\n```\nby omega\n```\nDone.")).to.equal("by omega");
  });
  it("strips an echoed theorem header", () => {
    expect(cleanProof("theorem target : ∀ (n : Nat), n + 0 = n := by\n  intro n\n  rfl")).to.equal("by\n  intro n\n  rfl");
  });
  it("ignores := nested in the statement", () => {
    expect(cleanProof("theorem t : (fun x => let y := x; y) 1 = 1 := rfl")).to.equal("rfl");
  });
  it("strips an echoed header inside fences and a trailing #print axioms", () => {
    const raw = "```lean\ntheorem target : a + b = b + a := by\n  exact Nat.add_comm a b\n#print axioms target\n```";
    expect(cleanProof(raw)).to.equal("by\n  exact Nat.add_comm a b");
  });
});
