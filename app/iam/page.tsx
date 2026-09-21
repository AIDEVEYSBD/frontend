import { Iam } from "@/components/iam";

export const metadata = {
  title: "IAM — Agent Factory",
  description: "Review the people, roles and non-human identities authorized to use or act within Agent Factory.",
};

export default function IamPage() {
  return <Iam />;
}
