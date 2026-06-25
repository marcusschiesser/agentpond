import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import type { ObjectStore } from "./types.js";

export class FileSystemObjectStore implements ObjectStore {
	private readonly root: string;

	constructor(rootPath: string) {
		this.root = resolve(rootPath);
	}

	async putJson(key: string, value: unknown): Promise<void> {
		const path = this.pathForKey(key);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(value), "utf8");
	}

	async getJson<T>(key: string): Promise<T> {
		const content = await readFile(this.pathForKey(key), "utf8");
		return JSON.parse(content) as T;
	}

	async listKeys(prefix: string): Promise<string[]> {
		const keys: string[] = [];
		await this.collectKeys(this.root, keys);
		return keys.filter((key) => key.startsWith(prefix)).sort();
	}

	private pathForKey(key: string): string {
		if (key.startsWith("/") || key.includes("\0")) {
			throw new Error(`Invalid object key: ${key}`);
		}
		const path = resolve(this.root, key);
		const rel = relative(this.root, path);
		if (rel === "" || rel.startsWith("..") || rel.includes(`..${sep}`)) {
			throw new Error(`Object key escapes store root: ${key}`);
		}
		return path;
	}

	private async collectKeys(dir: string, keys: string[]): Promise<void> {
		let entries: Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
		for (const entry of entries) {
			const path = resolve(dir, entry.name);
			if (entry.isDirectory()) {
				await this.collectKeys(path, keys);
				continue;
			}
			if (!entry.isFile()) continue;
			keys.push(relative(this.root, path).split(sep).join("/"));
		}
	}
}
