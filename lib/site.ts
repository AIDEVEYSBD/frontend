/**
 * Where the console lives, for anything that has to name itself in full:
 * the MCP endpoint a client is told to connect to, links in exported records,
 * text the assistant gives out. Never derived from the request, because the
 * request may arrive over a tunnel, a rewrite or a laptop, and the address a
 * person is given has to be the one that works from where they are.
 */
export const PUBLIC_ORIGIN = (process.env.NEXT_PUBLIC_ORIGIN ?? process.env.PUBLIC_ORIGIN ?? "https://agentfactory.autogrc.cloud").replace(/\/+$/, "");

export const MCP_ENDPOINT = `${PUBLIC_ORIGIN}/api/mcp/server`;
