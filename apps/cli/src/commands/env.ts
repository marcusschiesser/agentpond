import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import {
	type FilesSdkEnvironmentConfig,
	initAgentPondEnvironment,
	listAgentPondEnvironments,
	parseEnvFileEntries,
	readDevServerLock,
	resolveAgentPondEnvironment,
	selectAgentPondEnvironment,
} from "@agentpond/core";
import {
	type FilesSdkProvider,
	type FilesSdkProviderConfigField,
	getFilesSdkProvider,
	listFilesSdkProviders,
} from "@agentpond/files-sdk";
import { input, select } from "@inquirer/prompts";
import type { Command } from "commander";
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

const require = createRequire(import.meta.url);

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
	container?: string;
	endpoint?: string;
	langfuse?: boolean;
	namespace?: string;
	otel?: boolean;
	provider?: string;
	region?: string;
	root?: string;
	storeName?: string;
};

export function registerEnvCommand(
	program: Command,
	options: {
		selectEnvironment?: SelectEnvironmentPrompt;
		selectFilesProvider?: SelectFilesProviderPrompt;
		inputBucket?: InputPrompt;
		inputContainer?: InputPrompt;
		inputEndpoint?: InputPrompt;
		inputNamespace?: InputPrompt;
		inputRegion?: InputPrompt;
		inputRoot?: InputPrompt;
		inputStoreName?: InputPrompt;
	} = {},
): void {
	const promptSelect = options.selectEnvironment ?? select<string>;
	const promptFilesProvider = options.selectFilesProvider ?? select<string>;
	const promptBucket = options.inputBucket ?? input;
	const promptContainer = options.inputContainer ?? input;
	const promptEndpoint = options.inputEndpoint ?? input;
	const promptNamespace = options.inputNamespace ?? input;
	const promptRegion = options.inputRegion ?? input;
	const promptRoot = options.inputRoot ?? input;
	const promptStoreName = options.inputStoreName ?? input;
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
		.option("--provider <provider>", "Files SDK provider")
		.option("--bucket <bucket>", "Files SDK bucket name")
		.option("--container <container>", "Files SDK container name")
		.option("--endpoint <endpoint>", "Files SDK provider endpoint")
		.option("--namespace <namespace>", "Files SDK provider namespace")
		.option("--region <region>", "Files SDK provider region")
		.option("--root <root>", "Files SDK provider root")
		.option("--store-name <storeName>", "Files SDK store name")
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
				const resolvedEnvironment = resolveAgentPondEnvironment({
					cwd: context.rootDir,
					name,
				});
				if (existsSync(resolvedEnvironment.envFilePath)) {
					throw new CliError(
						`Environment "${resolvedEnvironment.name}" is already initialized at ${resolvedEnvironment.envFilePath}`,
					);
				}
				const filesSdk = await filesSdkConfigForOptions(
					commandOptions,
					promptFilesProvider,
					promptBucket,
					promptContainer,
					promptEndpoint,
					promptNamespace,
					promptRegion,
					promptRoot,
					promptStoreName,
				);
				const environment = initAgentPondEnvironment(name, {
					cwd: context.rootDir,
					filesSdk,
				});
				validateManualEnvironment(context.rootDir, environment.name);
				return print(
					{
						name: environment.name,
						envFile: environment.envFilePath,
						dbPath: environment.dbPath,
						provider: filesSdk.provider,
						...(filesSdk.bucket ? { bucket: filesSdk.bucket } : {}),
						...(filesSdk.container ? { container: filesSdk.container } : {}),
						...(filesSdk.endpoint ? { endpoint: filesSdk.endpoint } : {}),
						...(filesSdk.namespace ? { namespace: filesSdk.namespace } : {}),
						...(filesSdk.region ? { region: filesSdk.region } : {}),
						...(filesSdk.root ? { root: filesSdk.root } : {}),
						...(filesSdk.storeName ? { storeName: filesSdk.storeName } : {}),
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
	options: Pick<
		EnvOptions,
		| "bucket"
		| "container"
		| "endpoint"
		| "namespace"
		| "provider"
		| "region"
		| "root"
		| "storeName"
	>,
	promptProvider: SelectFilesProviderPrompt,
	promptBucket: InputPrompt,
	promptContainer: InputPrompt,
	promptEndpoint: InputPrompt,
	promptNamespace: InputPrompt,
	promptRegion: InputPrompt,
	promptRoot: InputPrompt,
	promptStoreName: InputPrompt,
): Promise<FilesSdkEnvironmentConfig> {
	const provider =
		options.provider ?? (await promptForFilesProvider(promptProvider));
	let definition: ReturnType<typeof getFilesSdkProvider>;
	try {
		definition = getFilesSdkProviderForCommand(provider);
	} catch (error) {
		throw new CliError(error instanceof Error ? error.message : String(error));
	}
	const prompts = {
		bucket: promptBucket,
		container: promptContainer,
		endpoint: promptEndpoint,
		namespace: promptNamespace,
		region: promptRegion,
		root: promptRoot,
		storeName: promptStoreName,
	};
	const configured = {
		bucket: options.bucket,
		container: options.container,
		endpoint: options.endpoint,
		namespace: options.namespace,
		region: options.region,
		root: options.root,
		storeName: options.storeName,
	};
	const values: Partial<
		Record<(typeof definition.configFields)[number], string>
	> = {};
	for (const field of [
		"bucket",
		"container",
		"endpoint",
		"namespace",
		"region",
		"root",
		"storeName",
	] as const satisfies readonly FilesSdkProviderConfigField[]) {
		const value = configured[field]?.trim();
		if (value) values[field] = value;
	}
	for (const field of definition.configFields) {
		if (!values[field]) {
			values[field] = await configuredProviderValue(
				field,
				configured[field],
				prompts[field],
			);
		}
	}
	return {
		provider,
		...values,
	};
}

async function promptForFilesProvider(
	promptSelect: SelectFilesProviderPrompt,
): Promise<string> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new CliError("Missing --provider");
	}
	return promptSelect({
		message: "Select Files SDK provider",
		choices: listFilesSdkProvidersForCommand().map(({ name, slug }) => ({
			name: `${name} (${slug})`,
			value: slug,
		})),
	});
}

