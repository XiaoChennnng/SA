import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveResearchSettings } from "../src/research/settings.ts";

function remoteKey(display: string): string {
	return createHash("sha256").update(display).digest("hex").slice(0, 16);
}

describe("workspace-derived research settings", () => {
	it("derives local research storage from the workspace", () => {
		const cwd = join(tmpdir(), "sa-research-settings-local");
		const settings = resolveResearchSettings({}, { localCwd: cwd, workspaceKind: "local", workspaceCwd: cwd });
		expect(settings.workspaceDir).toBe(join(cwd, "research", "workspace"));
		expect(settings.knowledgePath).toBe(join(cwd, "research", "knowledge", "research.md"));
		expect(settings.cacheDir).toBe(join(cwd, "research", "cache"));
		expect(settings.workDir).toBe(join(cwd, "research", "work"));
	});

	it("keeps remote research files remote and local knowledge/cache per workspace", () => {
		const localCwd = join(tmpdir(), "sa-research-settings-local");
		const display = "alice@gpu:/data/project";
		const settings = resolveResearchSettings(
			{},
			{
				localCwd,
				workspaceKind: "ssh",
				workspaceCwd: "/data/project",
				workspaceDisplay: display,
				remoteHome: "/home/alice",
			},
		);
		const root = join(localCwd, "research", "remote", remoteKey(display));
		expect(settings.workspaceDir).toBe("/data/project/research/workspace");
		expect(settings.knowledgePath).toBe(join(root, "knowledge", "research.md"));
		expect(settings.cacheDir).toBe(join(root, "cache"));
		expect(settings.workDir).toBe(join(root, "work"));

		const other = resolveResearchSettings(
			{},
			{
				localCwd,
				workspaceKind: "ssh",
				workspaceCwd: "/data/project",
				workspaceDisplay: "alice@gpu2:/data/project",
			},
		);
		expect(other.cacheDir).not.toBe(settings.cacheDir);
	});

	it("resolves explicit overrides against the correct workspace", () => {
		const localCwd = join(tmpdir(), "sa-research-settings-local");
		const absoluteCache = join(tmpdir(), "sa-research-settings-absolute-cache");
		const remote = resolveResearchSettings(
			{
				workspaceDir: "custom/workspace",
				knowledgePath: "custom/knowledge.md",
				cacheDir: absoluteCache,
			},
			{
				localCwd,
				workspaceKind: "ssh",
				workspaceCwd: "/data/project",
				workspaceDisplay: "alice@gpu:/data/project",
			},
		);
		expect(remote.workspaceDir).toBe("/data/project/custom/workspace");
		expect(remote.knowledgePath).toBe(join(localCwd, "custom", "knowledge.md"));
		expect(remote.cacheDir).toBe(absoluteCache);

		const local = resolveResearchSettings(
			{ workspaceDir: "custom/workspace", knowledgePath: "custom/knowledge.md" },
			{ localCwd, workspaceKind: "local", workspaceCwd: localCwd },
		);
		expect(local.workspaceDir).toBe(join(localCwd, "custom", "workspace"));
		expect(local.knowledgePath).toBe(join(localCwd, "custom", "knowledge.md"));
	});

	it("falls back to the process working directory when no context is provided", () => {
		const settings = resolveResearchSettings({});
		expect(settings.workspaceDir).toBe(join(process.cwd(), "research", "workspace"));
		expect(settings.knowledgePath).toBe(join(process.cwd(), "research", "knowledge", "research.md"));
	});
});
