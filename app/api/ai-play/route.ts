import { NextResponse } from "next/server";
import { estimateTokens, estimateTokensFromMessages, recordUsage } from "../../../lib/usage";

type AiPlayRequest = {
  start: string;
  target: string;
  path?: string[];
  rejectedMoves?: RejectedMove[];
};

type AiMove = {
  nextWord: string;
  rationale: string;
};

type RejectedMove = {
  from: string;
  to: string;
  linkScore?: number;
  targetScore?: number;
  explanation?: string;
};

const OPENROUTER_URL = "https://openrouter.ai/api/v1";

function cleanWord(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .slice(0, 30);
}

function normalizeRejectedMove(value: RejectedMove, current: string): RejectedMove | null {
  const from = cleanWord(value.from);
  const to = cleanWord(value.to);
  if (!from || !to || from !== current) return null;

  return {
    from,
    to,
    linkScore: Number.isFinite(Number(value.linkScore)) ? Number(value.linkScore) : undefined,
    targetScore: Number.isFinite(Number(value.targetScore)) ? Number(value.targetScore) : undefined,
    explanation: String(value.explanation ?? "").slice(0, 120)
  };
}

function parseJsonObject(text: string): AiMove | null {
  const cleanText = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    return JSON.parse(cleanText) as AiMove;
  } catch {
    const match = cleanText.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as AiMove;
    } catch {
      return null;
    }
  }
}

function getMessageContentText(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        return String((part as { text?: unknown }).text ?? "");
      }
      return "";
    })
    .join("");
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error: "OPENROUTER_API_KEY is not configured",
          message: "The server cannot let AI play without OpenRouter."
        },
        { status: 503 }
      );
    }

    const payload = (await request.json()) as AiPlayRequest;
    const start = cleanWord(payload.start);
    const target = cleanWord(payload.target);
    const path = Array.isArray(payload.path) ? payload.path.map(cleanWord).filter(Boolean) : [start];
    const current = path[path.length - 1] ?? start;
    const rejectedMoves = Array.isArray(payload.rejectedMoves)
      ? payload.rejectedMoves
          .map((move) => normalizeRejectedMove(move, current))
          .filter((move): move is RejectedMove => Boolean(move))
          .slice(-8)
      : [];

    if (!start || !target || !current) {
      return NextResponse.json(
        { error: "start, target and path are required." },
        { status: 400 }
      );
    }

    if (current === target) {
      return NextResponse.json(
        { error: "challenge_complete", message: "The current path already reached the target." },
        { status: 400 }
      );
    }

    const model = process.env.OPENROUTER_CHAT_MODEL ?? "qwen/qwen-plus-2025-07-28";
    const rejectedMoveText =
      rejectedMoves.length === 0
        ? "None."
        : rejectedMoves
            .map((move) => {
              const linkScore =
                typeof move.linkScore === "number" ? `, link score ${move.linkScore.toFixed(3)}` : "";
              const targetScore =
                typeof move.targetScore === "number" ? `, target score ${move.targetScore.toFixed(3)}` : "";
              const explanation = move.explanation ? `, reason: ${move.explanation}` : "";
              return `- ${move.from} -> ${move.to}${linkScore}${targetScore}${explanation}`;
            })
            .join("\n");
    const messages = [
      {
        role: "system",
        content:
          "You are an AI player in an English noun mind orienteering game. Reach the target in as few steps as possible while keeping every step semantically natural. Output strict JSON only."
      },
      {
        role: "user",
        content: [
          `Start noun: ${start}`,
          `Target noun: ${target}`,
          `Current path: ${path.join(" -> ")}`,
          `Current noun: ${current}`,
          "",
          "Rejected moves from this same current noun:",
          rejectedMoveText,
          "",
          "Choose the next move.",
          "",
          "Goal:",
          "- Reach the target noun in the fewest reasonable steps.",
          "- If the target is a natural next noun from the current noun, choose the target now.",
          "- Do not add extra intermediate nouns just to be cautious.",
          "",
          "Rules:",
          "- Return one common English singular noun.",
          "- Use lowercase letters only.",
          "- No spaces, compounds, proper nouns, verbs, adjectives, or obscure academic terms.",
          "- The next noun must be naturally associated with the current noun.",
          "- The next noun should move closer to the target or be the target.",
          "- Do not repeat a noun already in the path.",
          "- Do not repeat any rejected move listed above.",
          "- If a rejected move looked intuitively reasonable, choose a different noun with a stronger direct association under the game judge.",
          "- Prefer concrete, judgeable semantic links over clever wordplay.",
          "",
          "Good target moves include student -> university, doctor -> hospital, crime -> prison, teacher -> school.",
          "",
          "Return JSON with this exact shape:",
          "{",
          '  "nextWord": "one noun",',
          '  "rationale": "one concise English sentence explaining the semantic move"',
          "}"
        ].join("\n")
      }
    ];

    const response = await fetch(`${OPENROUTER_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        "X-Title": "Language Mind Course Project"
      },
      cache: "no-store",
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages,
        temperature: 0.65,
        max_tokens: 300
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`OpenRouter AI player failed: ${response.status} ${detail}`);
    }

    const result = await response.json();
    const content = getMessageContentText(result?.choices?.[0]?.message?.content);
    await recordUsage("openrouter", {
      inputTokens: result?.usage?.prompt_tokens ?? estimateTokensFromMessages(messages),
      outputTokens: result?.usage?.completion_tokens ?? estimateTokens(content),
      requests: 1
    });

    const parsed = parseJsonObject(content);
    if (!parsed) throw new Error("AI player did not return valid JSON.");

    const nextWord = cleanWord(parsed.nextWord);
    if (!nextWord) throw new Error("AI player returned an invalid noun.");
    if (path.includes(nextWord)) throw new Error("AI player repeated a noun already in the path.");

    return NextResponse.json({
      nextWord,
      rationale: String(parsed.rationale ?? "AI selected a plausible semantic bridge.").slice(0, 180),
      model
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "ai_play_failed",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
