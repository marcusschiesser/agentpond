import type {
	AgentPondProvider,
	AgentPondProviderProject,
} from "@agentpond/core";
import { firebaseProvider } from "@agentpond/firebase";
import { supabaseProvider } from "@agentpond/supabase";
import { vercelProvider } from "@agentpond/vercel";
import { CliError } from "./cli-support.js";

export const AVAILABLE_PLATFORMS = ["firebase", "supabase", "vercel"] as const;
export type InitPlatform = (typeof AVAILABLE_PLATFORMS)[number];

export type ProviderInitRequirements = {
	readonly configuration: readonly string[];
	readonly packages: readonly string[];
	readonly telemetry: readonly ("opentelemetry" | "openinference")[];
};

type ProviderRegistration = {
	readonly initRequirements: ProviderInitRequirements;
	readonly provider: AgentPondProvider;
};

const PROVIDER_REGISTRY = {
	firebase: {
		initRequirements: {
			configuration: [
				"firebase-project",
				"firebase-admin-app",
				"storage-rules",
			],
			packages: ["@agentpond/firebase"],
			telemetry: ["opentelemetry", "openinference"],
		},
		provider: firebaseProvider,
	},
	supabase: {
		initRequirements: {
			configuration: [
				"supabase-project",
				"private-agentpond-bucket",
				"server-secret-key",
			],
			packages: ["@agentpond/supabase"],
			telemetry: ["opentelemetry", "openinference"],
		},
		provider: supabaseProvider,
	},
	vercel: {
		initRequirements: {
			configuration: [
				"vercel-project",
				"private-blob-store",
				"system-environment",
			],
			packages: ["@agentpond/vercel"],
			telemetry: ["opentelemetry", "openinference"],
		},
		provider: vercelProvider,
	},
} as const satisfies Record<InitPlatform, ProviderRegistration>;

const AVAILABLE_PROVIDERS = AVAILABLE_PLATFORMS.map(
	(platform) => PROVIDER_REGISTRY[platform].provider,
);

export type ProviderProjectContext = {
	provider: AgentPondProvider;
	project: AgentPondProviderProject;
};

export function providerForPlatform(platform: InitPlatform): AgentPondProvider {
	return PROVIDER_REGISTRY[platform].provider;
}

export function providerInitRequirementsForPlatform(
	platform: InitPlatform,
): ProviderInitRequirements {
	return PROVIDER_REGISTRY[platform].initRequirements;
}

export function initPlatformFromValue(
	value: string | undefined,
): InitPlatform | undefined {
	if (value === undefined) return undefined;
	const platform = AVAILABLE_PLATFORMS.find((candidate) => candidate === value);
	if (platform) return platform;
	throw new CliError(
		`--platform must be ${AVAILABLE_PLATFORMS.join(" or ")}, got "${value}"`,
	);
}

export function providerForCommand(
	options: { allowUnlinked?: boolean; cwd?: string; platform?: string } = {},
): ProviderProjectContext | undefined {
	const platform = initPlatformFromValue(options.platform);
	if (platform) {
		const provider = providerForPlatform(platform);
		const project = provider.openProject({
			cwd: options.cwd,
			allowUnlinked: options.allowUnlinked,
		});
		if (!project) {
			throw new CliError(
				`No ${provider.displayName} project was detected. Run from a ${provider.displayName} project.`,
			);
		}
		return { provider, project };
	}

	const projects = AVAILABLE_PROVIDERS.flatMap((provider) => {
		const project = provider.openProject({ cwd: options.cwd });
		return project ? [{ provider, project }] : [];
	});
	if (projects.length > 1) {
		throw new CliError(
			`Multiple AgentPond platforms were detected: ${projects.map(({ provider }) => provider.displayName).join(", ")}. Pass --platform <platform> to select one for this command.`,
		);
	}
	return projects[0];
}
