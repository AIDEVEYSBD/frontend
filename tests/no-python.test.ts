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
 * The last process the console started was the A2A tool broker's: it
 * spawned a registered tool server to make one call. The registry itself,
 * discovery included, is the backend's since phase L6, and so is the SDK
 * door (`/api/sdk`), whose run records the console used to write itself;
 * since phase L7 (second round) the broker is the backend's too, reaching
 * tool servers through the runtime (pins checked on every connection,
 * secrets from the vault, isolation, the egress decision), so nothing here
 * starts a process at all.
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

  it("leaves the SDK door to the backend: no source of the console's answers under /api/sdk", () => {
    expect(files.filter((f) => f.startsWith("app/api/sdk/"))).toEqual([]);
  });

  it("starts no process anywhere: the A2A tool broker, the last that did, is the backend's", () => {
    expect(files.filter((f) => CHILD_PROCESS.test(readFileSync(path.join(FRONTEND, f), "utf-8")))).toEqual([]);
    expect(files.filter((f) => f.startsWith("app/api/a2a/") || f === "lib/server/mcp-call.ts")).toEqual([]);
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
