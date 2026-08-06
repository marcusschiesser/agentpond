import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

export default defineEval({
	description:
		"Regression for the AgentPond trace where the weather answer contradicted the completed tool result.",
	async test(t) {
		await t.send("What is the weather in Berlin?");

		t.succeeded();
		t.calledTool("get_weather", {
			input: { city: /berlin/i },
			count: 1,
		});
		t.check(t.reply, includes(/rainy/i)).label("tool condition");
		t.check(t.reply, includes(/12\s*°?\s*c/i)).label("tool temperature");
	},
});
