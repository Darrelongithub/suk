# Trading Strategy Analyzer

A standalone, fully client-side tool: upload a finished CSV (metadata header line + OHLC rows with precomputed columns), and it validates, computes market structure, runs 13 strategy checks per row, and reports results. Nothing is generated or estimated — every price traces back to a real row. No backend, no persistence (session only).

## Screens

Single page at `/`:

1. **Upload panel** — drag/drop or file picker for the CSV. Shows parse status.
2. **Validation gate** — blocks analysis and shows `INVALID FILE: missing metadata field [name]` if any of `data_age`, `spread_convention`, `atr_method`, `similar_swing_selection_rule` is missing/empty. Also shows the parsed metadata once valid.
3. **Summary panel** — `data_age` shown prominently (raw value plus how old it is versus now in days/hours, styled as a warning when stale), total candles analyzed, total INVALID rows, per-strategy pass count, per-strategy fail counts grouped by reason, a multi-strategy overlap flag (e.g. "3 candles passed 2+ strategies", naming those candles and which strategies — nothing merged or resolved, just surfaced), and a ranked list of all PASSing setups sorted by RR descending.
4. **Results table** — every strategy × relevant candle: datetime, strategy, PASS/FAIL, reason, trend context, entry, SL, TP, RR. Filter by strategy name and by result. Virtualized/paginated for up to ~5,000 rows.
5. **Zero-PASS state** — if nothing passes, summary and table show an explicit "0 setups passed" state with the fail-reason breakdown still visible, not an empty/broken-looking table.

## Auto-export (no button)

- The moment analysis finishes, a file download is triggered automatically — no click.
- Format `.txt`, containing everything: the full summary data and the full results table (every strategy × candle, PASS/FAIL, reason, trend, entry/SL/TP/RR) — not just passing setups. Sectioned as `=== SUMMARY ===` then `=== RESULTS ===`.
- Filename comes from the datetime of the last row in the uploaded CSV, as date + time (e.g. `2026-08-14_1700.txt`), so same-day re-runs don't overwrite.
- Additive: the on-screen summary and table stay.

## Analysis pipeline

**Parse.** First non-empty line is JSON metadata; remaining lines are the header + data rows. `similar_swing_refs` is a JSON array of datetime strings (e.g. `["2026-08-06 08:30:00", ...]`) which are resolved back to rows in the file to get their high/low prices.

**Row validation.** Any row missing `open`, `high`, `low`, `close`, or `is_reliable` is marked `INVALID: missing core fields`, excluded from every strategy check, but still counted in the summary.

**Unresolved swing references.** A datetime in `similar_swing_refs` that matches no row in the file is never treated as null/empty. Any strategy check depending on it reports `INVALID: unresolved swing reference [datetime]`, kept distinct from `missing field: <name>`.

**Market structure (once, feeds all strategies).** For each row, take the last 5 swing highs/lows resolved from `similar_swing_refs`: rising highs + rising lows → `bullish`; falling highs + falling lows → `bearish`; otherwise `ranging`. Stored on every row.

**13 strategy checks**, each returning PASS/FAIL plus a specific reason string per row, implemented exactly as specified: BOS + Retest, Liquidity Sweep + Reclaim, Horizontal Range + Boundary Rejection, Order Block Return, FVG Fill, Pin Bar at Key Level, Engulfing at S/R, Pin Bar/Engulfing at 61.8% Fib, Pivot Point Rejection, Asian Sweep + London Reclaim, Opening Range Breakout + Retest, EMA 50/200 Pullback, Swing Failure Pattern. No row is skipped silently; when a needed field is absent the reason names that exact field (e.g. `missing field: displacement`).

**Math (PASS results only).** Entry/SL/TP are exact values pulled from actual OHLC rows. `spread_convention` from metadata is applied only at this final step. `RR = (TP − Entry) / (Entry − SL)`, spread-adjusted. RR ≤ 1:2 flips the result to FAIL with reason `RR below 1:2 threshold` and removes it from the passing list.

## UI style

Dark, blue-accented "terminal/trading desk" look:

- Card-based sections on a dark background, each with a colored left accent bar and a small square icon badge (blue background, white icon) top-left.
- Bold white section headers with a gray subtitle line describing format (e.g. "Analysis Output · TXT · Auto-download").
- Rounded dark input/dropdown fields for the strategy and PASS/FAIL filters.
- Small status indicator (colored dot + label): "Ready" / "Analyzing..." / "Complete".
- Blue accents throughout (icon backgrounds, accent bars, active text) — no red/pink accent theme.

## Technical notes

- Route: rewrite `src/routes/index.tsx` with its own `head()` metadata (title/description/og/twitter).
- Pure TypeScript analysis modules under `src/lib/analyzer/`: `parse.ts` (CSV + metadata), `types.ts`, `structure.ts` (trend + swing resolution), `indicators.ts` (EMA 50/200, pivots, fib, session grouping), `strategies/` (one file per strategy exporting a common `StrategyCheck` signature), `run.ts` (orchestrates all steps), `export.ts` (auto-download .txt generation).
- Runs synchronously in the browser on upload (under 5,000 rows), with a progress state while computing.
- UI from existing shadcn primitives + semantic design tokens in `src/styles.css`; the blue dark palette added as tokens rather than hardcoded colors.
- Unit tests for the parser, structure detection, RR/spread math, and the unresolved-swing-reference path.
- One test file per strategy: all 13 get at least a PASS case and a FAIL case asserting the exact reason string, built from synthetic rows.
