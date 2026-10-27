import type { RemoteWorkspaceTarget } from "../types.ts";

function invalidField(value: string): boolean {
	return value === "" || value.startsWith("-") || /[\s\x00-\x1f\x7f]/.test(value);
}

export function validateSshTarget(target: RemoteWorkspaceTarget): void {
	if (invalidField(target.host)) throw new Error(`Invalid SSH host: ${JSON.stringify(target.host)}`);
	if (target.user !== undefined && invalidField(target.user)) {
		throw new Error(`Invalid SSH user: ${JSON.stringify(target.user)}`);
	}
	if (target.port !== undefined && (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535)) {
		throw new Error(`Invalid SSH port: ${target.port}`);
	}
	if (target.identityFile?.includes("\0")) {
		throw new Error("Invalid SSH identity file path");
	}
}

export function buildSshArgs(target: RemoteWorkspaceTarget): string[] {
	validateSshTarget(target);
	const args = [
		"-T",
		"-a",
		"-x",
		"-o",
		"BatchMode=yes",
		"-o",
		"ClearAllForwardings=yes",
		"-o",
		"ForwardAgent=no",
		"-o",
		"ForwardX11=no",
		"-o",
		"PermitLocalCommand=no",
		"-o",
		"SendEnv=-*",
		"-o",
		"ConnectTimeout=15",
		"-o",
		"ServerAliveInterval=15",
		"-o",
		"ServerAliveCountMax=3",
	];
	if (target.user !== undefined) args.push("-l", target.user);
	if (target.port !== undefined) args.push("-p", String(target.port));
	if (target.identityFile !== undefined) {
		args.push("-i", target.identityFile, "-o", "IdentitiesOnly=yes");
	}
	args.push("--", target.host);
	return args;
}

export function quotePosix(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

export function sshDisplay(target: RemoteWorkspaceTarget, remotePath?: string): string {
	const host = target.user ? `${target.user}@${target.host}` : target.host;
	const port = target.port ? `:${target.port}` : "";
	return remotePath ? `${host}${port}:${remotePath}` : `${host}${port}`;
}

export function sshErrorHint(stderr: string): string {
	if (/REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(stderr)) {
		return "The remote host key changed. Verify the server, then remove the old key with `ssh-keygen -R <host>`.";
	}
	if (/Host key verification failed|No .* host key is known/i.test(stderr)) {
		return "The host key is not trusted yet. Run `ssh <host>` once in a terminal and accept the key, then retry /ssh.";
	}
	if (/Permission denied|publickey/i.test(stderr)) {
		return "SSH key authentication failed. Check your key/ssh-agent, or set an identity file in the /ssh profile.";
	}
	if (/Could not resolve hostname/i.test(stderr)) {
		return "The host name could not be resolved. Check the host or your SSH config.";
	}
	if (/Connection refused|timed out|No route to host/i.test(stderr)) {
		return "The SSH server is unreachable. Check the address, port, network, and any jump host settings.";
	}
	return "Check that OpenSSH is installed and that `ssh <host>` works in a terminal.";
}
