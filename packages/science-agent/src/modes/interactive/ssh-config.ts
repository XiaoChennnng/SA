import type { SshProfile } from "../../core/settings-schema.ts";
import type { WorkspaceInfo } from "../../core/workspace/types.ts";

export const SSH_PROFILE_NAME = /^[A-Za-z0-9._-]{1,64}$/;

export interface SshDraft {
	host: string;
	user?: string;
	port?: number;
	identityFile?: string;
	path?: string;
	researchDir?: string;
	/** Defaults to key/agent authentication. */
	auth?: "key" | "password";
}

function validateText(name: string, value: string): string {
	const trimmed = value.trim();
	if (!trimmed) throw new Error(`${name} is required`);
	if (trimmed.startsWith("-") || /[\s\x00-\x1f\x7f]/.test(trimmed)) {
		throw new Error(`${name} contains invalid characters`);
	}
	return trimmed;
}

function splitUserHost(value: string): { host: string; user?: string } {
	const trimmed = value.trim();
	const at = trimmed.lastIndexOf("@");
	if (at <= 0) return { host: validateText("host", trimmed) };
	return {
		user: validateText("user", trimmed.slice(0, at)),
		host: validateText("host", trimmed.slice(at + 1)),
	};
}

function validatePath(value: string | undefined, name: string): string | undefined {
	if (!value?.trim()) return undefined;
	const trimmed = value.trim();
	if (!trimmed.startsWith("/") && trimmed !== "~" && !trimmed.startsWith("~/")) {
		throw new Error(`${name} must be an absolute path or start with ~/`);
	}
	if (/[\x00\r\n]/.test(trimmed)) throw new Error(`${name} contains invalid control characters`);
	return trimmed;
}

export function parseSshTarget(input: string): SshDraft {
	const text = input.trim();
	if (!text) throw new Error("Usage: /ssh user@host:/remote/path");
	if (/\s/.test(text)) throw new Error("SSH target cannot contain whitespace");
	const bracketed = /^(.+\[[^\]]+\]):(.+)$/.exec(text);
	if (bracketed) {
		const { host, user } = splitUserHost(bracketed[1]!);
		const normalizedHost = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
		return { host: normalizedHost, user, path: validatePath(bracketed[2], "remote path") };
	}
	const withPort = /^([^:]+):(\d{1,5}):(.+)$/.exec(text);
	if (withPort && /^([/~])/.test(withPort[3]!)) {
		const { host, user } = splitUserHost(withPort[1]!);
		const port = Number.parseInt(withPort[2]!, 10);
		if (port < 1 || port > 65535) throw new Error("SSH port must be between 1 and 65535");
		return { host, user, port, path: validatePath(withPort[3], "remote path") };
	}
	const index = text.indexOf(":");
	if (index === -1) {
		const { host, user } = splitUserHost(text);
		return { host, user };
	}
	const { host, user } = splitUserHost(text.slice(0, index));
	return {
		host,
		user,
		path: validatePath(text.slice(index + 1), "remote path"),
	};
}

export function draftFromProfile(profile: SshProfile): SshDraft {
	return {
		host: profile.host,
		user: profile.user,
		port: profile.port,
		identityFile: profile.identityFile,
		path: profile.path,
		researchDir: profile.researchDir,
		auth: profile.auth ?? "key",
	};
}

export function profileFromDraft(draft: SshDraft): SshProfile {
	return {
		host: draft.host,
		...(draft.user ? { user: draft.user } : {}),
		...(draft.port ? { port: draft.port } : {}),
		...(draft.identityFile ? { identityFile: draft.identityFile } : {}),
		...(draft.path ? { path: draft.path } : {}),
		...(draft.researchDir ? { researchDir: draft.researchDir } : {}),
		auth: draft.auth ?? "key",
	};
}

export function validateProfileName(name: string): string {
	const trimmed = name.trim();
	if (!SSH_PROFILE_NAME.test(trimmed)) {
		throw new Error("Profile names use 1-64 letters, digits, dots, underscores, or dashes");
	}
	return trimmed;
}

export function formatSshTarget(draft: SshDraft): string {
	const host = draft.user ? `${draft.user}@${draft.host}` : draft.host;
	const port = draft.port ? `:${draft.port}` : "";
	const path = draft.path ? `:${draft.path}` : "";
	return `${host}${port}${path}`;
}

export function formatSshStatus(workspace: WorkspaceInfo): string {
	if (workspace.kind !== "ssh" || !workspace.remote) return `Local workspace: ${workspace.display}`;
	const remote = workspace.remote;
	const target = formatSshTarget({
		host: remote.host,
		user: remote.user,
		port: remote.port,
		path: remote.workspacePath,
	});
	return [
		`Active SSH workspace: ${target}`,
		`Home: ${remote.home}`,
		`Research files: ${remote.researchDir}`,
		`Platform: ${remote.platform}/${remote.arch}; login shell: ${remote.loginShell}`,
		`Authentication: ${remote.auth === "password" ? "password (session memory)" : `key/agent (${remote.identityFile ?? "ssh config"})`}`,
	].join("\n");
}

export function formatSshProfiles(profiles: Record<string, SshProfile>, lastProfile?: string): string {
	const names = Object.keys(profiles).sort();
	if (names.length === 0) return "No saved SSH profiles. Use /ssh to connect, then save a profile.";
	const lines = ["Saved SSH profiles:"];
	for (const name of names) {
		const marker = name === lastProfile ? " (last used)" : "";
		const auth = profiles[name]!.auth === "password" ? " [password]" : "";
		lines.push(`- ${name}${marker}${auth}: ${formatSshTarget(draftFromProfile(profiles[name]!))}`);
	}
	return lines.join("\n");
}
