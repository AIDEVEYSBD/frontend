"use client";

import { useState } from "react";
import { Button } from "./ui";

/**
 * Code on a page, and the button that copies it.
 *
 * One highlighter for every snippet the console shows (attach an agent,
 * connect an application, call the retrieval door): comments, strings,
 * keywords, decorators, numbers. Enough to read as code; never a dependency.
 */

export type CodeLang = "python" | "typescript" | "java" | "csharp" | "go" | "env" | "json" | "http" | "bash";

const KEYWORDS: Record<CodeLang, string[]> = {
  python: ["from", "import", "def", "return", "with", "as", "if", "else", "elif", "for", "in", "not", "and", "or", "class", "None", "True", "False", "async", "await", "try", "except", "raise", "print"],
  typescript: ["import", "from", "const", "let", "var", "new", "async", "await", "if", "else", "return", "function", "export", "default", "true", "false", "null", "class", "try", "catch"],
  java: ["import", "new", "try", "if", "else", "return", "void", "public", "private", "static", "final", "class", "var", "true", "false", "null"],
  csharp: ["using", "var", "new", "await", "async", "public", "private", "static", "string", "void", "if", "else", "return", "true", "false", "null", "class"],
  go: ["import", "func", "defer", "if", "else", "return", "var", "map", "any", "string", "nil", "true", "false", "go", "range", "for", "package", "type", "struct", "error"],
  env: [],
  json: [],
  http: ["GET", "POST", "PUT", "DELETE"],
  bash: ["curl", "export", "echo"],
};

const TOKEN = /(#[^\n]*|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|@[A-Za-z_][\w.]*|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b)/g;

export function Code({ text, lang, className = "" }: { text: string; lang: CodeLang; className?: string }) {
  const keywords = new Set(KEYWORDS[lang]);
  const hashComments = lang === "python" || lang === "env" || lang === "bash";
  const parts: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) parts.push(text.slice(last, i));
    const tok = m[0];
    let cls = "";
    if (tok.startsWith("#") && hashComments) cls = "text-ghost";
    else if (tok.startsWith("//") && !hashComments && lang !== "http") cls = "text-ghost";
    else if (/^["'`]/.test(tok)) cls = "text-c4";
    else if (tok.startsWith("@")) cls = "text-c7";
    else if (/^\d/.test(tok)) cls = "text-c8";
    else if (keywords.has(tok)) cls = "text-c10";
    parts.push(cls ? <span key={k++} className={cls}>{tok}</span> : tok);
    last = i + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <pre className={`m-0 overflow-x-auto px-4 py-3 font-mono text-[10.5px] leading-[1.65] text-mist ${className}`}>
      {parts}
    </pre>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="solid"
      tone={done ? "ok" : "ink"}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        });
      }}
    >
      {done ? "Copied" : label}
    </Button>
  );
}
