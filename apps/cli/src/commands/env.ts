import { existsSync } from "node:fs";
import {
	type FilesSdkEnvironmentConfig,
	initAgentPondEnvironment,
	listAgentPondEnvironments,
	parseEnvFileEntries,
	readDevServerLock,
	resolveAgentPondEnvironment,
	selectAgentPondEnvironment,
} from "@agentpond/core";
import { input, select } from "@inquirer/prompts";
import type { Command } from "commander";
import { getProvider, PROVIDER_NAMES } from "files-sdk/providers";
import { CliError, print } from "../cli-support.js";
import { addGlobalOptions, type GlobalOptions } from "../command-support.js";
import {
	devSdkEnvironment,
	type EnvFamily,
	type EnvVar,
	filterEnvEntries,
} from "../dev-env.js";
import {
	environmentContextForCommand,
	manualEnvironmentContextForCommand,
	validateManualEnvironment,
} from "../environment-context.js";
import { providerForCommand } from "../providers.js";

export type SelectPrompt<T extends string> = (config: {
	message: string;
	choices: Array<{ name: string; value: T }>;
}) => Promise<T>;

export type SelectEnvironmentPrompt = SelectPrompt<string>;
export type SelectFilesProviderPrompt = SelectPrompt<string>;
export type InputPrompt = (config: {
	message: string;
	default?: string;
}) => Promise<string>;

type EnvOptions = GlobalOptions & {
	bucket?: string;
	endpoint?: string;
	langfuse?: boolean;
	otel?: boolean;
	provider?: string;
	region?: string;
};

export function registerEnvCommand(
	program: Command,
	options: {
		selectEnvironment?: SelectEnvironmentPrompt;
		selectFilesProvider?: SelectFilesProviderPrompt;
		inputBucket?: InputPrompt;
		inputEndpoint?: InputPrompt;
		inputRegion?: InputPrompt;
	} = {},
): void {
	const promptSelect = options.selectEnvironment ?? select<string>;
	const promptFilesProvider = options.selectFilesProvider ?? select<string>;
	const promptBucket = options.inputBucket ?? input;
	const promptEndpoint = options.inputEndpoint ?? input;
	const promptRegion = options.inputRegion ?? input;
	const env = addGlobalOptions(
		program.command("env").description("select and manage environments"),
	);

	addGlobalOptions(env.command("current"))
		.description("print the selected environment")
		.action((_commandOptions: EnvOptions, command: Command) => {
			const globalOptions = command.optsWithGlobals<GlobalOptions>();
			const environment = environmentContextForCommand({
				envName: globalOptions.env,
				platform: globalOptions.platform,
			}).config.environment;
			if (!environment) throw new CliError("Missing environment configuration");
			if (globalOptions.json) {
				return print(environment, true);
			}
			return print([environment], false);
		});

	addGlobalOptions(env.command("get <name>"))
		.description("print shell exports for a manual environment")
		.option("--langfuse", "print only Langfuse-compatible SDK exports")
		.option("--otel", "print only OpenTelemetry SDK exports")
		.action((name: string, commandOptions: EnvOptions, command: Command) => {
			const globalOptions = command.optsWithGlobals<GlobalOptions>();
			const context = manualEnvironmentContextForCommand("get", {
				envName: name,
				platform: globalOptions.platform,
			});
			printEnvironmentExports(name, commandOptions, context.rootDir);
		});

	addGlobalOptions(env.command("list"))
		.description("list manual environments")
		.action((_commandOptions: EnvOptions, command: Command) => {
			const globalOptions = command.optsWithGlobals<GlobalOptions>();
			const context = manualEnvironmentContextForCommand("list", {
				envName: globalOptions.env,
				platform: globalOptions.platform,
			});
			const cwd = context.rootDir;
			const selected = context.config.environment?.name ?? "dev";
			const names = listAgentPondEnvironments(cwd);
			const rows = (names.length > 0 ? names : [selected]).map((name) => ({
				name,
				selected: name === selected,
			}));
			for (const name of new Set([selected, ...rows.map(({ name }) => name)])) {
				validateManualEnvironment(cwd, name);
			}
			return print(rows, Boolean(globalOptions.json));
		});

	addGlobalOptions(env.command("init <name>"))
		.description("initialize a manual environment")
		.option("--provider <provider>", "Files SDK bucket provider")
		.option("--bucket <bucket>", "Files SDK bucket name")
		.option("--endpoint <endpoint>", "Files SDK provider endpoint")
		.option("--region <region>", "Files SDK provider region")
		.action(
			async (name: string, commandOptions: EnvOptions, command: Command) => {
				if (name === "dev") {
					throw new CliError(
						'The "dev" environment is managed by `npx agentpond dev`',
					);
				}
				const globalOptions = command.optsWithGlobals<GlobalOptions>();
				const context = manualEnvironmentContextForCommand("init", {
					envName: name,
					platform: globalOptions.platform,
				});
				const filesSdk = await filesSdkConfigForOptions(
					commandOptions,
					promptFilesProvider,
					promptBucket,
					promptEndpoint,
					promptRegion,
				);
				const environment = initAgentPondEnvironment(name, {
					cwd: context.rootDir,
					filesSdk,
				});
				validateManualEnvironment(context.rootDir, environment.name);
				return print(
					{
						bucket: filesSdk.bucket,
						name: environment.name,
						envFile: environment.envFilePath,
						dbPath: environment.dbPath,
						provider: filesSdk.provider,
						...(filesSdk.endpoint ? { endpoint: filesSdk.endpoint } : {}),
						...(filesSdk.region ? { region: filesSdk.region } : {}),
					},
					Boolean(globalOptions.json),
				);
			},
		);

	addGlobalOptions(env.command("use [name]"))
		.description("select an environment")
		.action(
			async (
				name: string | undefined,
				_commandOptions: EnvOptions,
				command: Command,
			) => {
				const globalOptions = command.optsWithGlobals<GlobalOptions>();
				const selected = await selectEnvironmentForCommand(
					name,
					promptSelect,
					globalOptions,
				);
				return print({ selected }, Boolean(globalOptions.json));
			},
		);
}

