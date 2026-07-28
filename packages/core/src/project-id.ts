export const defaultAgentPondProjectId = "default-project";

export function resolveAgentPondProjectId(
	projectId: string | undefined,
): string {
	return projectId ?? defaultAgentPondProjectId;
}
