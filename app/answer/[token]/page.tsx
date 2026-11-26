import { AnswerPage } from "@/components/answer";

/**
 * The outside approver's page: a person with no platform role opens the
 * single-use link an approver made (`POST /api/approvals/{run}/links`) and
 * answers one gate. They are signed in by the identity proxy like everyone
 * else; the console's chrome stays off this page (lib/route-policy.ts
 * OPEN_PREFIXES), every /api request goes to the platform unchanged, and the
 * platform lets the link answer only for the address it was made for, once.
 */

export const metadata = { title: "Answer a gate — Saros" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AnswerPage token={token} />;
}
