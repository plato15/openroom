import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";

export { env };
export const fetchApp = (req: Request): Promise<Response> => (exports as unknown as { default: Fetcher }).default.fetch(req);
