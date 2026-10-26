import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import ssh2Module from "ssh2";
import { describe, expect, it } from "vitest";
import { buildSshArgs, quotePosix, sshErrorHint, validateSshTarget } from "../src/core/workspace/ssh/args.ts";
import { createPasswordSshTransport, parseHostKeyPin } from "../src/core/workspace/ssh/password.ts";
import { expandRemotePath, probeSshTarget } from "../src/core/workspace/ssh/probe.ts";
import type { SshRunResult, SshTransport } from "../src/core/workspace/ssh/transport.ts";
import {
	formatSshTarget,
	parseSshTarget,
	profileFromDraft,
	validateProfileName,
} from "../src/modes/interactive/ssh-config.ts";
import { RemoteResearchFs } from "../src/research/research-fs.ts";
import { FakeRemoteWorkspace } from "./helpers/fake-remote-workspace.ts";

function result(stdout: string, code = 0): SshRunResult {
	return {
		code,
		stdout: Buffer.from(stdout),
		stderr: Buffer.alloc(0),
		timedOut: false,
		aborted: false,
	};
}

class ProbeTransport implements SshTransport {
	async run(command: string): Promise<SshRunResult> {
		if (command.includes("SA_PROBE")) {
			return result(
				[
					"SA_PROBE",
					"system=Linux",
					"arch=x86_64",
					"home=/home/tester",
					"bash=/bin/bash",
					"sh=/bin/sh",
					"python=/usr/bin/python3",
					"rg=",
					"fd=",
					"git=/usr/bin/git",
					"nvidia=",
					"",
				].join("\n"),
			);
		}
		return result("exists=1\ndir=1\nwritable=1\n");
	}
	async dispose(): Promise<void> {}
}

