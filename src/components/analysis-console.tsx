import { useEffect, useRef } from "react";

import { Progress } from "@/components/ui/progress";

export interface ConsoleLine {
  time: string;
  message: string
  tone?: "info" | "warn" | "error" | "success";
}

interface AnalysisConsoleProps {
  percent: number;
  phase: string;
  lines: ConsoleLine[];
  running: boolean;
}

const TONE: Record<NonNullable<ConsoleLine["tone"]>, string> = {
  info: "text-muted-foreground",
  warn: "text-warning",
  error: "text-destructive",
  success: "text-success",
};

export function AnalysisConsole({ percent, phase, lines, running }: AnalysisConsoleProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest line in view while the pipeline is talking.
  useEffect(() => {
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [lines.length]);

  return (
    <section className="panel flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium text-foreground">Analysis progress</h2>
          <p className="text-xs text-muted-foreground">
            Live pipeline log · parse → structure → 13 strategies → RR math → verifier
          </p>
        </div>
        <span className="num text-sm font-semibold text-primary">{Math.round(percent)}%</span>
      </div>

      <Progress value={percent} className={running ? "animate-pulse" : ""} />

      <p className="num text-xs text-muted-foreground">{phase}</p>

      <div
        ref={boxRef}
        role="log"
        aria-live="polite"
        className="num max-h-56 overflow-y-auto rounded-md border border-border bg-black/40 p-3 text-[11px] leading-relaxed"
      >
        {lines.length === 0 ? (
          <p className="text-muted-foreground">waiting for a generated CSV…</p>
        ) : (
          lines.map((line, i) => (
            <p key={`${i}-${line.time}`} className={TONE[line.tone ?? "info"]}>
              <span className="text-primary">[{line.time}]</span> {line.message}
            </p>
          ))
        )}
      </div>
    </section>
  );
}
