const tokens = /(--[^\n]*|\b(?:by|intro|intros|exact|apply|simp|rw|rfl|sorry|axiom|theorem|have|decide|sorryAx)\b|\b(?:Nat|List|reverse|length|add_comm|add_zero|length_append|reverse_reverse)\b)/g;
/** Untrusted proof text is rendered as React nodes, never injected HTML. */
export function LeanProof({ code }: { code: string }) {
  return <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-4 text-sm leading-7"><code>{code.split(tokens).map((token, i) => {
    const color = /^(sorry|axiom|sorryAx)$/.test(token) ? "text-red-400 font-bold"
      : token.startsWith("--") ? "text-slate-500"
      : /^(by|intro|intros|exact|apply|simp|rw|rfl|theorem|have|decide)$/.test(token) ? "text-violet-300"
      : /^(Nat|List|reverse|length|add_comm|add_zero|length_append|reverse_reverse)$/.test(token) ? "text-sky-300" : "text-slate-300";
    return <span key={i} className={color}>{token}</span>;
  })}</code></pre>;
}
