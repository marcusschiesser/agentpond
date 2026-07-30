export type AgentPondShutdownTarget = {
	shutdown(): Promise<void>;
};

export type AgentPondFlushTarget = {
	forceFlush(): Promise<void>;
};

export type AgentPondNodeSignal = "SIGINT" | "SIGTERM";

export type AgentPondNodeProcess = {
	readonly pid: number;
	kill(pid: number, signal: AgentPondNodeSignal): boolean;
	once(signal: AgentPondNodeSignal, listener: () => void): unknown;
	removeListener(signal: AgentPondNodeSignal, listener: () => void): unknown;
};

export type AgentPondNodeShutdownOptions = {
	/**
	 * Called when shutdown or signal re-delivery fails in a signal handler.
	 * Manual calls to `shutdown()` still reject so the caller can handle them.
	 */
	onError?: (error: unknown) => void;
	/**
	 * Override the Node process interface. Intended for tests and process hosts.
	 */
	process?: AgentPondNodeProcess;
	signals?: readonly AgentPondNodeSignal[];
};

export type AgentPondNodeShutdownRegistration = {
	/**
	 * Remove signal listeners without shutting down the target.
	 */
	dispose(): void;
	/**
	 * Shut down once without terminating the process.
	 */
	shutdown(): Promise<void>;
};

const defaultNodeSignals = ["SIGINT", "SIGTERM"] as const;

/**
 * Await an OpenTelemetry shutdown before Node terminates.
 *
 * The first configured signal wins. After shutdown completes, the helper
 * re-delivers that signal with its listeners removed so Node preserves normal
 * signal exit semantics.
 */
export function registerAgentPondNodeShutdown(
	target: AgentPondShutdownTarget,
	options: AgentPondNodeShutdownOptions = {},
): AgentPondNodeShutdownRegistration {
	const nodeProcess = options.process ?? process;
	const signals = [...new Set(options.signals ?? defaultNodeSignals)];
	const listeners = new Map<AgentPondNodeSignal, () => void>();
	let shutdownPromise: Promise<void> | undefined;
	let disposed = false;
	const reportError = (error: unknown) => {
		try {
			if (options.onError) {
				options.onError(error);
			} else {
				console.error("AgentPond lifecycle error", error);
			}
		} catch {
			// Error reporting must not prevent signal re-delivery.
		}
	};

	const dispose = () => {
		if (disposed) return;
		disposed = true;
		for (const [signal, listener] of listeners) {
			nodeProcess.removeListener(signal, listener);
		}
		listeners.clear();
	};

	const shutdown = () => {
		if (!shutdownPromise) {
			dispose();
			shutdownPromise = Promise.resolve().then(() => target.shutdown());
		}
		return shutdownPromise;
	};

	for (const signal of signals) {
		const listener = () => {
			void shutdown()
				.catch(reportError)
				.finally(() => {
					try {
						nodeProcess.kill(nodeProcess.pid, signal);
					} catch (error) {
						reportError(error);
					}
				});
		};
		listeners.set(signal, listener);
		nodeProcess.once(signal, listener);
	}

	return { dispose, shutdown };
}

/**
 * Schedule a flush with Cloudflare-style `waitUntil` lifecycle APIs.
 */
export function flushAgentPondWithWaitUntil(
	target: AgentPondFlushTarget,
	waitUntil: (promise: Promise<void>) => void,
): void {
	waitUntil(target.forceFlush());
}

/**
 * Schedule a flush with Vercel-style `after` lifecycle APIs.
 */
export function flushAgentPondWithAfter(
	target: AgentPondFlushTarget,
	after: (task: () => Promise<void>) => void,
): void {
	after(() => target.forceFlush());
}
