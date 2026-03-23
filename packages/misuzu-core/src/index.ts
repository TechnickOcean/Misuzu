import { getModel, complete } from "@mariozechner/pi-ai";
const model = getModel("openrouter", "stepfun/step-3.5-flash:free");
console.log(
  await complete(
    model,
    {
      messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
    },
    {
      reasoningEffort: "medium",
      reasoningSummary: "detailed",
    },
  ),
);
