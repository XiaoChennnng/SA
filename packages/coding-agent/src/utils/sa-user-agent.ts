import { formatUserAgent } from "@sa/ai";

/** sa's `User-Agent` for its own network requests; the same detailed form sa-ai sends to providers. */
export function getSaUserAgent(version: string): string {
	return formatUserAgent({ userAgent: "detailed", version });
}
