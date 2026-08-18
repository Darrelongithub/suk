# Fix the NVIDIA / picker failure

## What's actually wrong

The picker never finishes because none of the providers it tries can answer:

- `OPENROUTER_API_KEY` and `NVIDIA_API_KEY` are not configured on this project, so every OpenRouter and NVIDIA attempt in `src/lib/verifier.functions.ts` fails immediately and the run ends with "Verifier unavailable".
- On top of that, the NVIDIA slugs themselves are stale — `nvidia/nemotron-3-ultra-550b-a55b:free` 502s upstream and the free DeepSeek slugs have been retired — so even with a key those attempts would keep failing.
- The build is currently broken: `src/lib/verifier.server.ts` (written last session) imports `./verifier.prompt`, a file that does not exist.

The fix is to stop depending on NVIDIA/OpenRouter at all and run the picker on the built-in Lovable AI Gateway, which is already configured and answering on this project.

## The fix

1. Create `src/lib/verifier.prompt.ts` holding `VERIFIER_SYSTEM_PROMPT` and the `VerifyResult` type, with `provider` widened to include `"lovable"`. This unbreaks the build.
2. Point the picker at the Lovable AI Gateway as the primary provider, using catalog model ids and the gateway's own auth header. OpenRouter and NVIDIA stay only as optional fallbacks that are skipped entirely when their keys are absent — no more stalling on dead slugs.
3. Keep the per-model timeout short (45s) so a slow model fails over instead of hanging the page, and surface each attempt's outcome as a log line.
4. Stream picker progress to the console: a small POST route that consumes the existing `runVerifier` generator and emits one JSON line per event; `VerifierPanel` reads that stream and forwards each event to `onLog`, so the console narrates "asking model X…", "answered in Ys", "failed — reason".
5. Delete the temporary diagnostic route `src/routes/api/public/model-ping.ts`.
6. Retire the old `verifySetup` server function once the panel uses the stream, keeping `verifier.functions.ts` only as a re-export of the prompt/type if anything still imports it.
7. Run one real picker request end to end and read the verdict before calling it done, then re-run typecheck and tests.

## Technical notes

- Gateway calls go to `https://ai.gateway.lovable.dev/v1/chat/completions` with the `Lovable-API-Key` header (not `Authorization: Bearer`), and model ids must be exact catalog strings — I'll confirm the current chat ids against the model catalog before wiring them in rather than reusing the ones in the draft file.
- Gateway error statuses are handled per the standard contract: 429/5xx fail over to the next model, 400/401/402/403 are terminal and surfaced verbatim in the console.
- No analyzer logic changes; this is confined to the verifier/picker path and its UI wiring.

## Not included

The V2 UI cleanup you asked for earlier is not part of this plan — say the word and I'll fold it in or do it right after.
