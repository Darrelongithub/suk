import { VERIFIER_SYSTEM_PROMPT, type VerifyResult } from "./verifier.prompt";

// Google AI Studio 404s gemini-2.5-flash for new keys ("no longer available to new users")
// and names gemini-3.6-flash as its replacement — same free tier, same Flash class.
const MODEL = "gemini-3.6-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const OHLC_CHAR_LIMIT = 60_000;

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string; status?: string };
}

function trimCsv(csv: string): string {
  if (csv.length <= OHLC_CHAR_LIMIT) return csv;
  const lines = csv.split("\n");
  const head = lines.slice(0, 2).join("\n");
  const tail: string[] = [];
  let size = head.length;
  for (let i = lines.length - 1; i > 1; i--) {
    const line = lines[i] as string;
    if (size + line.length > OHLC_CHAR_LIMIT) break;
    size += line.length;
    tail.unshift(line);
  }
  return `${head}\n${tail.join("\n")}\n(note: older rows truncated to fit the context window)`;
}

/** Human-readable explanation for the statuses Google AI Studio actually returns. */
function explain(status: number, message: string): string {
  if (status === 429) {
    return `Google AI Studio free-tier limit reached (10 requests/minute, 250/day) — wait a moment and re-run. ${message}`;
  }
  if (status === 400 || status === 403) {
    return `Gemini rejected the key or request (${status}) — check GEMINI_API_KEY. ${message}`;
  }
  return `Gemini error ${status}: ${message}`;
}

async function callGemini(apiKey: string, userContent: string): Promise<string> {
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: VERIFIER_SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: userContent }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
  });

  // No abort timer: the generation is billed even if we hang up on it.
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body,
  });

  const text = await res.text();
  let payload: GeminiResponse = {};
  try {
    payload = JSON.parse(text) as GeminiResponse;
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    throw new Error(explain(res.status, payload.error?.message ?? text.slice(0, 300)));
  }
  const content = (payload.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!content) throw new Error("Gemini returned an empty response");
  return content;
}

export type VerifyEvent =
  | { type: "log"; message: string; tone?: "info" | "warn" | "error" | "success" }
  | { type: "result"; result: VerifyResult }
  | { type: "error"; message: string };

/** Runs the picker on Gemini 2.5 Flash, emitting progress events for the console. */
export async function* runVerifier(input: {
  scoutData: string;
  ohlcCsv?: string;
}): AsyncGenerator<VerifyEvent> {
  const userContent = [
    "--- ANALYZER OUTPUT (SUMMARY + LIVE/ACTIONABLE PASS setups + Overlaps) ---",
    input.scoutData.trim(),
    "",
    "--- RAW 30M OHLC WITH PRECOMPUTED COLUMNS AND METADATA ---",
    trimCsv((input.ohlcCsv ?? "").trim()) || "(none supplied)",
  ].join("\n");

  yield {
    type: "log",
    message: `Picker: prompt built (${Math.round(userContent.length / 1000)}k chars)`,
  };

  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) {
    yield { type: "error", message: "GEMINI_API_KEY is not configured." };
    return;
  }

  yield { type: "log", message: `Picker: asking Google AI Studio · ${MODEL}…` };
  const started = Date.now();
  try {
    const verdict = await callGemini(apiKey, userContent);
    yield {
      type: "log",
      message: `Picker: ${MODEL} answered in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      tone: "success",
    };
    yield {
      type: "result",
      result: { verdict, provider: "gemini", model: MODEL, warnings: [] },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    yield {
      type: "log",
      message: `Picker: failed after ${((Date.now() - started) / 1000).toFixed(1)}s — ${message}`,
      tone: "error",
    };
    yield { type: "error", message };
  }
}
