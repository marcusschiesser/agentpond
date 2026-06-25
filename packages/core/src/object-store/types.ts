export type ObjectStore = {
	putJson(key: string, value: unknown): Promise<void>;
	getJson<T>(key: string): Promise<T>;
	listKeys(prefix: string): Promise<string[]>;
};