async function selectEnvironmentForCommand(
	name: string | undefined,
	promptSelect: SelectEnvironmentPrompt,
	options: GlobalOptions,
): Promise<string> {
	const providerContext = providerForCommand({ platform: options.platform });
	if (providerContext) {
		if (!name) throw new CliError("Missing environment name");
		try {
			return await providerContext.project.selectEnvironment(name);
		} catch (error) {
			throw new CliError(
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	const context = environmentContextForCommand({
		envName: name,
		platform: options.platform,
	});
	const selectedName =
		name ?? (await promptForEnvironmentName(promptSelect, context.rootDir));
	validateManualEnvironment(context.rootDir, selectedName);
	return selectAgentPondEnvironment(selectedName, {
		cwd: context.rootDir,
	}).name;
}

async function filesSdkConfigForOptions(
	options: Pick<EnvOptions, "bucket" | "endpoint" | "provider" | "region">,
	promptProvider: SelectFilesProviderPrompt,
	promptBucket: InputPrompt,
	promptEndpoint: InputPrompt,
	promptRegion: InputPrompt,
): Promise<FilesSdkEnvironmentConfig> {
	const provider =
		options.provider ?? (await promptForFilesProvider(promptProvider));
	const definition = bucketProvider(provider);
	const bucket = (
		options.bucket ?? (await promptForFilesBucket(promptBucket))
	).trim();
	if (!bucket) throw new CliError("Missing --bucket");

	const endpoint = await configuredProviderValue(
		"endpoint",
		definition.env.config?.includes("endpoint") ?? false,
		options.endpoint,
		promptEndpoint,
	);
	const region = await configuredProviderValue(
		"region",
		definition.env.config?.includes("region") ?? false,
		options.region,
		promptRegion,
	);
	return {
		provider,
		bucket,
		...(endpoint ? { endpoint } : {}),
		...(region ? { region } : {}),
	};
}

async function promptForFilesProvider(
	promptSelect: SelectFilesProviderPrompt,
): Promise<string> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new CliError("Missing --provider");
	}
	return promptSelect({
		message: "Select Files SDK bucket provider",
		choices: bucketProviders().map(({ name, slug }) => ({
			name: `${name} (${slug})`,
			value: slug,
		})),
	});
}

async function promptForFilesBucket(promptInput: InputPrompt): Promise<string> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new CliError("Missing --bucket");
	}
	return promptInput({
		message: "Files SDK bucket",
		default: "agentpond",
	});
}

