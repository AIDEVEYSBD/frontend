/**
 * The injection filter for attached agents.
 *
 * The runtime's filter takes its patterns from the spec; an attached agent has
 * no spec, so it gets the platform's standing set. Honest about its scope, as
 * the runtime's docstring is: this catches the careless attempts, and the
 * sharpest attacks have no lexical signature. It is the last control, not the
 * first, which is why the gateway records a hit rather than trusting a miss.
 */

const PHRASES = [
  "ignore (all |any |the )?(previous|prior|above|earlier) (instructions|prompts?|rules)",
  "disregard (all |any |the )?(previous|prior|above|system) (instructions|prompts?|rules)",
  "forget (all |any |the )?(previous|prior|above) (instructions|prompts?)",
  "you are now (a|an|the) ",
  "(reveal|print|show|repeat|output) (me )?(the |your )?(system|hidden|initial) prompt",
  "(exfiltrate|smuggle|leak) ",
  "do not (tell|inform|alert) (the )?(user|operator|admin)",
  "developer mode",
  "jailbreak",
  "(send|post|forward|email) (this|the|all|everything|the data|the file)[^.]{0,60}(to|at) [a-z0-9._-]+@",
  "curl [^\\n]{0,80}\\|\\s*(sh|bash)",
];

const RX = PHRASES.map((p) => new RegExp(p, "i"));

export interface Screen {
  hit: boolean;
  pattern: string;
  excerpt: string;
}

/** Screen untrusted text. Returns the first pattern hit and a short excerpt around it. */
export function screen(text: string): Screen {
  for (const rx of RX) {
    const m = rx.exec(text);
    if (m) {
      const at = Math.max(0, m.index - 40);
      return { hit: true, pattern: rx.source, excerpt: text.slice(at, m.index + m[0].length + 40).replace(/\s+/g, " ") };
    }
  }
  return { hit: false, pattern: "", excerpt: "" };
}

/** The parts of an OpenAI-style request that came from outside: user and tool turns. Never the system prompt. */
export function untrustedText(body: Record<string, unknown>): string {
  const out: string[] = [];
  const messages = Array.isArray(body.messages) ? (body.messages as { role?: string; content?: unknown }[]) : [];
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "tool") continue;
    if (typeof m.content === "string") out.push(m.content);
    else if (Array.isArray(m.content)) for (const part of m.content as { type?: string; text?: string }[]) if (typeof part.text === "string") out.push(part.text);
  }
  if (typeof body.input === "string") out.push(body.input);
  return out.join("\n");
}