describe("SSH arguments and targets", () => {
	it("builds non-interactive, non-forwarding ssh arguments", () => {
		const args = buildSshArgs({
			host: "gpu.example.com",
			user: "alice",
			port: 2222,
			identityFile: "C:/keys/id_ed25519",
		});
		expect(args).toContain("BatchMode=yes");
		expect(args).toContain("ClearAllForwardings=yes");
		expect(args).toContain("ForwardAgent=no");
		expect(args).toContain("ServerAliveInterval=15");
		expect(args).toContain("-l");
		expect(args).toContain("alice");
		expect(args).toContain("-p");
		expect(args).toContain("2222");
		expect(args).toContain("-i");
		expect(args).toContain("--");
		expect(args.at(-1)).toBe("gpu.example.com");
	});

	it("rejects option injection in host and user", () => {
		expect(() => validateSshTarget({ host: "-oProxyCommand=evil" })).toThrow(/Invalid SSH host/);
		expect(() => validateSshTarget({ host: "host", user: "bad user" })).toThrow(/Invalid SSH user/);
		expect(() => validateSshTarget({ host: "host", port: 70000 })).toThrow(/Invalid SSH port/);
	});

	it("quotes POSIX shell arguments", () => {
		expect(quotePosix("plain")).toBe("'plain'");
		expect(quotePosix("it's")).toBe("'it'\\''s'");
	});

	it("expands remote paths safely", () => {
		expect(expandRemotePath("~/data", "/home/tester")).toBe("/home/tester/data");
		expect(expandRemotePath("/data/../data/project", "/home/tester")).toBe("/data/project");
		expect(() => expandRemotePath("relative/path", "/home/tester")).toThrow(/absolute or start with ~/);
	});

	it("parses common /ssh target forms", () => {
		expect(parseSshTarget("alice@gpu:/data/project")).toEqual({
			host: "gpu",
			user: "alice",
			path: "/data/project",
		});
		expect(parseSshTarget("gpu:2222:/data/project")).toEqual({
			host: "gpu",
			port: 2222,
			path: "/data/project",
		});
		expect(parseSshTarget("lab-alias")).toEqual({ host: "lab-alias" });
		expect(parseSshTarget("alice@[::1]:/data")).toEqual({ host: "::1", user: "alice", path: "/data" });
	});

	it("formats and validates profiles", () => {
		const draft = parseSshTarget("alice@gpu:/data/project");
		const profile = profileFromDraft(draft);
		expect(profile).toEqual({ host: "gpu", user: "alice", path: "/data/project", auth: "key" });
		expect(formatSshTarget(draft)).toBe("alice@gpu:/data/project");
		expect(validateProfileName("gpu-lab")).toBe("gpu-lab");
		expect(() => validateProfileName("bad name")).toThrow(/Profile names/);
		expect(profileFromDraft({ host: "gpu", auth: "password" })).toEqual({
			host: "gpu",
			auth: "password",
		});
	});

	it("explains common SSH failures", () => {
		expect(sshErrorHint("Host key verification failed.")).toMatch(/Run `ssh/);
		expect(sshErrorHint("Permission denied (publickey).")).toMatch(/key authentication/);
		expect(sshErrorHint("Could not resolve hostname")).toMatch(/could not be resolved/);
	});
});

describe("remote probe", () => {
	it("reads platform, paths, and workspace state", async () => {
		const probe = await probeSshTarget(
			{ host: "gpu", user: "alice" },
			{ path: "/data/project", researchDir: "~/research", transport: new ProbeTransport() },
		);
		expect(probe.info.platform).toBe("linux");
		expect(probe.info.arch).toBe("x86_64");
		expect(probe.info.home).toBe("/home/tester");
		expect(probe.info.workspacePath).toBe("/data/project");
		expect(probe.info.researchDir).toBe("/home/tester/research");
		expect(probe.info.loginShell).toBe("bash");
		expect(probe.pathExists).toBe(true);
		expect(probe.pathWritable).toBe(true);
		expect(probe.tools.python).toBe("/usr/bin/python3");
	});

	it("rejects non-POSIX remote hosts", async () => {
		const transport: SshTransport = {
			async run(command: string) {
				if (command.includes("SA_PROBE")) {
					return result("SA_PROBE\nsystem=Windows_NT\narch=x86_64\nhome=C:\\\\Users\\\\x\nbash=\nsh=\n");
				}
				return result("");
			},
		};
		await expect(probeSshTarget({ host: "win" }, { transport })).rejects.toThrow(/only Linux and macOS/);
	});
});

describe("password authentication transport", () => {
	const ssh2 = ssh2Module as unknown as {
		Server: new (
			config: { hostKeys: string[] },
			listener: (client: any) => void,
		) => {
			listen(port: number, host: string, callback: () => void): void;
			address(): { port: number };
			close(callback?: () => void): void;
			on(event: string, listener: (...args: any[]) => void): void;
		};
		utils: {
			generateKeyPairSync(type: string): { private: string; public: string };
			parseKey(key: string): { getPublicSSH(): Buffer };
		};
	};
	const shell = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "/bin/sh";

	it("parses OpenSSH host-key fingerprints", () => {
		const stderr = [
			"debug1: kex: host key algorithm: ssh-ed25519",
			"debug1: Server host key: ssh-ed25519 SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU",
		].join("\n");
		expect(parseHostKeyPin(stderr)).toEqual({
			algorithm: "ssh-ed25519",
			fingerprint: "SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU",
		});
	});

	it.skipIf(!existsSync(shell))(
		"authenticates with a password and streams command output",
		async () => {
			const hostKey = ssh2.utils.generateKeyPairSync("ed25519");
			const otherKey = ssh2.utils.generateKeyPairSync("ed25519");
			const fingerprint = createHash("sha256")
				.update(ssh2.utils.parseKey(hostKey.private).getPublicSSH())
				.digest("base64")
				.replace(/=+$/, "");
			const server = new ssh2.Server({ hostKeys: [hostKey.private] }, (client: any) => {
				client.on("error", () => {});
				client.on("authentication", (ctx: any) => {
					if (ctx.method === "password" && ctx.username === "alice" && ctx.password === "secret") {
						ctx.accept();
					} else if (ctx.method === "none") {
						ctx.reject(["password"]);
					} else {
						ctx.reject();
					}
				});
				client.on("ready", () => {
					client.on("session", (accept: any) => {
						const session = accept();
						session.on("exec", (acceptExec: any, _reject: any, info: any) => {
							const stream = acceptExec();
							const child = spawn(shell, ["-c", info.command], { stdio: ["pipe", "pipe", "pipe"] });
							child.stdin.on("error", () => {});
							stream.on("data", (chunk: Buffer) => child.stdin.write(chunk));
							stream.on("end", () => child.stdin.end());
							child.stdout.on("data", (chunk: Buffer) => stream.write(chunk));
							child.stderr.on("data", (chunk: Buffer) => stream.stderr.write(chunk));
							child.on("close", (code) => {
								stream.exit(code ?? 1);
								stream.end();
							});
						});
					});
				});
			});
			server.on("error", () => {});
			await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
			const port = server.address().port;
			const target = {
				hostname: "127.0.0.1",
				user: "alice",
				port,
				algorithm: "ssh-ed25519",
				fingerprint,
			};
			const transport = createPasswordSshTransport(target, "secret");
			try {
				const exec = await transport.run("echo password-ok");
				expect(exec.code).toBe(0);
				expect(exec.stdout.toString()).toBe("password-ok\n");
				const stdin = await transport.run("cat", { stdin: "stdin-ok\n" });
				expect(stdin.code).toBe(0);
				expect(stdin.stdout.toString()).toBe("stdin-ok\n");
				const chunks: string[] = [];
				const streamed = await transport.run("printf 'a\\nb\\n'", {
					onStdout: (chunk) => chunks.push(chunk.toString()),
				});
				expect(streamed.code).toBe(0);
				expect(chunks.join("")).toBe("a\nb\n");

				const badPassword = createPasswordSshTransport(target, "wrong");
				const bad = await badPassword.run("echo nope");
				expect(bad.code).toBeNull();
				expect(bad.stderr.toString()).toMatch(/Password authentication failed/);
				await badPassword.dispose?.();

				const wrongPin = createPasswordSshTransport(
					{
						...target,
						fingerprint: createHash("sha256")
							.update(ssh2.utils.parseKey(otherKey.private).getPublicSSH())
							.digest("base64")
							.replace(/=+$/, ""),
					},
					"secret",
				);
				const wrongKey = await wrongPin.run("echo nope");
				expect(wrongKey.code).toBeNull();
				expect(wrongKey.stderr.toString()).toMatch(/Host key verification failed/);
				await wrongPin.dispose?.();
			} finally {
				await transport.dispose?.();
				await new Promise<void>((resolve) => server.close(() => resolve()));
			}
		},
		20_000,
	);
});

describe("remote research filesystem", () => {
	it("confines paths and supports file operations", async () => {
		const workspace = new FakeRemoteWorkspace();
		const fs = new RemoteResearchFs(workspace);
		await fs.ensureRoot();
		await fs.write("notes/note.md", "# hello\n");
		expect((await fs.read("notes/note.md")).content).toBe("# hello\n");
		expect((await fs.list(".", { recursive: true })).map((entry) => entry.path)).toContain("notes/note.md");
		await fs.copy("notes/note.md", "papers/copy.md");
		await fs.move("papers/copy.md", "papers/moved.md");
		expect(await workspace.readText("/work/research/papers/moved.md")).toBe("# hello\n");
		expect(() => fs.resolvePath("../outside.txt")).toThrow(/outside the research workspace/);
		expect(() => fs.resolvePath("/tmp/outside.txt")).toThrow(/outside the research workspace/);
		await expect(fs.remove(".")).rejects.toThrow(/Refusing/);
	});
});
