import { useEffect, useRef, useState } from "react";

import type { VerifyResult } from "@/lib/verifier.prompt";

type VerifyEvent =
  | { type: "log"; message: string; tone?: "info" | "warn" | "error" | "success" }
  | { type: "result"; result: VerifyResult }
  | { type: "error"; message: string };

interface VerifierPanelProps {
  /** Analyzer LIVE report: SUMMARY block, live PASS setups, overlaps. */
  scoutData: string;
  /** Raw 30M OHLC CSV with metadata header. */
  ohlcCsv: string;
  /** Called once the verdict is in, so the bundle can be zipped and downloaded. */
  onVerdict?: (result: VerifyResult) => void;
  /** Streams verifier stage messages into the analysis console. */
  onLog?: (message: string, tone?: "info" | "warn" | "error" | "success") => void;
}

export function VerifierPanel({ scoutData, ohlcCsv, onVerdict, onLog }: VerifierPanelProps) {
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const onVerdictRef = useRef(onVerdict);
  onVerdictRef.current = onVerdict;
  const onLogRef = useRef(onLog);
  onLogRef.current = onLog;

  useEffect(() => {
    if (started.current || scoutData.trim() === "") return;
    started.current = true;
    let cancelled = false;

    (async () => {
      setBusy(true);
      setError(null);
      setResult(null);
      onLogRef.current?.("Picker: sending live setups + OHLC to Gemini 2.5 Flash…");
      try {
        const res = await fetch("/api/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scoutData, ohlcCsv }),
        });
        if (!res.ok || !res.body) {
          throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim() === "" || cancelled) continue;
            const event = JSON.parse(line) as VerifyEvent;
            if (event.type === "log") onLogRef.current?.(event.message, event.tone);
            if (event.type === "error") {
              setError(event.message);
              onLogRef.current?.(event.message, "error");
            }
            if (event.type === "result") {
              setResult(event.result);
              onVerdictRef.current?.(event.result);
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          onLogRef.current?.(`Picker failed: ${message}`, "error");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scoutData, ohlcCsv]);

  return (
    <section className="panel flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-medium text-foreground">Verifier / Picker</h2>
        <p className="text-xs text-muted-foreground">
          Runs automatically on the live PASS setups plus the analysed OHLC, and picks the one trade
          worth taking.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="num text-xs text-muted-foreground">
          {busy
            ? "Verifying…"
            : result
              ? `via ${result.provider} · ${result.model}`
              : error
                ? "Verifier failed"
                : "Waiting for analysis"}
        </span>
      </div>

      {error ? (
        <p className="num rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {result?.warnings.length ? (
        <p className="num rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-foreground">
          {result.warnings.join(" | ")}
        </p>
      ) : null}

      {result ? (
        <pre className="num max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-secondary/40 p-4 text-xs text-foreground">
          {result.verdict}
        </pre>
      ) : null}
    </section>
  );
}
