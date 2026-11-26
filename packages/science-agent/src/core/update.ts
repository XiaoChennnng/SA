import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gt } from "semver";
import {
	getSelfUpdateCommand,
	getSelfUpdateUnavailableInstruction,
	PACKAGE_NAME,
	type SelfUpdateCommand,
	VERSION,
} from "../config.ts";
import { fetchWithRetry } from "../utils/management-http.ts";
import { getLatestVersion } from "../utils/tools-manager.ts";
import { isSafeModelDataFileName } from "./model-data-cache.ts";

// Releases are published from the fork's own repository.
export const SA_RELEASE_REPO = "XiaoChennnng/SA";

const MODEL_DATA_RAW_BASE = `https://raw.githubusercontent.com/${SA_RELEASE_REPO}/main/packages/ai/src/providers/data`;
const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;
const MODEL_DATA_TIMEOUT_MS = 30 * 1000;

export interface UpdateCheckResult {
	currentVersion: string;
	latestVersion: string;
	updateAvailable: boolean;
}

// Prerelease-aware comparison: 0.1.2-1031 is newer than 0.1.2-1030.
export function isUpdateAvailable(currentVersion: string, latestVersion: string): boolean {
	return gt(latestVersion, currentVersion);
}

// Resolves the newest published release tag. The request is only made when the user runs /update.
export async function checkForUpdate(): Promise<UpdateCheckResult> {
	const latestVersion = await getLatestVersion(SA_RELEASE_REPO);
	return {
		currentVersion: VERSION,
		latestVersion,
		updateAvailable: isUpdateAvailable(VERSION, latestVersion),
	};
}

export interface UpdatePlan {
	command?: SelfUpdateCommand;
	instruction?: string;
}

// Builds the package-manager command that installs the given release for this installation.
export function planSelfUpdate(latestVersion: string): UpdatePlan {
	const command = getSelfUpdateCommand(PACKAGE_NAME, undefined, {
		packageName: PACKAGE_NAME,
		installSpec: `${PACKAGE_NAME}@${latestVersion}`,
	});
	if (command) return { command };
	return { instruction: getSelfUpdateUnavailableInstruction(PACKAGE_NAME) };
}

function runStep(step: SelfUpdateCommand, onOutput?: (line: string) => void): Promise<void> {
	return new Promise((resolve, reject) => {
		// npm and friends are .cmd shims on Windows, so they need a shell there.
		const child = spawn(step.command, step.args, {
			stdio: ["ignore", "pipe", "pipe"],
			shell: process.platform === "win32",
			env: process.env,
		});
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error(`${step.display} timed out after ${UPDATE_TIMEOUT_MS / 60000} minutes`));
		}, UPDATE_TIMEOUT_MS);
		let stderr = "";
		const forward = (chunk: Buffer) => {
			for (const line of chunk.toString().split(/\r?\n/)) {
				if (line.trim()) onOutput?.(line);
			}
		};
		child.stdout.on("data", forward);
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
			forward(chunk);
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code === 0) {
				resolve();
				return;
			}
			const lastErrorLine = stderr.trim().split(/\r?\n/).pop();
			reject(new Error(`${step.display} exited with code ${code}${lastErrorLine ? `: ${lastErrorLine}` : ""}`));
		});
	});
}

// Runs the install steps in order, aborting on the first failure.
export async function runUpdateCommand(command: SelfUpdateCommand, onOutput?: (line: string) => void): Promise<void> {
	for (const step of command.steps ?? [command]) {
		await runStep(step, onOutput);
	}
}

export interface ModelDataRefreshResult {
	files: number;
	generatedAt?: string;
	dir: string;
}

async function downloadModelDataFile(url: string): Promise<Buffer> {
	const response = await fetchWithRetry(url, undefined, { timeoutMs: MODEL_DATA_TIMEOUT_MS });
	if (!response.ok) {
		throw new Error(`Download failed with HTTP ${response.status}: ${url}`);
	}
	return Buffer.from(await response.arrayBuffer());
}

// Downloads the model catalog committed on the fork's main branch into destDir.
// Every file is checksum-verified before anything is written, and the manifest is written last.
export async function refreshModelData(destDir: string): Promise<ModelDataRefreshResult> {
	const manifestBuffer = await downloadModelDataFile(`${MODEL_DATA_RAW_BASE}/.manifest.json`);
	let manifest: { generatedAt?: string; files?: Record<string, string> };
	try {
		manifest = JSON.parse(manifestBuffer.toString("utf8")) as {
			generatedAt?: string;
			files?: Record<string, string>;
		};
	} catch {
		throw new Error("Model data manifest is not valid JSON");
	}

	const names = Object.keys(manifest.files ?? {}).filter(isSafeModelDataFileName);
	if (names.length === 0) {
		throw new Error("Model data manifest lists no provider files");
	}

	const downloaded = new Map<string, Buffer>();
	for (const name of names) {
		const buffer = await downloadModelDataFile(`${MODEL_DATA_RAW_BASE}/${name}`);
		const expected = manifest.files?.[name];
		if (expected) {
			const actual = createHash("sha256").update(buffer).digest("hex");
			if (actual !== expected) {
				throw new Error(`Checksum mismatch for model data file ${name}`);
			}
		}
		try {
			JSON.parse(buffer.toString("utf8"));
		} catch {
			throw new Error(`Model data file ${name} is not valid JSON`);
		}
		downloaded.set(name, buffer);
	}

	mkdirSync(destDir, { recursive: true });
	for (const [name, buffer] of downloaded) {
		writeFileSync(join(destDir, name), buffer);
	}
	writeFileSync(join(destDir, ".manifest.json"), JSON.stringify(manifest));
	return { files: downloaded.size, generatedAt: manifest.generatedAt, dir: destDir };
}
