import { strict as assert } from "node:assert";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BANNED_TOKENS, BANNED_DECLARATIONS, LEAN_TIMEOUT_MS, buildLeanFile, sha256Bytes } from "@proofbounty/shared";
import { checkProof, parseAxioms, sourceTokens } from "./checkProof";

const statement = "∀ n : Nat, n + 0 = n";
const proof = "by intro n; rfl";
describe("hardened checker", function () {
  this.timeout(90_000);
  it("accepts a valid proof with the exact on-chain hash", async () => {
    const result = await checkProof(statement, proof, { theoremHash: sha256Bytes(statement) });
    assert.equal(result.ok, true, JSON.stringify(result));
  });
  it("rejects a wrong proof", async () => {
    const result = await checkProof("1 = (2 : Nat)", "by rfl");
    assert.equal(result.ok, false);
    assert.match(result.leanOutput, /error:/);
  });
  it("accepts an allowed classical axiom", async () => {
    const result = await checkProof("∀ P : Prop, P ∨ ¬ P", "by intro P; exact Classical.em P");
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(result.axioms.includes("Classical.choice"));
  });
  for (const token of [...BANNED_TOKENS, ...BANNED_DECLARATIONS]) {
    it(`rejects ${token} before executing Lean`, async () => {
      let ran = false;
      const result = await checkProof(statement, `by ${token}`, { runner: async () => { ran = true; throw new Error("must not run"); } });
      assert.equal(result.ok, false);
      assert.match(result.reason, /Banned token/);
      assert.equal(ran, false);
    });
  }
  it("rejects a hidden core axiom even without banned tokens", async () => {
    // Compiler-trust axiom underlying native evaluation; no native_decide token.
    const result = await checkProof("True", "by exact Lean.trustCompiler");
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.match(result.reason, /Lean.trustCompiler/, JSON.stringify(result));
    assert.ok(result.axioms.includes("Lean.trustCompiler"));
  });
  it("rejects a direct reference to the hidden sorry axiom", async () => {
    const result = await checkProof("False", "by exact sorryAx False false");
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.match(result.reason, /Forbidden axioms: sorryAx/);
  });
  it("rejects a tampered statement before Lean", async () => {
    const result = await checkProof("True", "by trivial", { theoremHash: sha256Bytes(statement), runner: async () => { throw new Error("must not run"); } });
    assert.equal(result.reason, "Statement hash mismatch");
  });
  it("times out and kills a real Lean process", async () => {
    const result = await checkProof(statement, proof, { timeoutMs: 1 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "Lean timeout", JSON.stringify(result));
  });
  it("uses the shared template, default timeout, fresh directory and cleans up", async () => {
    let file = "";
    const result = await checkProof(statement, proof, { runner: async (path, timeout) => {
      file = path;
      assert.equal(timeout, LEAN_TIMEOUT_MS);
      assert.equal(await readFile(path, "utf8"), buildLeanFile(`(\n${statement}\n)`, `(\n${proof}\n)`));
      return { code: 0, timedOut: false, output: "'target' does not depend on any axioms\n" };
    } });
    assert.equal(result.ok, true);
    await assert.rejects(access(file));
  });
  it("matches tokens across comments without matching substrings", async () => {
    assert.deepEqual(sourceTokens("open /- /- nested -/ -/ private"), ["open", "private"]);
    assert.deepEqual(sourceTokens("'(' = '('"), ["<character>", "=", "<character>"]);
    assert.equal((await checkProof(statement, "by open /- gap -/ private")).ok, false);
    const result = await checkProof("True", 'by\n  let sorry_name := "axiom"\n  trivial -- sorry', { runner: async () => ({ code: 0, timedOut: false, output: "'target' does not depend on any axioms\n" }) });
    assert.equal(result.ok, true);
    assert.equal((await checkProof("True", "by exact «sorry»")).ok, false);
  });
  it("rejects malformed comments and command injection", async () => {
    for (const source of ["by trivial /-", "by trivial\n#print axioms True.intro", "by trivial\n-- hide template", "by trivial)\nexample : True := (by trivial"]) {
      const result = await checkProof("False", source);
      assert.equal(result.ok, false);
    }
  });
  it("fails closed on missing/duplicate reports, forbidden axioms and errors", async () => {
    for (const output of ["", "'target' depends on axioms: [evil]\n", "error: forged\n' target'", "'target' does not depend on any axioms\n".repeat(2)]) {
      const result = await checkProof(statement, proof, { runner: async () => ({ code: 0, timedOut: false, output }) });
      assert.equal(result.ok, false);
    }
    assert.throws(() => parseAxioms("'target' does not depend on any axioms\n".repeat(2)));
    assert.deepEqual(parseAxioms("'target' depends on axioms: [propext, Classical.choice, Quot.sound]\n"), ["propext", "Classical.choice", "Quot.sound"]);
    const result = await checkProof(statement, proof, { runner: async () => ({ code: 1, timedOut: false, output: "'target' does not depend on any axioms\n" }) });
    assert.equal(result.ok, false);
  });
  for (const name of ["reverse_reverse", "nat_add_zero", "nat_add_comm", "length_append"]) {
    it(`compiles demo ${name} using the sandbox`, async () => {
      const source = await readFile(resolve(__dirname, `../../lean/demo/${name}.lean`), "utf8");
      const match = /^theorem target : (.+) := (.+)\n#print axioms target\n$/s.exec(source);
      assert.ok(match);
      const result = await checkProof(match[1], match[2]);
      assert.equal(result.ok, true, JSON.stringify(result));
    });
  }
});
