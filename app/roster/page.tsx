import { redirect } from "next/navigation";

/** A retired address: this list is now the Agents page. The query string is kept. */
export default async function RetiredPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, v);
  }
  const qs = query.toString();
  redirect(qs ? `/agents?${qs}` : "/agents");
}
