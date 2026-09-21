"use client";

import { useCallback, useEffect, useState } from "react";
import { soon } from "./soon";
import type { Risk, Tool } from "./spec";

/**
 * The custom tool servers this deployment has connected, and the shape each
 * of their tools takes as a spec binding. Read by the builder's tool rail;
 * written by the connect form there.
 */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface McpServer {
  id: string;
  label: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  tools: McpTool[];
  discovered_at: string;
}

/**
 * MCP tool annotations are hints the server gives about its own behaviour;
 * they set the binding's starting risk, which the author can still raise in
 * the inspector. Absent hints default to "write", never to "read" — an
 * unknown tool is not assumed harmless.
 */
export function toolOf(server: McpServer, t: McpTool): Tool {
  const a = (t.annotations ?? {}) as Record<string, unknown>;
  const risk: Risk = a.destructiveHint === true ? "destructive" : a.readOnlyHint === true ? "read" : "write";
  const openWorld = a.openWorldHint === true;
  return {
    name: `${server.id}.${t.name}`,
    risk,
    server: server.id,
    remote_name: t.name,
    summary: t.description.slice(0, 240),
    params: t.inputSchema,
    ...(openWorld ? { taints: true } : {}),
    ...(openWorld && risk !== "read" ? { is_sink: true } : {}),
  };
}

export function useMcp() {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const refresh = useCallback(async () => {
    try {
      const d = await (await fetch("/api/mcp")).json();
      setServers(d.servers ?? []);
    } catch {
      setServers([]);
    }
  }, []);
  useEffect(() => soon(refresh), [refresh]);
  return { servers, refresh };
}
