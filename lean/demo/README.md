# Verified core-Lean demo proofs

Toolchain: `leanprover/lean4:v4.22.0` (no Mathlib).

Each `.lean` file contains `theorem target`, its known-good proof and
`#print axioms target`. The exact statement is the text between `theorem target : `
and ` :=`; hash that text unchanged when posting a bounty. The proof body starts
at `by`. Checker tests extract and compile both through the hardened sandbox.

| File | Statement | Known-good proof attempts |
|---|---|---|
| `reverse_reverse.lean` | Reverse twice returns the original Nat list | 1 |
| `nat_add_zero.lean` | Adding zero preserves a Nat | 1 |
| `nat_add_comm.lean` | Nat addition is commutative | 1 |
| `length_append.lean` | Append adds list lengths | 2 |

These are hand-written proof attempts, not measured Claude attempts.

Direct compilation from the repository root, with elan on PATH:

```sh
(cd lean && lean demo/reverse_reverse.lean)
(cd lean && lean demo/nat_add_zero.lean)
(cd lean && lean demo/nat_add_comm.lean)
(cd lean && lean demo/length_append.lean)
```
