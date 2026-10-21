"use client";

import { useCallback, useEffect, useState } from "react";
import { soon } from "./soon";
import { listServers, type McpServer, type PinnedTool } from "./api/l6";
import { toolHints } from "./mcp-registry";
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
 * MCP tool annotations are hints the server gives about its own behaviour;
 * they set the binding's starting risk, which the author can still raise in
 * the inspector. Absent hints default to "write", never to "read" — an
 * unknown tool is not assumed harmless.
 */
export function toolOf(server: Pick<McpServer, "id">, t: McpTool): Tool {
  const a = (t.annotations ?? {}) as Record<string, unknown>;
  // The one rule, shared with the registry's tool chips (lib/mcp-registry.ts toolHints).
  const risk: Risk = toolHints(t).risk;
  const openWorld = a.openWorldHint === true;
  return {
    name: `${server.id}.${t.name}`,
    risk,
    server: server.id,
    remote_name: t.name,
    summary: (t.description ?? "").slice(0, 240),
    params: t.inputSchema,
    ...(openWorld ? { taints: true } : {}),
    ...(openWorld && risk !== "read" ? { is_sink: true } : {}),
  };
}

export function useMcp() {
  const [servers, setServers] = useState<McpServer[] | null>(null);
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
