export {
	type AskUserAnswer,
	type AskUserToolDetails,
	type AskUserToolInput,
	askUserToolSystemPromptContribution,
	createAskUserTool,
	createAskUserToolDefinition,
} from "./ask-user.ts";
export {
	type BashOperations,
	type BashSpawnContext,
	type BashSpawnHook,
	type BashToolDetails,
	type BashToolInput,
	type BashToolOptions,
	createBashTool,
	createBashToolDefinition,
	createLocalBashOperations,
} from "./bash.ts";
export {
	createEditTool,
	createEditToolDefinition,
	type EditOperations,
	type EditToolDetails,
	type EditToolInput,
	type EditToolOptions,
} from "./edit.ts";
export { withFileMutationQueue } from "./file-mutation-queue.ts";
export {
	createFindTool,
	createFindToolDefinition,
	type FindOperations,
	type FindToolDetails,
	type FindToolInput,
	type FindToolOptions,
} from "./find.ts";
export {
	createGrepTool,
	createGrepToolDefinition,
	type GrepOperations,
	type GrepToolDetails,
	type GrepToolInput,
	type GrepToolOptions,
} from "./grep.ts";
export {
	createLsTool,
	createLsToolDefinition,
	type LsOperations,
	type LsToolDetails,
	type LsToolInput,
	type LsToolOptions,
} from "./ls.ts";
export {
	createLocalPowerShellOperations,
	createPowerShellTool,
	createPowerShellToolDefinition,
	type PowerShellOperations,
	type PowerShellSpawnContext,
	type PowerShellSpawnHook,
	type PowerShellToolDetails,
	type PowerShellToolInput,
	type PowerShellToolOptions,
} from "./powershell.ts";
export {
	createReadTool,
	createReadToolDefinition,
	type ReadOperations,
	type ReadToolDetails,
	type ReadToolInput,
	type ReadToolOptions,
} from "./read.ts";
export * from "./research/index.ts";
export {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	type TruncationOptions,
	type TruncationResult,
	truncateHead,
	truncateLine,
	truncateTail,
} from "./truncate.ts";
export {
	createWriteTool,
	createWriteToolDefinition,
	type WriteOperations,
	type WriteToolInput,
	type WriteToolOptions,
} from "./write.ts";

import type { AgentTool } from "@sa/agent-core";
import type { ToolDefinition } from "../extensions/types.ts";
import { createAskUserTool, createAskUserToolDefinition } from "./ask-user.ts";
import { type BashToolOptions, createBashTool, createBashToolDefinition } from "./bash.ts";
import { createEditTool, createEditToolDefinition, type EditToolOptions } from "./edit.ts";
import { createFindTool, createFindToolDefinition, type FindToolOptions } from "./find.ts";
import { createGrepTool, createGrepToolDefinition, type GrepToolOptions } from "./grep.ts";
import { createLsTool, createLsToolDefinition, type LsToolOptions } from "./ls.ts";
import { createPowerShellTool, createPowerShellToolDefinition, type PowerShellToolOptions } from "./powershell.ts";
import { createReadTool, createReadToolDefinition, type ReadToolOptions } from "./read.ts";
import {
	createCitationTool,
	createCitationToolDefinition,
	createExperimentLogTool,
	createExperimentLogToolDefinition,
	createLatexBuildTool,
	createLatexBuildToolDefinition,
	createPaperReadTool,
	createPaperReadToolDefinition,
	createPaperSearchTool,
	createPaperSearchToolDefinition,
	createPaperWriteTool,
	createPaperWriteToolDefinition,
	createPythonRunTool,
	createPythonRunToolDefinition,
	createResearchFilesTool,
	createResearchFilesToolDefinition,
	createResearchNoteTool,
	createResearchNoteToolDefinition,
	createWebExtractTool,
	createWebExtractToolDefinition,
	createWebSearchDomainsTool,
	createWebSearchDomainsToolDefinition,
	createWebSearchTool,
	createWebSearchToolDefinition,
	type ResearchToolOptions,
} from "./research/index.ts";
import { createWriteTool, createWriteToolDefinition, type WriteToolOptions } from "./write.ts";

