import { Dependencies } from "@/components/dependencies";

export const metadata = {
  title: "Dependencies — Saros",
  description: "What every agent depends on, declared by its spec and seen in its runs, and the blast radius of any tool, server, peer, model or agent.",
};

export default function DependenciesPage() {
  return <Dependencies />;
}
