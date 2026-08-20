import { useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import JSZip from "jszip";
import { ArrowLeft, Brain, Download, History, Loader2, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STRATEGIES } from "@/lib/analyzer/strategies";
import { AVAILABLE_SYMBOLS, TWELVE_DATA_API_KEYS } from "@/lib/market-data";
import { buildOhlcCsv } from "@/lib/ohlc-generator";
import {
  analyseDay,
  applyTriggers,
  buildDayReport,
  dayFileName,
  emptyState,
  monthWindowStart,
  rangeDays,
  winRate,
  type BacktestState,
  type DayTrigger,
} from "@/lib/backtest/engine";

function inIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  if (inIframe()) window.open(url, "_blank", "noopener");
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function Backtest() {
  const [symbol, setSymbol] = useState("XAU/USD");
  const [fromDate, setFromDate] = useState(today());
  const [toDate, setToDate] = useState(today());

  const [isRunning, setIsRunning] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState<number | null>(null);
  const [currentDay, setCurrentDay] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [logs, setLogs] = useState<string[]>([]);
  const [state, setState] = useState<BacktestState>(() => emptyState("XAU/USD"));
  const [zip, setZip] = useState<{ name: string; url: string } | null>(null);

  const stopRef = useRef(false);
  const keyIndexRef = useRef(0);

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev.slice(-400), `${new Date().toLocaleTimeString()}  ${msg}`]);
  };

  const days = useMemo(() => rangeDays(fromDate, toDate), [fromDate, toDate]);

  const statsRows = useMemo(
    () => Object.values(state.stats).sort((a, b) => a.strategy.localeCompare(b.strategy)),
    [state.stats],
  );

  const handleStop = () => {
    stopRef.current = true;
    addLog("Stop requested — finishing the current day, then halting.");
  };

  const handleRun = async () => {
    if (isRunning) return;
    if (days.length === 0) {
      toast.error("The From date must be on or before the To date.");
      return;
    }

    stopRef.current = false;
    setIsRunning(true);
    setLogs([]);
    setZip(null);
    setProgress({ done: 0, total: days.length });

    // Every run is self-contained: the selected range is always processed in full.
    const working: BacktestState = emptyState(symbol);
    setState(working);

    addLog(`Auto-Backtest ${symbol} | ${days[0]} → ${days[days.length - 1]} (${days.length} day(s))`);
    addLog("Each day is analysed on its own one-month window of 30M candles — no AI call.");

    const collected: { name: string; content: string }[] = [];

    for (let i = 0; i < days.length; i++) {
      if (stopRef.current) {
        addLog("Run halted by user.");
        break;
      }

      const day = days[i]!;
      setCurrentDay(day);
      const windowStart = monthWindowStart(day);
      addLog(`\n${day} (${i + 1}/${days.length}) — window ${windowStart} → ${day}`);

      let skipReason: string | undefined;
      let triggers: DayTrigger[] = [];
      let analyzedRows = 0;
      let invalidRows = 0;
      let lastRowDatetime = "-";

      try {
        const csv = await buildOhlcCsv({
          symbol,
          startDate: windowStart,
          endDate: day,
          specifyTime: false,
          startTime: "00:00",
          endTime: "23:59",
          apiKeys: TWELVE_DATA_API_KEYS,
          keyIndexRef,
          log: addLog,
          setCooldown: setCooldownSeconds,
        });

        if (!csv) {
          skipReason = "no usable OHLC data returned for this window (market closed or bad data)";
        } else {
          const outcome = analyseDay(csv, day);
          if (!outcome.ok) {
            skipReason = `analysis rejected the data: ${outcome.error}`;
          } else {
            triggers = outcome.triggers;
            analyzedRows = outcome.analyzedRows;
            invalidRows = outcome.invalidRows;
            lastRowDatetime = outcome.lastRowDatetime;
          }
        }
      } catch (error) {
        skipReason = `data pull/analysis failed: ${String(error)}`;
      }

      if (skipReason) {
        working.skipped.push({ day, reason: skipReason });
        addLog(`${day} skipped — ${skipReason}`);
      } else {
        applyTriggers(working, triggers);
        addLog(`${day}: ${triggers.length} new trigger(s) from ${analyzedRows} candles`);
      }

      working.firstDay = working.firstDay ?? day;
      working.days.push(day);
      working.lastCompletedDay = day;
      setState({ ...working, stats: { ...working.stats } });
      setProgress({ done: i + 1, total: days.length });

      collected.push({
        name: dayFileName(day),
        content: buildDayReport({
          symbol,
          day,
          checkpoint: "23:59",
          windowStart,
          state: working,
          triggers,
          skipReason,
          analyzedRows,
          invalidRows,
          lastRowDatetime,
        }),
      });
    }

    setCurrentDay(null);
    setCooldownSeconds(null);
    setIsRunning(false);

    if (collected.length === 0) {
      toast.error("Nothing was analysed.");
      return;
    }

    try {
      const bundle = new JSZip();
      for (const file of collected) bundle.file(file.name, file.content);
      const blob = await bundle.generateAsync({ type: "blob" });
      const name = `backtest_${symbol.replace("/", "")}_${collected[0]!.name.slice(9, 19)}_to_${collected[collected.length - 1]!.name.slice(9, 19)}.zip`;
      downloadBlob(blob, name);
      setZip({ name, url: URL.createObjectURL(blob) });
      addLog(`Bundled ${collected.length} day report(s) into ${name}.`);
      toast.success(`Backtest finished — ${collected.length} day report(s) zipped`);
    } catch (error) {
      addLog(`ZIP packaging failed: ${String(error)}`);
      toast.error("ZIP packaging failed.");
    }
  };

  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/analysis"
              className="flex w-fit items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-[11px] font-bold text-primary transition-colors hover:bg-primary/20"
            >
              <Brain size={12} /> Analyser
            </Link>
            <Link
              to="/"
              className="flex w-fit items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-[11px] font-bold text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft size={12} /> Data fetcher
            </Link>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                <History size={22} className="text-primary" /> Auto-Backtester
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Pick a date range. Each day is analysed against its own previous month of 30M
                candles with the {STRATEGIES.length} structure strategies, and every day report is
                packed into one ZIP.
              </p>
            </div>
            <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className={`size-2.5 rounded-full ${
                  isRunning ? "animate-pulse bg-warning" : zip ? "bg-success" : "bg-muted-foreground"
                }`}
                aria-hidden
              />
              {isRunning
                ? `Running ${currentDay ?? ""} (${progress.done}/${progress.total})`
                : zip
                  ? "Complete"
                  : "Ready"}
              {cooldownSeconds !== null && (
                <span className="font-mono text-warning">· cooldown {cooldownSeconds}s</span>
              )}
            </span>
          </div>
        </header>

        <section className="glass-card flex flex-col gap-4 rounded-xl p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-[11px] uppercase tracking-wide">Symbol</Label>
              <Select value={symbol} onValueChange={setSymbol} disabled={isRunning}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {AVAILABLE_SYMBOLS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="from" className="text-[11px] uppercase tracking-wide">
                From
              </Label>
              <Input
                id="from"
                type="date"
                value={fromDate}
                disabled={isRunning}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="to" className="text-[11px] uppercase tracking-wide">
                To
              </Label>
              <Input
                id="to"
                type="date"
                value={toDate}
                disabled={isRunning}
                onChange={(event) => setToDate(event.target.value)}
              />
            </div>
          </div>

          <p className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 font-mono text-[11px] text-muted-foreground">
            {days.length === 0
              ? "From date must be on or before the To date."
              : `${days.length} day(s) queued · first window ${monthWindowStart(days[0]!)} → ${days[0]} · last window ${monthWindowStart(days[days.length - 1]!)} → ${days[days.length - 1]}`}
          </p>

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleRun} disabled={isRunning || days.length === 0} className="flex-1">
              {isRunning ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Running {currentDay ?? ""}
                </>
              ) : (
                <>
                  <Play size={14} /> Run backtest
                </>
              )}
            </Button>
            <Button variant="outline" onClick={handleStop} disabled={!isRunning}>
              <Square size={14} /> Stop
            </Button>
            {zip && (
              <Button variant="ghost" asChild>
                <a href={zip.url} download={zip.name}>
                  <Download size={14} /> {zip.name}
                </a>
              </Button>
            )}
          </div>

          {isRunning && progress.total > 0 && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
          )}
        </section>

        <section className="glass-card flex flex-col gap-3 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground">
            Rolling stats {state.firstDay ? `since ${state.firstDay}` : ""}
          </h2>
          {statsRows.length === 0 ? (
            <p className="text-xs text-muted-foreground">No triggers recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-3">Strategy</th>
                    <th className="py-1.5 pr-3">Triggers</th>
                    <th className="py-1.5 pr-3">TP</th>
                    <th className="py-1.5 pr-3">SL</th>
                    <th className="py-1.5 pr-3">Open</th>
                    <th className="py-1.5">Win rate</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {statsRows.map((row) => {
                    const rate = winRate(row);
                    return (
                      <tr key={row.strategyId} className="border-t border-border/40">
                        <td className="py-1.5 pr-3 font-sans text-foreground">{row.strategy}</td>
                        <td className="py-1.5 pr-3">{row.triggers}</td>
                        <td className="py-1.5 pr-3 text-success">{row.tpHits}</td>
                        <td className="py-1.5 pr-3 text-destructive">{row.slHits}</td>
                        <td className="py-1.5 pr-3">{row.open}</td>
                        <td className="py-1.5">{rate === null ? "n/a" : `${rate.toFixed(1)}%`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="glass-card flex flex-col gap-3 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground">Run log</h2>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {logs.length === 0 ? "Idle — pick a range and run." : logs.join("\n")}
          </pre>
        </section>
      </div>
    </main>
  );
}
