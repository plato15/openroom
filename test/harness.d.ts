// Types for "./harness". At run time each vitest config points it at harness.workers.ts or harness.node.ts.
import type { Env } from "../src/env";

export declare const env: Env;
export declare const fetchApp: (req: Request) => Promise<Response>;
