import { Iam } from "@/components/iam";

export const metadata = {
  title: "IAM — Saros",
  description: "Review the people, roles and non-human identities authorized to use or act within Saros.",
};

export default function IamPage() {
  return <Iam />;
}
