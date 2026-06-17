import type { AuthConfig } from "./config.js";

export type AuthScope = {
	projectId: string;
	publicKey: string;
};

export function verifyBasicAuth(
	authorization: string | undefined,
	auth: AuthConfig,
): AuthScope {
	if (!authorization?.startsWith("Basic ")) {
		throw new AuthError("Missing Basic auth header");
	}

	const decoded = Buffer.from(
		authorization.slice("Basic ".length),
		"base64",
	).toString("utf8");
	const separator = decoded.indexOf(":");
	const publicKey = separator >= 0 ? decoded.slice(0, separator) : decoded;
	const secretKey = separator >= 0 ? decoded.slice(separator + 1) : "";

	if (publicKey !== auth.publicKey || secretKey !== auth.secretKey) {
		throw new AuthError("Invalid public or secret key");
	}

	return { projectId: auth.projectId, publicKey };
}

export class AuthError extends Error {
	readonly status = 401;

	constructor(message: string) {
		super(message);
		this.name = "UnauthorizedError";
	}
}