export type Tool = AgentTool<any>;
export type ToolDef = ToolDefinition<any, any>;
export type ToolName =
	| "read"
	| "ask_user"
	| "bash"
	| "powershell"
	| "edit"
	| "write"
	| "grep"
	| "find"
	| "ls"
	| "paper_search"
	| "paper_read"
	| "research_note"
	| "experiment_log"
	| "citation"
	| "latex_build"
	| "python_run"
	| "web_search"
	| "web_extract"
	| "web_search_domains"
	| "paper_write"
	| "research_files";
export const allToolNames: Set<ToolName> = new Set([
	"read",
	"ask_user",
	"bash",
	"powershell",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
	"paper_search",
	"paper_read",
	"research_note",
	"experiment_log",
	"citation",
	"latex_build",
	"python_run",
	"web_search",
	"web_extract",
	"web_search_domains",
	"paper_write",
	"research_files",
]);

export interface ToolsOptions {
	read?: ReadToolOptions;
	bash?: BashToolOptions;
	powershell?: PowerShellToolOptions;
	write?: WriteToolOptions;
	edit?: EditToolOptions;
	grep?: GrepToolOptions;
	find?: FindToolOptions;
	ls?: LsToolOptions;
	/** Shared settings and knowledge base for the research tools. */
	research?: ResearchToolOptions;
}

export function createToolDefinition(toolName: ToolName, cwd: string, options?: ToolsOptions): ToolDef {
	switch (toolName) {
		case "read":
			return createReadToolDefinition(cwd, options?.read);
		case "ask_user":
			return createAskUserToolDefinition(cwd);
		case "bash":
			return createBashToolDefinition(cwd, options?.bash);
		case "powershell":
			return createPowerShellToolDefinition(cwd, options?.powershell);
		case "edit":
			return createEditToolDefinition(cwd, options?.edit);
		case "write":
			return createWriteToolDefinition(cwd, options?.write);
		case "grep":
			return createGrepToolDefinition(cwd, options?.grep);
		case "find":
			return createFindToolDefinition(cwd, options?.find);
		case "ls":
			return createLsToolDefinition(cwd, options?.ls);
		case "paper_search":
			return createPaperSearchToolDefinition(cwd, options?.research);
		case "paper_read":
			return createPaperReadToolDefinition(cwd, options?.research);
		case "research_note":
			return createResearchNoteToolDefinition(cwd, options?.research);
		case "experiment_log":
			return createExperimentLogToolDefinition(cwd, options?.research);
		case "citation":
			return createCitationToolDefinition(cwd, options?.research);
		case "latex_build":
			return createLatexBuildToolDefinition(cwd, options?.research);
		case "python_run":
			return createPythonRunToolDefinition(cwd, options?.research);
		case "web_search":
			return createWebSearchToolDefinition(cwd, options?.research);
		case "web_extract":
			return createWebExtractToolDefinition(cwd, options?.research);
		case "web_search_domains":
			return createWebSearchDomainsToolDefinition(cwd, options?.research);
		case "paper_write":
			return createPaperWriteToolDefinition(cwd, options?.research);
		case "research_files":
			return createResearchFilesToolDefinition(cwd, options?.research);
		default:
			throw new Error(`Unknown tool name: ${toolName}`);
	}
}

export function createTool(toolName: ToolName, cwd: string, options?: ToolsOptions): Tool {
	switch (toolName) {
		case "read":
			return createReadTool(cwd, options?.read);
		case "ask_user":
			return createAskUserTool(cwd);
		case "bash":
			return createBashTool(cwd, options?.bash);
		case "powershell":
			return createPowerShellTool(cwd, options?.powershell);
		case "edit":
			return createEditTool(cwd, options?.edit);
		case "write":
			return createWriteTool(cwd, options?.write);
		case "grep":
			return createGrepTool(cwd, options?.grep);
		case "find":
			return createFindTool(cwd, options?.find);
		case "ls":
			return createLsTool(cwd, options?.ls);
		case "paper_search":
			return createPaperSearchTool(cwd, options?.research);
		case "paper_read":
			return createPaperReadTool(cwd, options?.research);
		case "research_note":
			return createResearchNoteTool(cwd, options?.research);
		case "experiment_log":
			return createExperimentLogTool(cwd, options?.research);
		case "citation":
			return createCitationTool(cwd, options?.research);
		case "latex_build":
			return createLatexBuildTool(cwd, options?.research);
		case "python_run":
			return createPythonRunTool(cwd, options?.research);
		case "web_search":
			return createWebSearchTool(cwd, options?.research);
		case "web_extract":
			return createWebExtractTool(cwd, options?.research);
		case "web_search_domains":
			return createWebSearchDomainsTool(cwd, options?.research);
		case "paper_write":
			return createPaperWriteTool(cwd, options?.research);
		case "research_files":
			return createResearchFilesTool(cwd, options?.research);
		default:
			throw new Error(`Unknown tool name: ${toolName}`);
	}
}

