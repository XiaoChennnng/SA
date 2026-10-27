import { describe, expect, it } from "vitest";
import { getSaUserAgent } from "../src/utils/sa-user-agent.ts";

describe("getSaUserAgent", () => {
	it("formats SA's detailed user agent", () => {
		const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
		const userAgent = getSaUserAgent("1.2.3");

		expect(userAgent).toBe(`sa/1.2.3 (${process.platform}; ${runtime}; ${process.arch})`);
		expect(userAgent).toMatch(/^sa\/[^\s()]+ \([^;()]+;\s*[^;()]+;\s*[^()]+\)$/);
	});
});
