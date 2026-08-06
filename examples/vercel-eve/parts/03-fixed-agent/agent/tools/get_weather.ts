import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
	description: "Get the current weather for a city.",
	inputSchema: z.object({
		city: z.string(),
	}),
	async execute(input) {
		return {
			city: input.city,
			condition: "Rainy",
			temperatureC: 12,
		};
	},
});
