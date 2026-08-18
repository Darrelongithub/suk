import { createFileRoute } from "@tanstack/react-router";

const MODELS = ["google/gemini-3-flash", "google/gemini-2.5-flash", "openai/gpt-5-mini"];

/** Temporary diagnostic: which verifier models actually answer right now. */
export const Route = createFileRoute("/api/public/model-ping")({
  server: {
    handlers: {
      GET: async () => {
        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return new Response("no key", { status: 500 });
        const out: string[] = [];
        for (const model of MODELS) {
          const started = Date.now();
          try {
            const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
            out.push(`${model} ${res.status} ${Date.now() - started}ms ${text.slice(0, 200)}`);
          } catch (e) {
            out.push(`${model} THREW ${Date.now() - started}ms ${String(e).slice(0, 160)}`);
          }
        }
        return new Response(out.join("\n\n"));
      },
    },
  },
});
