import type { ClientIdentity } from "@sa/ai";
import { VERSION } from "../config.ts";

/**
 * How SA's requests identify it to providers: a detailed `User-Agent` with SA's version. Attribution headers are
 * never sent because this build has no upstream service.
 */
export function getClientIdentity(): ClientIdentity {
	return {
		userAgent: "detailed",
		version: VERSION,
		attribution: null,
	};
}
