import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
	type AgentPondNodeProcess,
	type AgentPondNodeSignal,
	flushAgentPondWithAfter,
	flushAgentPondWithWaitUntil,
	registerAgentPondNodeShutdown,
} from "../src/index.js";

class FakeProcess extends EventEmitter implements AgentPondNodeProcess {
	readonly pid = 42;
	readonly kills: Array<{ pid: number; signal: AgentPondNodeSignal }> = [];

	kill(pid: number, signal: AgentPondNodeSignal): boolean {
		this.kills.push({ pid, signal });
		return true;
	}

	override once(signal: AgentPondNodeSignal, listener: () => void): this {
		return super.once(signal, listener);
	}

	override removeListener(
		signal: AgentPondNodeSignal,
		listener: () => void,
	): this {
		return super.removeListener(signal, listener);
	}
}

test("Node shutdown waits once and re-delivers the first signal", async () => {
	const fakeProcess = new FakeProcess();
	let releaseShutdown: () => void = () => undefined;
	const shutdownReleased = new Promise<void>((resolve) => {
		releaseShutdown = resolve;
	});
	let shutdownCalls = 0;
	const registration = registerAgentPondNodeShutdown(
		{
			async shutdown() {
				shutdownCalls += 1;
				await shutdownReleased;
			},
		},
		{ process: fakeProcess },
	);

	fakeProcess.emit("SIGTERM");
	fakeProcess.emit("SIGINT");
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(shutdownCalls, 1);
	assert.deepEqual(fakeProcess.kills, []);
	assert.equal(fakeProcess.listenerCount("SIGINT"), 0);
	assert.equal(fakeProcess.listenerCount("SIGTERM"), 0);

	releaseShutdown();
	await registration.shutdown();
	await new Promise((resolve) => setImmediate(resolve));

	assert.deepEqual(fakeProcess.kills, [{ pid: 42, signal: "SIGTERM" }]);
});

test("manual shutdown is idempotent and does not terminate the process", async () => {
	const fakeProcess = new FakeProcess();
	let shutdownCalls = 0;
	const registration = registerAgentPondNodeShutdown(
		{
			async shutdown() {
				shutdownCalls += 1;
			},
		},
		{ process: fakeProcess },
	);

	const firstShutdown = registration.shutdown();
	const secondShutdown = registration.shutdown();

	assert.equal(firstShutdown, secondShutdown);
	await firstShutdown;
	registration.dispose();
	assert.equal(shutdownCalls, 1);
	assert.deepEqual(fakeProcess.kills, []);
	assert.equal(fakeProcess.listenerCount("SIGINT"), 0);
	assert.equal(fakeProcess.listenerCount("SIGTERM"), 0);
});

test("signal shutdown errors are reported before signal re-delivery", async () => {
	const fakeProcess = new FakeProcess();
	const errors: unknown[] = [];
	registerAgentPondNodeShutdown(
		{
			async shutdown() {
				throw new Error("flush failed");
			},
		},
		{
			onError: (error) => errors.push(error),
			process: fakeProcess,
		},
	);

	fakeProcess.emit("SIGINT");
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(errors.length, 1);
	assert.match(String(errors[0]), /flush failed/);
	assert.deepEqual(fakeProcess.kills, [{ pid: 42, signal: "SIGINT" }]);
});

test("waitUntil schedules an immediate force flush", async () => {
	let flushCalls = 0;
	let scheduled: Promise<void> | undefined;

	flushAgentPondWithWaitUntil(
		{
			async forceFlush() {
				flushCalls += 1;
			},
		},
		(promise) => {
			scheduled = promise;
		},
	);

	assert.equal(flushCalls, 1);
	await scheduled;
	assert.equal(flushCalls, 1);
});

test("after schedules a deferred force flush", async () => {
	let flushCalls = 0;
	let scheduled: (() => Promise<void>) | undefined;

	flushAgentPondWithAfter(
		{
			async forceFlush() {
				flushCalls += 1;
			},
		},
		(task) => {
			scheduled = task;
		},
	);

	assert.equal(flushCalls, 0);
	await scheduled?.();
	assert.equal(flushCalls, 1);
});
