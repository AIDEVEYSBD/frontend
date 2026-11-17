import path from "node:path";

/**
 * Where the runtime's files are, for the console routes that still read
 * them: the checkout beside this one by default, or wherever
 * AGENTFACTORY_RUNTIME_ROOT says (the backend reads the same variable). A
 * console deployed on its own has no runtime beside it; every reader treats
 * a missing file as "nothing yet".
 */
export const RUNTIME_ROOT = process.env.AGENTFACTORY_RUNTIME_ROOT ? path.resolve(process.env.AGENTFACTORY_RUNTIME_ROOT) : path.resolve(process.cwd(), "..", "runtime");
