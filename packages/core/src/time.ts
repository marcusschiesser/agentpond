export function utcMinutePath(date: Date): string {
	return `${utcHourPath(date)}/${utcPart(date.getUTCMinutes())}`;
}

export function utcHourPath(date: Date): string {
	const yyyy = String(date.getUTCFullYear());
	const mm = utcPart(date.getUTCMonth() + 1);
	const dd = utcPart(date.getUTCDate());
	const hh = utcPart(date.getUTCHours());
	return `${yyyy}/${mm}/${dd}/${hh}`;
}

function utcPart(value: number): string {
	return String(value).padStart(2, "0");
}
