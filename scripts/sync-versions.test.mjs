import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const syncVersionsScript = fileURLToPath(new URL("./sync-versions.js", import.meta.url));

async function writeManifest(root, relativeDirectory, manifest) {
	const directory = join(root, relativeDirectory);
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, "package.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
}

async function readManifest(root, relativeDirectory) {
	return JSON.parse(await readFile(join(root, relativeDirectory, "package.json"), "utf8"));
}

function runSyncVersions(root) {
	return spawnSync(process.execPath, [syncVersionsScript, join(root, "packages")], {
		cwd: root,
		encoding: "utf8",
	});
}

// #10865: caret ranges allowed older agents to install incompatible newer workspace dependencies.
test("pins published and private dependencies without touching registry aliases, generated manifests, or published lockstep", async () => {
	const root = await mkdtemp(join(tmpdir(), "sa-sync-versions-"));
	try {
		await writeManifest(root, "packages/ai", {
			name: "@sa/ai",
			version: "2.0.0",
		});
		await writeManifest(root, "packages/coding-agent", {
			name: "@sa/coding-agent",
			version: "2.0.0",
			dependencies: {
				"@sa/ai": "^2.0.0",
			},
			devDependencies: {
				"@sa/ai": "~1.0.0",
			},
			optionalDependencies: {
				"@sa/ai": "1.0.0",
			},
		});
		await writeManifest(root, "packages/evals", {
			name: "@sa/evals",
			version: "9.9.9",
			private: true,
			dependencies: {
				"@sa/coding-agent": "^1.0.0",
				"@mariozechner/sa-ai": "npm:@sa/ai@1.0.0",
			},
		});
		await writeManifest(root, "packages/coding-agent/install-lock", {
			name: "generated-install-lock",
			version: "0.0.0",
			private: true,
			dependencies: {
				"@sa/coding-agent": "^1.0.0",
			},
		});

		const result = runSyncVersions(root);
		assert.equal(result.status, 0, result.stderr);

		const agentManifest = await readManifest(root, "packages/coding-agent");
		for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
			assert.equal(agentManifest[section]["@sa/ai"], "2.0.0");
		}
		const evalsManifest = await readManifest(root, "packages/evals");
		assert.equal(evalsManifest.dependencies["@sa/coding-agent"], "2.0.0");
		assert.equal(evalsManifest.dependencies["@mariozechner/sa-ai"], "npm:@sa/ai@1.0.0");
		const generatedManifest = await readManifest(root, "packages/coding-agent/install-lock");
		assert.equal(generatedManifest.dependencies["@sa/coding-agent"], "^1.0.0");

		const alreadySynced = runSyncVersions(root);
		assert.equal(alreadySynced.status, 0, alreadySynced.stderr);
		assert.match(alreadySynced.stdout, /All inter-package dependencies are already in sync/);

		await writeManifest(root, "packages/ai", {
			name: "@sa/ai",
			version: "3.0.0",
		});
		const lockstepFailure = runSyncVersions(root);
		assert.equal(lockstepFailure.status, 1, lockstepFailure.stderr);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("writes the sa-ai version constant", async () => {
	const root = await mkdtemp(join(tmpdir(), "sa-sync-versions-"));
	try {
		await writeManifest(root, "packages/ai", {
			name: "@sa/ai",
			version: "2.0.0",
		});
		const versionPath = join(root, "packages/ai/src/utils/version.ts");
		await mkdir(join(root, "packages/ai/src/utils"), { recursive: true });
		await writeFile(versionPath, 'export const SA_AI_VERSION = "1.0.0";\n');

		const result = runSyncVersions(root);
		assert.equal(result.status, 0, result.stderr);
		assert.match(await readFile(versionPath, "utf8"), /export const SA_AI_VERSION = "2\.0\.0";\n$/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
