import { spawnSync } from "node:child_process";
import { chownSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const variant = process.env.SA_EVAL_VARIANT;

function parseId(name: string): number {
	const value = Number(process.env[name]);
	if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
	return value;
}

const sandboxUid = parseId("SA_EVAL_SANDBOX_UID");
const sandboxGid = parseId("SA_EVAL_SANDBOX_GID");

function assertDirectoryEntries(path: string, expectedEntries: readonly string[]): void {
	const actual = readdirSync(path).sort();
	const expected = [...expectedEntries].sort();
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`Unexpected eval image contents in ${path}: ${actual.join(", ")}`);
	}
}

function assertWorkspace(): void {
	assertDirectoryEntries("/repo", ["node_modules", "package.json", "packages", "vitest.base.ts"]);
	assertDirectoryEntries("/repo/packages", ["evals"]);
	assertDirectoryEntries("/repo/packages/evals", ["docker", "evals", "package.json", "src", "vitest.evals.config.ts"]);
	const scienceAgentDir = "/repo/node_modules/@sa/science-agent";
	for (const name of ["package.json", "dist/index.js"]) {
		if (!existsSync(join(scienceAgentDir, name))) throw new Error(`Installed science-agent is missing ${name}.`);
	}
	const internalScope = "/repo/node_modules/@sa";
	for (const packageName of readdirSync(internalScope)) {
		if (packageName === "science-agent") continue;
		const packageDirectory = join(internalScope, packageName);
		for (const entry of readdirSync(packageDirectory, { withFileTypes: true })) {
			if (
				(entry.isDirectory() && ["docs", "examples", "src", "test", "tests"].includes(entry.name)) ||
				(entry.isFile() && /^(?:readme|changelog)(?:\..+)?$/i.test(entry.name))
			) {
				throw new Error(`Internal dependency documentation is model-visible: ${packageName}/${entry.name}`);
			}
		}
	}
	if (variant === "without_docs") {
		for (const name of ["README.md", "CHANGELOG.md", "docs", "examples"]) {
			if (existsSync(join(scienceAgentDir, name))) throw new Error(`without_docs contains science-agent ${name}.`);
		}
		return;
	}
	if (variant !== "with_docs") throw new Error("Eval image has no valid SA_EVAL_VARIANT.");
	for (const path of [
		join(scienceAgentDir, "README.md"),
		join(scienceAgentDir, "CHANGELOG.md"),
		join(scienceAgentDir, "docs/models.md"),
		join(scienceAgentDir, "examples/README.md"),
	]) {
		if (!existsSync(path) || readFileSync(path).length === 0) throw new Error(`Missing documentation: ${path}`);
	}
}

function chownTree(path: string, uid: number, gid: number): void {
	const stats = lstatSync(path);
	if (stats.isDirectory() && !stats.isSymbolicLink()) {
		for (const entry of readdirSync(path)) chownTree(join(path, entry), uid, gid);
	}
	chownSync(path, uid, gid);
}

function assertRootOnly(path: string): void {
	const stats = statSync(path);
	if (stats.uid !== 0 || (stats.mode & 0o077) !== 0) {
		throw new Error(`Evaluator source must be readable only by root: ${path}`);
	}
}

function assertSandboxCannotRead(path: string): void {
	const method = statSync(path).isDirectory() ? "readdirSync" : "readFileSync";
	const probe = spawnSync(process.execPath, ["--eval", `require("node:fs").${method}(${JSON.stringify(path)})`], {
		uid: sandboxUid,
		gid: sandboxGid,
		stdio: "ignore",
	});
	if (probe.status === 0) throw new Error(`The model-facing user can read evaluator source: ${path}`);
}

assertWorkspace();
const evalRoot = "/repo/packages/evals/evals";
for (const path of [
	evalRoot,
	"/repo/packages/evals/src",
	"/repo/packages/evals/docker",
	"/repo/packages/evals/vitest.evals.config.ts",
	"/repo/vitest.base.ts",
]) {
	assertRootOnly(path);
	assertSandboxCannotRead(path);
}
const scienceAgentEntry = fileURLToPath(import.meta.resolve("@sa/science-agent"));
if (scienceAgentEntry !== "/repo/node_modules/@sa/science-agent/dist/index.js") {
	throw new Error(`Eval does not resolve sa-science-agent from dist: ${scienceAgentEntry}`);
}

const agentDir = "/tmp/sa-eval-host-agent";
mkdirSync(agentDir, { recursive: true });
const authSource = "/run/sa-eval-secrets/auth.json";
if (existsSync(authSource)) copyFileSync(authSource, join(agentDir, "auth.json"));
chownTree(agentDir, sandboxUid, sandboxGid);
chownTree("/artifacts", sandboxUid, sandboxGid);
process.env.HOME = "/tmp/sa-eval-bootstrap";
process.env.USERPROFILE = process.env.HOME;
process.env.SA_CODING_AGENT_DIR = agentDir;
process.env.SA_EVAL_CONTAINER = "1";
process.umask(0o022);

const require = createRequire(import.meta.url);
const vitestCli = resolve(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
const inputArgs = process.argv.slice(2);
const discover = inputArgs.includes("--discover");
const vitestArgs = inputArgs.filter((argument) => argument !== "--discover");
const evalFiles = vitestArgs.filter((argument) => argument.endsWith(".eval.ts"));
if (evalFiles.length === 0) throw new Error("The container runner requires an explicit eval file.");

for (const evalFile of evalFiles) {
	assertRootOnly(evalFile);
	assertSandboxCannotRead(evalFile);
}

const commandArgs = discover
	? [vitestCli, "list", "--config", "vitest.evals.config.ts", ...vitestArgs, "--json=/artifacts/discovered-tests.json"]
	: [
			vitestCli,
			"run",
			"--config",
			"vitest.evals.config.ts",
			...vitestArgs,
			"--reporter=vitest-evals/reporter",
			"--reporter=json",
			"--outputFile=/artifacts/vitest.json",
		];
const result = spawnSync(process.execPath, commandArgs, { cwd: packageRoot, stdio: "inherit", env: process.env });
if (result.error) throw result.error;

const artifactUid = process.env.SA_EVAL_ARTIFACT_UID;
const artifactGid = process.env.SA_EVAL_ARTIFACT_GID;
if (artifactUid !== undefined && artifactGid !== undefined) {
	chownTree("/artifacts", parseId("SA_EVAL_ARTIFACT_UID"), parseId("SA_EVAL_ARTIFACT_GID"));
}
process.exit(result.status ?? 1);
