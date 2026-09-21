import { NoAccess } from "@/components/login";

export const metadata = { title: "No access — Agent Factory" };
export const dynamic = "force-dynamic";

export default async function NoAccessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  return <NoAccess reason={typeof q.reason === "string" ? q.reason : ""} />;
}
