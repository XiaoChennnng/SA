import { createHash } from "node:crypto";
import { isAbsolute, join, posix, resolve as resolveNative } from "node:path";
import { expandTildePath } from "../config.ts";
import type { ResearchSettings } from "./types.ts";

export const RESEARCH_DEFAULTS = {
	maxResults: 10,
	requestTimeoutMs: 30_000,
} as const;

export interface ResearchSettingsInput {
	mailto?: string;
	semanticScholarApiKey?: string;
	ncbiApiKey?: string;
	coreApiKey?: string;
	anySearchApiKey?: string;
	wanfangAppKey?: string;
	cnkiCommand?: string;
	nstlCommand?: string;
	pdfCommand?: string;
	pythonPath?: string;
	latexCommand?: string;
	databasePath?: string;
	cacheDir?: string;
	workDir?: string;
	workspaceDir?: string;
	maxResults?: number;
	requestTimeoutMs?: number;
}

/** The active execution workspace, used to derive research storage paths. */
export interface ResearchPathContext {
	localCwd: string;
	workspaceKind?: "local" | "ssh";
	workspaceCwd?: string;
	workspaceDisplay?: string;
	remoteHome?: string;
}

function resolveLocalPath(value: string | undefined, fallback: string, baseDir: string): string {
	if (!value?.trim()) return fallback;
	const expanded = expandTildePath(value.trim());
	return isAbsolute(expanded) ? expanded : resolveNative(baseDir, expanded);
}

function resolveRemotePath(value: string | undefined, fallback: string, baseDir: string, home?: string): string {
	if (!value?.trim()) return fallback;
	const trimmed = value.trim();
	if (trimmed === "~") return home ?? "~";
	if (trimmed.startsWith("~/")) return posix.join(home ?? "~", trimmed.slice(2));
	return posix.isAbsolute(trimmed) ? posix.normalize(trimmed) : posix.resolve(baseDir, trimmed);
}

function remoteWorkspaceKey(context: ResearchPathContext, workspaceCwd: string): string {
	const identity = context.workspaceDisplay ?? workspaceCwd;
	return createHash("sha256").update(identity).digest("hex").slice(0, 16);
}

/** Fill defaults and resolve paths from the `research` settings block. */
export function resolveResearchSettings(
	input: ResearchSettingsInput = {},
	context?: ResearchPathContext,
): ResearchSettings {
	const localCwd = resolveNative(context?.localCwd ?? process.cwd());
	const workspaceKind = context?.workspaceKind ?? "local";
	const workspaceCwd = context?.workspaceCwd ?? localCwd;
	const localBase = workspaceKind === "ssh" ? localCwd : workspaceCwd;
	const localRoot =
		workspaceKind === "ssh"
			? join(localBase, "research", "remote", remoteWorkspaceKey(context ?? { localCwd }, workspaceCwd))
			: join(localBase, "research");
	const remoteRoot = posix.join(workspaceCwd, "research");
	const defaultWorkspaceDir =
		workspaceKind === "ssh" ? posix.join(remoteRoot, "workspace") : join(localRoot, "workspace");
	return {
		mailto: input.mailto?.trim() || undefined,
		semanticScholarApiKey: input.semanticScholarApiKey?.trim() || undefined,
		ncbiApiKey: input.ncbiApiKey?.trim() || undefined,
		coreApiKey: input.coreApiKey?.trim() || undefined,
		anySearchApiKey: input.anySearchApiKey?.trim() || undefined,
		wanfangAppKey: input.wanfangAppKey?.trim() || undefined,
		cnkiCommand: input.cnkiCommand?.trim() || undefined,
		nstlCommand: input.nstlCommand?.trim() || undefined,
		pdfCommand: input.pdfCommand?.trim() || undefined,
		pythonPath: input.pythonPath?.trim() || undefined,
		latexCommand: input.latexCommand?.trim() || undefined,
		databasePath: resolveLocalPath(input.databasePath, join(localRoot, "knowledge", "research.db"), localBase),
		cacheDir: resolveLocalPath(input.cacheDir, join(localRoot, "cache"), localBase),
		workDir: resolveLocalPath(input.workDir, join(localRoot, "work"), localBase),
		workspaceDir:
			workspaceKind === "ssh"
				? resolveRemotePath(input.workspaceDir, defaultWorkspaceDir, workspaceCwd, context?.remoteHome)
				: resolveLocalPath(input.workspaceDir, defaultWorkspaceDir, workspaceCwd),
		maxResults: Math.min(50, Math.max(1, Math.round(input.maxResults ?? RESEARCH_DEFAULTS.maxResults))),
		requestTimeoutMs: Math.max(1000, Math.round(input.requestTimeoutMs ?? RESEARCH_DEFAULTS.requestTimeoutMs)),
	};
}