function getFilesSdkProviderForCommand(provider: string): FilesSdkProvider {
	const definition = getFilesSdkProvider(provider);
	const missing = missingFilesSdkProviderPeerDependencies(definition);
	if (missing.length > 0) {
		throw new Error(
			`Files SDK provider "${provider}" is not available in this AgentPond CLI installation. Install agentpond and these packages in the project so npx uses the local CLI: ${missing.join(", ")}`,
		);
	}
	return definition;
}

function listFilesSdkProvidersForCommand(): FilesSdkProvider[] {
	return listFilesSdkProviders().filter(
		(definition) =>
			missingFilesSdkProviderPeerDependencies(definition).length === 0,
	);
}

function missingFilesSdkProviderPeerDependencies(
	definition: FilesSdkProvider,
): string[] {
	return definition.peerDeps.filter((dependency) => {
		try {
			require.resolve(dependency);
			return false;
		} catch {
			return true;
		}
	});
}

async function configuredProviderValue(
	field: FilesSdkProviderConfigField,
	value: string | undefined,
	promptInput: InputPrompt,
): Promise<string> {
	const configured = value?.trim();
	if (configured) return configured;
	const flag = providerConfigFlag(field);
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new CliError(`Missing ${flag}`);
	}
	const prompted = (
		await promptInput({
			message: `Files SDK ${providerConfigLabel(field)}`,
			...(field === "bucket" || field === "container" || field === "storeName"
				? { default: "agentpond" }
				: {}),
		})
	).trim();
	if (!prompted) throw new CliError(`Missing ${flag}`);
	return prompted;
}

function providerConfigFlag(field: FilesSdkProviderConfigField): string {
	switch (field) {
		case "storeName":
			return "--store-name";
		default:
			return `--${field}`;
	}
}

function providerConfigLabel(field: FilesSdkProviderConfigField): string {
	switch (field) {
		case "storeName":
			return "store name";
		default:
			return field;
	}
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
