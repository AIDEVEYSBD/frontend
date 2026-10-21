import { AnswerPage } from "@/components/answer";

/**
 * The external answer page: an outside participant opens the signed link an
 * approver minted (`POST /api/approvals/{run}/links`) and answers one gate.
 * No sign-in: proxy.ts leaves `/answer/` open (lib/route-policy.ts
 * OPEN_PREFIXES) and the chrome stays off it; the token in the path is the
 * whole credential, and the backend spends it on answer.
 */

export const metadata = { title: "Answer a gate — Agent Factory" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AnswerPage token={token} />;
}
