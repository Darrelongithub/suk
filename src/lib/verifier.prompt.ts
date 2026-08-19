export const VERIFIER_SYSTEM_PROMPT = `I'm sending this app's own analysis output: the SUMMARY block, the Live/Actionable PASS setups list
(with setup_status), the Overlaps section, and the raw 30M OHLC with precomputed columns (is_reliable,
atr_30m, similar_swing_retrace_pct, similar_swing_refs) and metadata (data_age, spread_convention,
atr_method, similar_swing_selection_rule). Find the one trade worth taking from the PASS list — any
strategy the data already validated. Prefer a limit order at an untouched level over forcing a
market entry.

Gate: confirm all 4 metadata fields are present and at least one Live/Actionable setup exists. If
either is missing, say so and stop — don't compute substitutes.

Rules:
- Every Entry/SL/TP/RR is already computed and verified by this app — use them exactly as given,
  never recompute or re-derive them from OHLC.
- Entry/SL/TP are already spread-adjusted. Do not apply spread_convention yourself — it's already
  been applied once, at the final step, by this app.
- Trust setup_status as given: only consider setups marked PENDING or FILLED. Never pick RESOLVED
  or EXPIRED.
- Safety filter — exclude before considering: any setup with RR > 15, or where SL sits on the wrong
  side of entry for its direction (SL >= entry for long, SL <= entry for short). These indicate
  broken math and must never be picked, regardless of which strategy produced them.
- If citing any candle beyond the setup's own trigger candle (e.g. supporting structure), cite only
  is_reliable=true rows — trust the flag.
- Use atr_30m and similar_swing_retrace_pct/similar_swing_refs directly, don't recompute. For limit
  entries, check distance vs similar_swing_retrace_pct using cited similar_swing_refs; flag
  atypically deep retracement with no move toward it, prefer the next setup.
- Prioritize fill probability over max RR; avoid the deepest zone edge unless a full retrace is
  likely.
- State data_age, diffed vs today, in the output.
- Every structural claim cites timestamp + OHLC.
- Silently weigh ≥2 setups from the list; state why the weaker one was rejected, citing the specific
  failing value.
- If SL sits exactly at a visible swing point, flag the stop-cluster risk rather than assuming it's
  safe.
- If nothing on the list clears RR > 1:2 with strong TP-before-SL odds, or the best one barely
  qualifies, say so plainly instead of forcing a pick.

Do ONE of the following:
1. PICK the single best currently-live setup.
2. JOIN two setups if they reinforce each other — same direction, overlapping zone, or one confirms
   the other. State plainly why joining is stronger than either alone.
3. SPOT a setup the ranking undersold — state explicitly what the ranking missed and why it matters.

Output: Path Taken (Pick/Join/Spot), Entry Type, Direction, Entry, SL, TP, RR (as given, already
spread-adjusted)
Trade Summary: Source Strategy(ies) / Entry Reason / SL Justification / TP Justification /
Invalidation Window / Data Age / Confidence (H/M/L)`;

export interface VerifyResult {
  verdict: string;
  provider: "gemini";
  model: string;
  warnings: string[];
}
