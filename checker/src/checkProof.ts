import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import {
  ALLOWED_AXIOMS, BANNED_DECLARATIONS, BANNED_TOKENS,
  buildLeanFile, LEAN_TIMEOUT_MS, sha256Hex,
} from "@proofbounty/shared";
import type { CheckResult } from "@proofbounty/shared";

const leanDirectory = resolve(__dirname, "../../lean");
const exec = promisify(execFile);

/** Lex nested comments, strings and escaped identifiers separately. */
export function sourceTokens(source: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < source.length) {
    if (/\s/u.test(source[i])) { i++; continue; }
    if (source.startsWith("--", i)) {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (source.startsWith("/-", i)) {
      let depth = 1;
      i += 2;
      while (depth && i < source.length) {
        if (source.startsWith("/-", i)) { depth++; i += 2; }
        else if (source.startsWith("-/", i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) throw new Error("Unterminated comment");
    } else if (source[i] === '"') {
      i++;
      let closed = false;
      while (i < source.length) {
        if (source[i] === "\\") i += 2;
        else if (source[i++] === '"') { closed = true; break; }
      }
      if (!closed) throw new Error("Unterminated string");
      tokens.push("<string>");
    } else if (source[i] === "'") {
      // Character literals may contain delimiters; identifier primes are
      // consumed by the identifier branch below.
      i++;
      if (source[i] === "\\") {
        i += 2;
        while (i < source.length && source[i] !== "'") i++;
      } else {
        const character = source.codePointAt(i);
        if (character === undefined) throw new Error("Unterminated character");
        i += character > 0xffff ? 2 : 1;
      }
      if (source[i++] !== "'") throw new Error("Malformed character literal");
      tokens.push("<character>");
    } else if (source[i] === "«") {
      const end = source.indexOf("»", i + 1);
      if (end < 0) throw new Error("Unterminated escaped identifier");
      tokens.push(source.slice(i + 1, end));
      i = end + 1;
    } else {
      const identifier = /^[\p{L}_][\p{L}\p{N}_'!?]*/u.exec(source.slice(i));
      if (identifier) { tokens.push(identifier[0]); i += identifier[0].length; }
      else { tokens.push(source[i++]); }
    }
  }
  return tokens;
}

function banned(source: string): string | undefined {
  const tokens = sourceTokens(source);
  for (const entry of [...BANNED_TOKENS, ...BANNED_DECLARATIONS]) {
    const pattern = sourceTokens(entry);
    if (tokens.some((_, i) => pattern.every((t, j) => tokens[i + j] === t))) return entry;
  }
  const stack: string[] = [];
  const closes: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  for (const token of tokens) {
    if (["(", "[", "{"].includes(token)) stack.push(token);
    else if (Object.hasOwn(closes, token) && stack.pop() !== closes[token]) throw new Error("Unbalanced expression delimiters");
  }
  if (stack.length) throw new Error("Unbalanced expression delimiters");
  if (tokens.some((token, i) => token === "#" && tokens[i + 1] !== "[")) return "Lean command (#)";
  return undefined;
}

export interface LeanRun { output: string; code: number | null; timedOut: boolean }
export interface CheckOptions {
  /** Exact on-chain statement commitment. Two-argument calls are local preflight. */
  theoremHash?: string | readonly number[] | Uint8Array;
  timeoutMs?: number;
  /** Injection for deterministic failure/axiom tests. */
  runner?: (file: string, timeoutMs: number) => Promise<LeanRun>;
}

/** Execute the pinned binary in a read-only, networkless Linux sandbox. */
export async function runLean(file: string, timeoutMs: number): Promise<LeanRun> {
  const toolchain = (await readFile(resolve(leanDirectory, "lean-toolchain"), "utf8")).trim();
  const { stdout } = await exec(process.env.ELAN_BIN ?? "elan", ["which", "lean"], {
    cwd: leanDirectory, timeout: 10_000,
  });
  const binary = stdout.trim();
  const root = dirname(dirname(binary));
  const { stdout: version } = await exec(binary, ["--version"], { timeout: 10_000 });
  if (!version.includes(toolchain.split(":v")[1] + ",")) throw new Error("Lean toolchain version mismatch");
  const work = dirname(file);
  const args = ["--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL", "--clearenv",
    "--ro-bind", "/usr", "/usr", "--ro-bind", "/lib", "/lib", "--ro-bind", "/lib64", "/lib64",
    "--ro-bind", root, root, "--bind", work, "/work", "--proc", "/proc", "--dev", "/dev",
    "--chdir", "/work", "--setenv", "HOME", "/work", "--", "/usr/bin/prlimit", "--as=2147483648",
    "--", binary, "-j", "1", "/work/Proof.lean"];
  return new Promise((resolveRun, reject) => {
    const child = spawn("bwrap", args, { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let timedOut = false;
    let overflow = false;
    const kill = () => {
      if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ } }
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      if (Buffer.byteLength(output) > 1_048_576) { overflow = true; output = output.slice(0, 1_048_576); kill(); }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      resolveRun({ output: output + (overflow ? "\nerror: output limit exceeded" : ""), code, timedOut });
    });
  });
}

export function parseAxioms(output: string): string[] {
  const reports = [...output.matchAll(/^'target' (?:does not depend on any axioms|depends on axioms:\s*\[([^\]]*)\])/gm)];
  if (reports.length !== 1) throw new Error("Missing or ambiguous target axiom report");
  return reports[0][1]?.split(",").map(s => s.trim()).filter(Boolean) ?? [];
}

export async function checkProof(statement: string, proof: string, options: CheckOptions = {}): Promise<CheckResult> {
  const fail = (reason: string, leanOutput = "", axioms: string[] = []): CheckResult => ({ ok: false, reason, axioms, leanOutput });
  let directory: string | undefined;
  try {
    if (options.theoremHash !== undefined) {
      const expected = typeof options.theoremHash === "string" ? options.theoremHash : Buffer.from(options.theoremHash).toString("hex");
      if (!/^[a-f0-9]{64}$/.test(expected) || sha256Hex(statement) !== expected) return fail("Statement hash mismatch");
    }
    if (Buffer.byteLength(statement) + Buffer.byteLength(proof) > 262_144) return fail("Source size limit exceeded");
    for (const [label, text] of [["proof", proof], ["statement", statement]]) {
      const token = banned(text);
      if (token) return fail(`Banned token in ${label}: ${token}`);
    }
    directory = await mkdtemp(resolve(tmpdir(), "proofbounty-"));
    const file = resolve(directory, "Proof.lean");
    // Parentheses keep inputs within expressions; newline terminates line comments.
    await writeFile(file, buildLeanFile(`(\n${statement}\n)`, `(\n${proof}\n)`));
    const result = await (options.runner ?? runLean)(file, options.timeoutMs ?? LEAN_TIMEOUT_MS);
    if (result.timedOut) return fail("Lean timeout", result.output);
    if (result.code !== 0 || /error:/i.test(result.output)) return fail("Lean rejected proof or sandbox failed", result.output);
    const axioms = parseAxioms(result.output);
    const forbidden = axioms.filter(a => !(ALLOWED_AXIOMS as readonly string[]).includes(a));
    if (forbidden.length) return fail(`Forbidden axioms: ${forbidden.join(", ")}`, result.output, axioms);
    return { ok: true, reason: "Lean accepted proof", axioms, leanOutput: result.output };
  } catch (error) {
    return fail(`Checker failure: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
