import { VERIFIER_SYSTEM_PROMPT, type VerifyResult } from "./verifier.prompt";

interface Attempt {
  provider: VerifyResult["provider"];
  url: string;
  model: string;
  key: string;
  headers?: Record<string, string>;
}

interface ChatResponse {
  choices?: {
    message?: { content?: string; reasoning?: string; reasoning_content?: string };
  }[];
  error?: { message?: string };
}

const PER_MODEL_TIMEOUT_MS = 45_000;
const OHLC_CHAR_LIMIT = 60_000;

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

function buildAttempts(): Attempt[] {
  const attempts: Attempt[] = [];
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const openRouterKey = process.env["OPENROUTER_API_KEY"];
  const nvidiaKey = process.env["NVIDIA_API_KEY"];

  if (lovableKey) {
    for (const model of ["google/gemini-2.5-flash", "openai/gpt-5-mini"]) {
      attempts.push({
        provider: "lovable",
        url: "https://ai.gateway.lovable.dev/v1/chat/completions",
        model,
        key: lovableKey,
      });
    }
  }
  if (openRouterKey) {
    for (const model of ["nvidia/nemotron-3-super-120b-a12b:free", "openai/gpt-oss-20b:free"]) {
      attempts.push({
        provider: "openrouter",
        url: "https://openrouter.ai/api/v1/chat/completions",
        model,
        key: openRouterKey,
        headers: {
          "HTTP-Referer": "https://structure-scout.lovable.app",
          "X-Title": "Structure Scout",
        },
      });
    }
  }
  if (nvidiaKey) {
    attempts.push({
      provider: "nvidia",
      url: "https://integrate.api.nvidia.com/v1/chat/completions",
      model: "deepseek-ai/deepseek-r1",
      key: nvidiaKey,
    });
  }
  return attempts;
}

async function callChat(
  attempt: Attempt,
  messages: { role: string; content: string }[],
): Promise<string> {
  const res = await fetch(attempt.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${attempt.key}`,
      "Content-Type": "application/json",
      ...(attempt.headers ?? {}),
    },
    body: JSON.stringify({ model: attempt.model, messages, temperature: 0.2, max_tokens: 3000 }),
    signal: AbortSignal.timeout(PER_MODEL_TIMEOUT_MS),
  });
  const text = await res.text();
  let payload: ChatResponse = {};
  try {
    payload = JSON.parse(text) as ChatResponse;
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) throw new Error(payload.error?.message ?? `${res.status} ${text.slice(0, 200)}`);
  const choice = payload.choices?.[0]?.message;
  const content =
    (choice?.content ?? "").trim() ||
    (choice?.reasoning ?? "").trim() ||
    (choice?.reasoning_content ?? "").trim();
  if (!content) throw new Error("empty response from model");
  return content;
}

export type VerifyEvent =
  | { type: "log"; message: string; tone?: "info" | "warn" | "error" | "success" }
  | { type: "result"; result: VerifyResult }
  | { type: "error"; message: string };

/** Runs the picker, emitting a progress event per stage so the console can narrate it. */
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

  const messages = [
    { role: "system", content: VERIFIER_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];

  const attempts = buildAttempts();
  yield {
    type: "log",
    message: `Picker: prompt built (${Math.round(userContent.length / 1000)}k chars) · ${attempts.length} model(s) queued`,
  };

  if (attempts.length === 0) {
    yield { type: "error", message: "No AI provider key is configured for the picker." };
    return;
  }

  const warnings: string[] = [];
  for (const [i, attempt] of attempts.entries()) {
    yield {
      type: "log",
      message: `Picker: asking ${attempt.provider} · ${attempt.model} (${i + 1}/${attempts.length})…`,
    };
    const started = Date.now();
    try {
      const verdict = await callChat(attempt, messages);
      yield {
        type: "log",
        message: `Picker: ${attempt.model} answered in ${((Date.now() - started) / 1000).toFixed(1)}s`,
        tone: "success",
      };
      yield {
        type: "result",
        result: { verdict, provider: attempt.provider, model: attempt.model, warnings },
      };
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`${attempt.provider} ${attempt.model} failed: ${message}`);
      yield {
        type: "log",
        message: `Picker: ${attempt.model} failed after ${((Date.now() - started) / 1000).toFixed(1)}s — ${message}`,
        tone: "warn",
      };
    }
  }

  yield { type: "error", message: `Picker failed. ${warnings.join(" | ")}` };
}
