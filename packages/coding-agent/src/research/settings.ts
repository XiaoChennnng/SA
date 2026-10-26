import { join } from "node:path";
import { expandTildePath, getAgentDir } from "../config.ts";
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

function resolvePath(value: string | undefined, fallback: string): string {
	if (!value?.trim()) return fallback;
	return expandTildePath(value.trim());
}

/** Fill defaults and resolve paths from the `research` settings block. */
export function resolveResearchSettings(input: ResearchSettingsInput = {}): ResearchSettings {
	const researchRoot = join(getAgentDir(), "research");
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
		databasePath: resolvePath(input.databasePath, join(researchRoot, "research.db")),
		cacheDir: resolvePath(input.cacheDir, join(researchRoot, "cache")),
		workDir: resolvePath(input.workDir, join(researchRoot, "work")),
		workspaceDir: resolvePath(input.workspaceDir, join(researchRoot, "workspace")),
		maxResults: Math.min(50, Math.max(1, Math.round(input.maxResults ?? RESEARCH_DEFAULTS.maxResults))),
		requestTimeoutMs: Math.max(1000, Math.round(input.requestTimeoutMs ?? RESEARCH_DEFAULTS.requestTimeoutMs)),
	};
}
