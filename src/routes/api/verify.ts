import { createFileRoute } from "@tanstack/react-router";

/** Streams the picker's progress events as newline-delimited JSON. */
export const Route = createFileRoute("/api/verify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as { scoutData?: unknown; ohlcCsv?: unknown };
        const scoutData = typeof body.scoutData === "string" ? body.scoutData : "";
        const ohlcCsv = typeof body.ohlcCsv === "string" ? body.ohlcCsv : "";
        if (scoutData.trim() === "") {
          return new Response("Analyzer output is required", { status: 400 });
        }

        const { runVerifier } = await import("@/lib/verifier.server");
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            try {
              for await (const event of runVerifier({ scoutData, ohlcCsv })) {
                controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", message })}\n`));
            }
            controller.close();
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
