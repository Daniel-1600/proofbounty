// Azure OpenAI v1 API through the standard `openai` client (not AzureOpenAI).
// Settings come from .env: AZURE_OPENAI_BASE_URL, AZURE_OPENAI_API_KEY,
// AZURE_OPENAI_MODEL. No api-version is needed for the v1 API.
import OpenAI from "openai";

let client: OpenAI | undefined;
function getClient(): OpenAI {
  client ??= new OpenAI({
    baseURL: process.env.AZURE_OPENAI_BASE_URL,
    apiKey: process.env.AZURE_OPENAI_API_KEY,
  });
  return client;
}

export function modelName(): string {
  const model = process.env.AZURE_OPENAI_MODEL;
  if (!model) throw new Error("AZURE_OPENAI_MODEL is not set");
  return model;
}

/** Sends one prompt and returns the model's raw text. */
export async function generate(prompt: string): Promise<string> {
  const response = await getClient().responses.create({ model: modelName(), input: prompt });
  return response.output_text;
}

/**
 * Reduces model output to a proof body (e.g. "by simp"): strips ``` / ```lean
 * fences and any "theorem ... :=" header the model echoes back.
 */
export function cleanProof(raw: string): string {
  let text = raw.trim();
  const fenced = /```[a-zA-Z0-9_-]*[ \t]*\r?\n([\s\S]*?)```/.exec(text);
  if (fenced) text = fenced[1];
  text = text.replace(/^```[a-zA-Z0-9_-]*\s*|```\s*$/g, "").trim();
  // Drop an echoed declaration header, up to the first top-level ":=".
  const header = /^(?:theorem|lemma|example)\b/.exec(text);
  if (header) {
    const at = topLevelAssign(text);
    if (at >= 0) text = text.slice(at + 2);
  }
  // The checker appends its own `#print axioms`; drop an echoed one.
  text = text.replace(/^\s*#print\s+axioms\b.*$/gm, "");
  return text.trim();
}

/** Index of the first ":=" not nested in brackets, or -1. */
function topLevelAssign(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length - 1; i++) {
    const c = text[i];
    if ("([{⟨".includes(c)) depth++;
    else if (")]}⟩".includes(c)) depth--;
    else if (depth === 0 && c === ":" && text[i + 1] === "=") return i;
  }
  return -1;
}
