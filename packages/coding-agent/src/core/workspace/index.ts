export { createLocalWorkspace, LocalWorkspace } from "./local.ts";
export { sshDisplay, validateSshTarget } from "./ssh/args.ts";
export { createRemoteToolOperations, type RemoteToolOperations } from "./ssh/ops.ts";
export {
	createPasswordSshTransport,
	preflightHostKey,
	preparePasswordSsh,
	resolveSshConfig,
} from "./ssh/password.ts";
export { ensureRemoteDirectory, expandRemotePath, probeSshTarget, type SshProbe } from "./ssh/probe.ts";
export { SshWorkspace } from "./ssh/workspace.ts";
export type {
	RemoteWorkspaceInfo,
	RemoteWorkspaceTarget,
	ToolWorkspace,
	WorkspaceExecOptions,
	WorkspaceExecResult,
	WorkspaceGlobOptions,
	WorkspaceGrepMatch,
	WorkspaceGrepOptions,
	WorkspaceInfo,
	WorkspaceKind,
	WorkspaceRemoveOptions,
	WorkspaceStat,
} from "./types.ts";