export function createCodingToolDefinitions(cwd: string, options?: ToolsOptions): ToolDef[] {
	return [
		createReadToolDefinition(cwd, options?.read),
		createBashToolDefinition(cwd, options?.bash),
		createEditToolDefinition(cwd, options?.edit),
		createWriteToolDefinition(cwd, options?.write),
	];
}

export function createReadOnlyToolDefinitions(cwd: string, options?: ToolsOptions): ToolDef[] {
	return [
		createReadToolDefinition(cwd, options?.read),
		createGrepToolDefinition(cwd, options?.grep),
		createFindToolDefinition(cwd, options?.find),
		createLsToolDefinition(cwd, options?.ls),
	];
}

export function createAllToolDefinitions(cwd: string, options?: ToolsOptions): Record<ToolName, ToolDef> {
	return {
		read: createReadToolDefinition(cwd, options?.read),
		ask_user: createAskUserToolDefinition(cwd),
		bash: createBashToolDefinition(cwd, options?.bash),
		powershell: createPowerShellToolDefinition(cwd, options?.powershell),
		edit: createEditToolDefinition(cwd, options?.edit),
		write: createWriteToolDefinition(cwd, options?.write),
		grep: createGrepToolDefinition(cwd, options?.grep),
		find: createFindToolDefinition(cwd, options?.find),
		ls: createLsToolDefinition(cwd, options?.ls),
		paper_search: createPaperSearchToolDefinition(cwd, options?.research),
		paper_read: createPaperReadToolDefinition(cwd, options?.research),
		research_note: createResearchNoteToolDefinition(cwd, options?.research),
		experiment_log: createExperimentLogToolDefinition(cwd, options?.research),
		citation: createCitationToolDefinition(cwd, options?.research),
		latex_build: createLatexBuildToolDefinition(cwd, options?.research),
		python_run: createPythonRunToolDefinition(cwd, options?.research),
		web_search: createWebSearchToolDefinition(cwd, options?.research),
		web_extract: createWebExtractToolDefinition(cwd, options?.research),
		web_search_domains: createWebSearchDomainsToolDefinition(cwd, options?.research),
		paper_write: createPaperWriteToolDefinition(cwd, options?.research),
		research_files: createResearchFilesToolDefinition(cwd, options?.research),
	};
}

export function createCodingTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [
		createReadTool(cwd, options?.read),
		createBashTool(cwd, options?.bash),
		createEditTool(cwd, options?.edit),
		createWriteTool(cwd, options?.write),
	];
}

export function createReadOnlyTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [
		createReadTool(cwd, options?.read),
		createGrepTool(cwd, options?.grep),
		createFindTool(cwd, options?.find),
		createLsTool(cwd, options?.ls),
	];
}

export function createAllTools(cwd: string, options?: ToolsOptions): Record<ToolName, Tool> {
	return {
		read: createReadTool(cwd, options?.read),
		ask_user: createAskUserTool(cwd),
		bash: createBashTool(cwd, options?.bash),
		powershell: createPowerShellTool(cwd, options?.powershell),
		edit: createEditTool(cwd, options?.edit),
		write: createWriteTool(cwd, options?.write),
		grep: createGrepTool(cwd, options?.grep),
		find: createFindTool(cwd, options?.find),
		ls: createLsTool(cwd, options?.ls),
		paper_search: createPaperSearchTool(cwd, options?.research),
		paper_read: createPaperReadTool(cwd, options?.research),
		research_note: createResearchNoteTool(cwd, options?.research),
		experiment_log: createExperimentLogTool(cwd, options?.research),
		citation: createCitationTool(cwd, options?.research),
		latex_build: createLatexBuildTool(cwd, options?.research),
		python_run: createPythonRunTool(cwd, options?.research),
		web_search: createWebSearchTool(cwd, options?.research),
		web_extract: createWebExtractTool(cwd, options?.research),
		web_search_domains: createWebSearchDomainsTool(cwd, options?.research),
		paper_write: createPaperWriteTool(cwd, options?.research),
		research_files: createResearchFilesTool(cwd, options?.research),
	};
}
