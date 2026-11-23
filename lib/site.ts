/**
 * Two kinds of address.
 *
 * PUBLIC_ORIGIN is where people reach the console: links to its pages, links
 * in exported records, approval links, text the assistant gives out. Never
 * derived from the request, because the request may arrive over a tunnel, a
 * rewrite or a laptop, and the address a person is given has to be the one
 * that works from where they are.
 *
 * Machines (applications calling the model gateway, attached agents, triggers,
 * signed webhooks, clients of the platform's MCP server) cannot pass the
 * console's sign-in. They reach the service at its own address: the backend's
 * PUBLIC_API_URL, which the session answers as `machineOrigin` and
 * `useMachineOrigin` (lib/use-session.ts) reads at run time, so one console
 * image serves any deployment. A machine address is never built from
 * PUBLIC_ORIGIN: where the deployment names no machine origin, none is printed
 * and the page says so (`noMachineOrigin`).
 */
export const PUBLIC_ORIGIN = (process.env.NEXT_PUBLIC_ORIGIN ?? process.env.PUBLIC_ORIGIN ?? "https://agent-factory.example.com").replace(/\/+$/, "");

/** The platform's own MCP server, beneath the machine origin. */
export const MCP_PATH = "/api/mcp/server";

/** A machine address: the machine origin and the path. Null when the deployment names no machine origin, or it is not read yet. */
export function machineAddress(origin: string | null | undefined, path: string): string | null {
  return origin ? `${origin}${path}` : null;
}

/** What is printed where a machine address would go on a deployment that names none. `consequence` says who cannot reach what. */
export function noMachineOrigin(consequence: string): string {
  return `No machine address is set on this deployment (PUBLIC_API_URL): ${consequence} through the console’s sign-in.`;
}

/** Shown in place of a machine address while the session, which carries the machine origin, is read. */
export const READING_MACHINE_ORIGIN = "Reading the address machines reach this deployment at…";

/** The sentence for a machine address in each state: the address, the reading line, or the plain reason none is printed. */
export function machineLine(origin: string | null | undefined, path: string, consequence: string): string {
  if (origin === undefined) return READING_MACHINE_ORIGIN;
  return machineAddress(origin, path) ?? noMachineOrigin(consequence);
}
