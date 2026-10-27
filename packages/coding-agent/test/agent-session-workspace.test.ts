import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@sa/agent-core";
import { getModel, streamSimple } from "@sa/ai/compat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createLocalWorkspace } from "../src/core/workspace/local.ts";
import { FakeRemoteWorkspace } from "./helpers/fake-remote-workspace.ts";
import { createModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";
import { createTestResourceLoader } from "./utilities.ts";

describe("AgentSession workspace switching", () => {
	let session: AgentSession;
	let tempDir: string;

	beforeEach(async () => {
		tempDir = join(tmpdir(), `sa-workspace-switch-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const agent = new Agent({
			streamFn: streamSimple,
			initialState: { model, systemPrompt: "Test", tools: [] },
		});
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		await authStorage.modify("anthropic", async () => ({ type: "api_key", key: "test-key" }));
		const modelRegistry = await createModelRegistry(authStorage, tempDir);
		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(tempDir),
			settingsManager,
			cwd: tempDir,
			modelRuntime: getModelRuntime(modelRegistry),
			resourceLoader: createTestResourceLoader(),
		});
	});

	afterEach(() => {
		session.dispose();
		if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true });
	});

	it("switches tools, research storage, and prompt to a remote workspace and back", async () => {
		expect(session.getWorkspace().info.kind).toBe("local");
		expect(session.systemPrompt).not.toContain("<workspace>");
		expect(session.getResearchSettings().workspaceDir).toBe(join(tempDir, "research", "workspace"));
		expect(session.getResearchSettings().knowledgePath).toBe(join(tempDir, "research", "knowledge", "research.md"));
		const remote = new FakeRemoteWorkspace();
		await session.setWorkspace(remote);
		expect(session.getWorkspace().info.kind).toBe("ssh");
		expect(session.systemPrompt).toContain("Remote SSH workspace: tester@host:/work");
		expect(session.getResearchSettings().workspaceDir).toBe("/work/research/workspace");
		expect(session.getResearchSettings().knowledgePath).toContain(join(tempDir, "research", "remote"));
		expect(session.getResearchSettings().cacheDir).toContain(join(tempDir, "research", "remote"));
		expect(session.getActiveToolNames()).toContain("read");
		expect(session.getActiveToolNames()).toContain("python_run");
		await session.setWorkspace(createLocalWorkspace(tempDir));
		expect(session.getWorkspace().info.kind).toBe("local");
		expect(session.getResearchSettings().workspaceDir).toBe(join(tempDir, "research", "workspace"));
		expect(session.systemPrompt).not.toContain("<workspace>");
	});
});
