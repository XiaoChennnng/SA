import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setBuiltinChatModelOverrides } from "@sa/ai/providers/all";

// Downloaded model data lives next to the other SA config files.
export const MODEL_DATA_DIR_NAME = "model-data";

export function getModelDataCacheDir(agentDir: string): string {
	return join(agentDir, MODEL_DATA_DIR_NAME);
}

// Provider data files are flat names; reject anything that could escape the cache directory.
export function isSafeModelDataFileName(name: string): boolean {
	return name.endsWith(".json") && !name.includes("/") && !name.includes("\\") && !name.includes("..");
}

export interface CachedModelData {
	files: Record<string, unknown>;
	generatedAt?: string;
}

export function readCachedModelData(agentDir: string): CachedModelData | undefined {
	const dir = getModelDataCacheDir(agentDir);
	const manifestPath = join(dir, ".manifest.json");
	if (!existsSync(manifestPath)) return undefined;

	try {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
			generatedAt?: string;
			files?: Record<string, string>;
		};
		const files: Record<string, unknown> = {};
		for (const name of Object.keys(manifest.files ?? {})) {
			if (!isSafeModelDataFileName(name)) continue;
			const filePath = join(dir, name);
			if (!existsSync(filePath)) continue;
			files[name] = JSON.parse(readFileSync(filePath, "utf8"));
		}
		if (Object.keys(files).length === 0) return undefined;
		return { files, generatedAt: manifest.generatedAt };
	} catch {
		return undefined;
	}
}

// Applies a previously downloaded model catalog to the built-in providers for this process.
export function applyCachedModelData(agentDir: string): void {
	const cached = readCachedModelData(agentDir);
	if (cached) setBuiltinChatModelOverrides(cached.files);
}
