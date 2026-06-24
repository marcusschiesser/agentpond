export function sql(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}
