declare module "ssh2" {
	import type { EventEmitter } from "node:events";
	import type { Writable } from "node:stream";

	export interface ClientChannel extends EventEmitter {
		readonly stderr: EventEmitter;
		readonly stdin: Writable;
		close(): void;
		end(): void;
		on(event: "data", listener: (chunk: Buffer) => void): this;
		on(
			event: "exit",
			listener: (code: number | null, signal: string | null, coreDumped: boolean, description: string) => void,
		): this;
		on(event: "close", listener: () => void): this;
		on(event: "error", listener: (error: Error) => void): this;
	}

	export interface Algorithms {
		serverHostKey?: string[];
	}

	export interface ConnectConfig {
		host: string;
		port?: number;
		username: string;
		password?: string;
		tryKeyboard?: boolean;
		readyTimeout?: number;
		keepaliveInterval?: number;
		keepaliveCountMax?: number;
		algorithms?: Algorithms;
		hostVerifier?: (key: Buffer, callback: (permitted: boolean) => void) => void;
	}

	export class Client extends EventEmitter {
		connect(config: ConnectConfig): this;
		exec(command: string, callback: (error: Error | undefined, channel: ClientChannel) => void): this;
		end(): this;
	}

	const ssh2: { Client: typeof Client };
	export default ssh2;
}
