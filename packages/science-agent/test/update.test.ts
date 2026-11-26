import { describe, expect, it } from "vitest";
import { isUpdateAvailable } from "../src/core/update.ts";

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
