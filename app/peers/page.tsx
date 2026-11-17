import { redirect } from "next/navigation";

/**
 * The peer registry is a panel of Configuration now (components/
 * configuration.tsx), and this address lands on it, with whatever query it
 * carried.
 */
export default async function PeersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) for (const one of [v ?? []].flat()) query.append(k, one);
  const qs = query.toString();
  redirect(`/configuration${qs ? `?${qs}` : ""}#peers`);
}
