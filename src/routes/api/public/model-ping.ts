import { createFileRoute } from "@tanstack/react-router";

const OR = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "openai/gpt-oss-20b:free",
  "deepseek/deepseek-r1",
  "deepseek/deepseek-r1-0528",
  "deepseek/deepseek-chat-v3-0324",
];

/** Temporary diagnostic: which verifier models actually answer right now. */
export const Route = createFileRoute("/api/public/model-ping")({
  server: {
    handlers: {
      GET: async () => {
        const key = process.env["OPENROUTER_API_KEY"];
        if (!key) return new Response("no key", { status: 500 });
        const out: string[] = [];
        for (const model of OR) {
          const started = Date.now();
          try {
            const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
              method: "POST",
              headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                model,
                messages: [{ role: "user", content: "say ok" }],
                max_tokens: 20,
              }),
              signal: AbortSignal.timeout(30_000),
            });
            const text = await res.text();
            out.push(`${model} ${res.status} ${Date.now() - started}ms ${text.slice(0, 160)}`);
          } catch (e) {
            out.push(`${model} THREW ${Date.now() - started}ms ${String(e).slice(0, 160)}`);
          }
        }
        return new Response(out.join("\n\n"));
      },
    },
  },
});
