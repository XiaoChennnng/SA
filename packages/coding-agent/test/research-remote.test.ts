import { describe, expect, it } from "vitest";
import type { ExtensionToolContext } from "../src/core/extensions/types.ts";
import { createLatexBuildToolDefinition } from "../src/core/tools/research/latex-build.ts";
import { createPaperWriteToolDefinition } from "../src/core/tools/research/paper-write.ts";
import { createPythonRunToolDefinition } from "../src/core/tools/research/python-run.ts";
import { createResearchFilesToolDefinition } from "../src/core/tools/research/research-files.ts";
import type { WorkspaceExecResult } from "../src/core/workspace/types.ts";
import { resolveResearchSettings } from "../src/research/settings.ts";
import { FakeRemoteWorkspace } from "./helpers/fake-remote-workspace.ts";

function execResult(stdout = "", exitCode = 0): WorkspaceExecResult {
	return { exitCode, stdout, stderr: "", timedOut: false, aborted: false };
}

function context(workspace: FakeRemoteWorkspace): ExtensionToolContext {
	return { workspace, cwd: "/work", mode: "tui" } as unknown as ExtensionToolContext;
}

describe("remote research tools", () => {
	it("runs python_run in the SSH workspace", async () => {
		const workspace = new FakeRemoteWorkspace();
		workspace.execHandler = async (command, args) => {
			if (command !== "python3" && command !== "python") throw new Error(`unexpected command ${command}`);
			if (args[0] === "--version") return execResult("Python 3.12.0\n");
			return execResult("remote python ok\n");
		};
		const tool = createPythonRunToolDefinition("/work", { settings: resolveResearchSettings({}) });
		const result = await tool.execute(
			"call",
			{ code: "print('x')", cwd: "." },
			undefined,
			undefined,
			context(workspace),
		);
		expect(result.content[0]?.type).toBe("text");
		expect((result.content[0] as { text: string }).text).toContain("remote python ok");
		expect(result.details?.exitCode).toBe(0);
		expect(result.details?.scriptPath).toMatch(/^\/work\/research\/workspace\/\.tmp\/sa-python-/);
		expect(
			[...workspace.files.keys()].some((path) => path.startsWith("/work/research/workspace/.tmp/sa-python-")),
		).toBe(true);
	});

	it("renders paper_write with remote Python and writes remote files", async () => {
		const workspace = new FakeRemoteWorkspace();
		workspace.execHandler = async (command, args) => {
			if (command !== "python3" && command !== "python") throw new Error(`unexpected command ${command}`);
			if (args[0] === "--version") return execResult("Python 3.12.0\n");
			const payloadPath = [...args].reverse().find((arg) => arg.endsWith(".json"));
			expect(payloadPath).toBeTruthy();
			const payload = JSON.parse(await workspace.readText(payloadPath!));
			await workspace.writeFile(payload.output, "%PDF-1.4 fake");
			return execResult(JSON.stringify({ ok: true, pages: 2, warnings: [] }));
		};
		const tool = createPaperWriteToolDefinition("/work", { settings: resolveResearchSettings({}) });
		const result = await tool.execute(
			"call",
			{ title: "Remote Paper", content: "# Intro\n\nHello.", authors: ["A. Author"] },
			undefined,
			undefined,
			context(workspace),
		);
		expect(result.details.pdfPath).toBe("/work/research/workspace/manuscripts/Remote-Paper/paper.pdf");
		expect(result.details.sourcePath).toBe("/work/research/workspace/manuscripts/Remote-Paper/paper.md");
		expect(result.details.pages).toBe(2);
		expect(await workspace.exists(result.details.pdfPath)).toBe(true);
		expect(await workspace.exists(result.details.sourcePath)).toBe(true);
	});

	it("compiles LaTeX through the remote login shell", async () => {
		const workspace = new FakeRemoteWorkspace();
		await workspace.writeFile("/work/paper.tex", "\\documentclass{article}\\begin{document}x\\end{document}");
		workspace.execHandler = async (command, args) => {
			if (command !== "latexmk") throw new Error(`unexpected command ${command}`);
			if (args[0] === "--version") return execResult("latexmk 4.80\n");
			await workspace.writeFile("/work/paper.pdf", "%PDF-1.4 fake");
			return execResult("Latexmk: all targets are up-to-date");
		};
		const tool = createLatexBuildToolDefinition("/work", { settings: resolveResearchSettings({}) });
		const result = await tool.execute("call", { path: "paper.tex" }, undefined, undefined, context(workspace));
		expect(result.details.success).toBe(true);
		expect(result.details.engine).toBe("latexmk");
		expect(result.details.pdfPath).toBe("/work/paper.pdf");
	});

	it("manages research files in the remote research directory", async () => {
		const workspace = new FakeRemoteWorkspace();
		const tool = createResearchFilesToolDefinition("/work", { settings: resolveResearchSettings({}) });
		await tool.execute(
			"call",
			{ action: "write", path: "papers/remote.md", content: "# Remote\n" },
			undefined,
			undefined,
			context(workspace),
		);
		const list = await tool.execute(
			"call",
			{ action: "list", recursive: true },
			undefined,
			undefined,
			context(workspace),
		);
		expect((list.content[0] as { text: string }).text).toContain("papers/remote.md");
		expect(await workspace.readText("/work/research/workspace/papers/remote.md")).toBe("# Remote\n");
	});
});
