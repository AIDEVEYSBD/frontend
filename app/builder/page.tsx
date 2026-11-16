import { notFound } from "next/navigation";

/**
 * This console has no Builder: it runs and configures the agents it is
 * given, and does not design them. The address answers "not found" so the
 * canvas cannot be reached by typing it either.
 */
export default function BuilderPage() {
  notFound();
}
