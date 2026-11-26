import { describe, expect, it } from "vitest";
import { isSafeModelDataFileName } from "../src/core/model-data-cache.ts";
import { isUpdateAvailable } from "../src/core/update.ts";

describe("model data file names", () => {
	it("accepts provider data files", () => {
		expect(isSafeModelDataFileName("anthropic.json")).toBe(true);
	});

	it("rejects path traversal", () => {
		expect(isSafeModelDataFileName("../anthropic.json")).toBe(false);
	});

	it("rejects non-json files", () => {
		expect(isSafeModelDataFileName("anthropic.txt")).toBe(false);
	});
});

describe("update version comparison", () => {
	it("treats a higher build suffix as an update", () => {
		expect(isUpdateAvailable("0.1.2-1030", "0.1.2-1031")).toBe(true);
	});

	it("treats a lower build suffix as up to date", () => {
		expect(isUpdateAvailable("0.1.2-1031", "0.1.2-1030")).toBe(false);
	});

	it("treats the same version as up to date", () => {
		expect(isUpdateAvailable("0.1.2-1030", "0.1.2-1030")).toBe(false);
	});

	it("treats a higher base version as an update", () => {
		expect(isUpdateAvailable("0.1.2-1030", "0.1.3-1")).toBe(true);
	});
});
