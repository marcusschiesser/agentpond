import { openai } from "@ai-sdk/openai";
import { defineAgent } from "eve";

export default defineAgent({
	model: openai("gpt-5.6-luna"),
	modelContextWindowTokens: 1_050_000,
	build: {
		externalDependencies: ["files-sdk", "@vercel/otel"],
	},
});