function bucketProvider(provider: string) {
	const definition = getProvider(provider);
	if (!definition) {
		throw new CliError(
			`Unknown Files SDK provider "${provider}". Bucket providers: ${bucketProviders()
				.map(({ slug }) => slug)
				.join(", ")}`,
		);
	}
	if (!definition.env.config?.includes("bucket")) {
		throw new CliError(
			`Files SDK provider "${provider}" is not bucket-backed and is not supported by AgentPond`,
		);
	}
	if (provider === "bun-s3") {
		throw new CliError(
			'Files SDK provider "bun-s3" is not supported by AgentPond\'s Node.js runtime',
		);
	}
	for (const field of definition.env.config) {
		if (field !== "bucket" && field !== "endpoint" && field !== "region") {
			throw new CliError(
				`Files SDK provider "${provider}" requires unsupported configuration field "${field}"`,
			);
		}
	}
	return definition;
}

function bucketProviders() {
	return PROVIDER_NAMES.flatMap((provider) => {
		const definition = getProvider(provider);
		return provider !== "bun-s3" &&
			definition?.env.config?.includes("bucket") &&
			definition.env.config.every(
				(field) =>
					field === "bucket" || field === "endpoint" || field === "region",
			)
			? [definition]
			: [];
	});
}

async function configuredProviderValue(
	field: "endpoint" | "region",
	required: boolean,
	value: string | undefined,
	promptInput: InputPrompt,
): Promise<string | undefined> {
	const configured = value?.trim();
	if (configured) return configured;
	if (!required) return undefined;
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new CliError(`Missing --${field}`);
	}
	const prompted = (
		await promptInput({ message: `Files SDK ${field}` })
	).trim();
	if (!prompted) throw new CliError(`Missing --${field}`);
	return prompted;
}

async function promptForEnvironmentName(
	promptSelect: SelectEnvironmentPrompt,
	cwd: string,
): Promise<string> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new CliError("Missing environment name");
	}
	const current = resolveAgentPondEnvironment({ cwd });
	const names = listAgentPondEnvironments(cwd);
	const choices = (names.length > 0 ? names : [current.name]).map((name) => ({
		name,
		value: name,
	}));
	return promptSelect({
		message: "Select AgentPond environment",
		choices,
	});
}

function printEnvironmentExports(
	name: string,
	options: EnvOptions,
	cwd: string,
): void {
	const family = envFamilyFromOptions(options);
	const entries =
		name === "dev"
			? devSdkEnvironmentForCurrentServer(family, cwd)
			: filterEnvEntries(readEnvironmentFileExports(name, cwd), family);
	for (const entry of entries) {
		console.log(`export ${entry.key}=${shellValue(entry.value)}`);
	}
}

function devSdkEnvironmentForCurrentServer(
	family: EnvFamily,
	cwd: string,
): EnvVar[] {
	const environment = resolveAgentPondEnvironment({
		cwd,
		name: "dev",
	});
	const lock = readDevServerLock(environment);
	if (!lock?.host || !lock.port) {
		throw new CliError(
			"dev server is not running; start it with npx agentpond dev",
		);
	}
	return devSdkEnvironment(lock.host, lock.port, family);
}

function envFamilyFromOptions(options: EnvOptions): EnvFamily {
	if (options.langfuse && options.otel) {
		throw new CliError("--langfuse and --otel cannot be used together");
	}
	if (options.langfuse) return "langfuse";
	if (options.otel) return "otel";
	return "all";
}

function readEnvironmentFileExports(name: string, cwd: string): EnvVar[] {
	const environment = resolveAgentPondEnvironment({
		cwd,
		name,
	});
	if (!existsSync(environment.envFilePath)) {
		throw new CliError(
			`Environment "${environment.name}" is not initialized; run npx agentpond env init ${environment.name}`,
		);
	}
	return parseEnvFileEntries(environment.envFilePath);
}

function shellValue(value: string): string {
	if (/^[A-Za-z0-9_@%+=:,./-]*$/.test(value)) return value;
	return `'${value.replaceAll("'", "'\\''")}'`;
}
