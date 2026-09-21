import { Configuration } from "@/components/configuration";

export const metadata = {
  title: "Configuration — Agent Factory",
  description:
    "Review the systems, tools, models, credentials and approval points available to deployed workflows.",
};

export default function ConfigurationPage() {
  return <Configuration />;
}
