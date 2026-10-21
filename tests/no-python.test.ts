import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FRONTEND } from "./routes";

/**
 * The console never spawns the runtime.
 *
 * Before phase L2 a dozen routes shelled out to `python3 -m agentfactory`
 * for a check, a vault read, a draft or a run. Those are the backend's doors
 * now (backend/CONTRACT.md), reached through lib/server/backend.ts or the
 * path router, and the done-when of the phase is that nothing under app/ or
 * lib/ starts a Python process. This reads every source file and fails on
 * the first that does, so the habit cannot creep back one route at a time.
 *
 * The MCP helpers in lib/server still spawn a registered tool server by the
 * command its registration names; that is the MCP registry's job until it
 * moves, and it is not a hard-coded interpreter.
 */

function sources(dir: string): string[] {
  const base = path.join(FRONTEND, dir);
  const out: string[] = [];
  for (const rel of readdirSync(base, { recursive: true }) as string[]) {
    if (/\.(ts|tsx)$/.test(rel) && !rel.endsWith(".d.ts")) out.push(path.join(dir, rel).split(path.sep).join("/"));
  }
  return out.sort();
}

/** A child_process call whose command is a Python interpreter, literally. */
const SPAWNS_PYTHON = /\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync|fork)\s*\(\s*["'`]python\d?(?:\.\d+)?\b/;
/** The module that starts processes, however it is imported. */
const CHILD_PROCESS = /(?:from\s+|require\(\s*)["'](?:node:)?child_process["']/;

const files = [...sources("app"), ...sources("lib")];

describe("no python3 subprocess in the console", () => {
  it("reads the sources", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const file of files) {
    it(`${file} does not start a Python process`, () => {
      const text = readFileSync(path.join(FRONTEND, file), "utf-8");
      expect(SPAWNS_PYTHON.test(text), `${file} spawns a Python interpreter; every runtime step is a backend call (lib/server/backend.ts)`).toBe(false);
      if (CHILD_PROCESS.test(text)) {
        // A file that can start processes must not know Python at all: not
        // as a command held in a constant, not as `-m agentfactory` arguments.
        expect(/python|agentfactory\b.*-m\b|-m\b.*agentfactory/i.test(text), `${file} imports child_process and names Python or the runtime module`).toBe(false);
      }
    });
  }
});
