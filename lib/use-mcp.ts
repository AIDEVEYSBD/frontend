"use client";

import { useCallback, useEffect, useState } from "react";
import { soon } from "./soon";
import { listServers, type McpServer, type PinnedTool, type RegisteredServer } from "./api/l6";
import { toolRisk } from "./mcp-registry";
import type { Risk, Tool } from "./spec";

/**
 * The tool servers this deployment has registered, as the backend's MCP
 * registry lists them (phase L6, lib/api/l6.ts), and the shape each pinned
 * tool takes as a spec binding. Read by the builder's tool rail, which
 * offers only approved servers' tools (lib/mcp-registry.ts railOf), and by
 * the Configuration page, where servers are added, approved, rescanned and
 * removed.
 */
export type { McpServer } from "./api/l6";
export type McpTool = PinnedTool;

/**
 * A pinned tool as a spec binding, registered the way the platform registers
 * it (agentfactory tools/servers/calls.py `registered`): at the risk the
 * approving platform admin set, destructive when none was set; what it
 * returns is always untrusted (it came from outside); and it acts outside
 * unless its risk is read. The server's hints decide none of this. An author
 * may still raise the risk in the inspector, never lower it below this.
 */
export function toolOf(server: Pick<McpServer, "id">, t: McpTool): Tool {
  const risk: Risk = toolRisk(t).risk;
  return {
    name: `${server.id}.${t.name}`,
    risk,
    server: server.id,
    remote_name: t.name,
    summary: (t.description ?? "").slice(0, 240),
    params: t.inputSchema,
    taints: true,
    ...(risk !== "read" ? { is_sink: true } : {}),
  };
}

export function useMcp() {
  const [servers, setServers] = useState<RegisteredServer[] | null>(null);
  const [twoPerson, setTwoPerson] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const r = await listServers();
      setServers(r.servers);
      setTwoPerson(r.two_person);
      setError("");
    } catch (e) {
      setServers((s) => s ?? []);
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => soon(refresh), [refresh]);
  // A pin approved in another tab (the builder links to Configuration in a
  // new one) shows up when this one is looked at again.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);
  return { servers, twoPerson, error, refresh };
}
