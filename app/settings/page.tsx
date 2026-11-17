import { redirect } from "next/navigation";

/**
 * Settings is part of Configuration now: its providers, models and keys are
 * panels there (components/configuration.tsx), and this address lands on the
 * models, with whatever query it carried.
 */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) for (const one of [v ?? []].flat()) query.append(k, one);
  const qs = query.toString();
  redirect(`/configuration${qs ? `?${qs}` : ""}#models`);
}
