/**
 * The environment a tool server is started with.
 *
 * A spawned MCP server gets what it needs to find its interpreter and its
 * home, plus the variables its registration declares — and nothing else.
 * The console's own environment holds the model key, the database password
 * and every other secret this process was started with; a tool server is
 * somebody else's code, and it is told only what it was told.
 */

const INHERITED = ["PATH", "HOME", "LANG", "TMPDIR"] as const;

export function spawnEnv(declared: Record<string, string> = {}): NodeJS.ProcessEnv {
  // NODE_ENV is part of the process environment's type on this Next.js
  // build; it names a mode, not a secret, and a server may read it.
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
  for (const name of INHERITED) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...declared };
}
