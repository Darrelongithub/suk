# Verifier on Gemini 2.5 Flash (Google AI Studio)

## Why the picker never finishes today

Neither `OPENROUTER_API_KEY` nor `NVIDIA_API_KEY` is configured on this project, so every model attempt in `src/lib/verifier.functions.ts` fails and no verdict ever lands. The slugs themselves are also stale (the nemotron ultra slug 502s, the free DeepSeek slugs were retired). Replacing the whole chain with one direct Google AI Studio call removes both problems permanently.

The build is currently broken too: `src/lib/verifier.server.ts` imports `./verifier.prompt`, a file that does not exist. This plan creates it.

## What changes

1. **Secret** — collect `GEMINI_API_KEY` through the secure secret form and read it only on the server, never in client code.
2. **Single provider** — the verifier calls
   `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`
   with the key in the `x-goog-api-key` header (Google's current documented method; the `?key=` query param stays the fallback if the header path errors). I'll check the live Google AI Studio docs for the exact request shape before wiring it.
3. **Request shape** — Google's native generateContent format, not OpenAI-style: the existing `VERIFIER_SYSTEM_PROMPT` goes in `systemInstruction`, the scout output + trimmed OHLC CSV goes in `contents[0].parts[0].text`, and the reply is read from `candidates[0].content.parts[].text`. The 60k-char CSV trim stays as is.
4. **Remove entirely** — OpenRouter and NVIDIA NIM URLs, keys, headers, the multi-model fallback loop, and every DeepSeek / Nemotron / gpt-oss slug. One provider, one model, no chain.
5. **No abort timer** — the current `AbortSignal.timeout(...)` is dropped; an aborted generation is billed anyway and Gemini 2.5 Flash can think for a while. Errors surface as-is instead.
6. **`src/lib/verifier.prompt.ts`** — new file holding `VERIFIER_SYSTEM_PROMPT` and the `VerifyResult` type, with `provider` narrowed to `"gemini"`. Unbreaks the build.
7. **Console progress** — a small POST route consumes the existing `runVerifier` generator and streams one JSON line per event; `VerifierPanel` reads it and forwards each event to `onLog`, so the console narrates "asking Gemini 2.5 Flash…", "answered in Ys", or the exact error text.
8. **Cleanup** — delete the temporary diagnostic route `src/routes/api/public/model-ping.ts`; `verifier.functions.ts` keeps only what still needs to be imported.

Unchanged: the verifier prompt text, its inputs (picker output + SUMMARY/setups + candles), and the output panel rendering.

## Error handling

Google's own status codes, surfaced verbatim in the console rather than retried in a loop: `429` means the free-tier limit (10/min, 250/day) was hit and says to wait; `400`/`403` mean a bad or unauthorised key; `5xx` gets a single bounded retry.

## Verification

Run one real verifier request end to end, read the returned verdict, then re-run typecheck and tests.
