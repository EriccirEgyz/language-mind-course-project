import { NextResponse } from "next/server";
import { randomInt, randomUUID } from "crypto";
import { estimateTokens, estimateTokensFromMessages, recordUsage } from "../../../../lib/usage";

const OPENROUTER_URL = "https://openrouter.ai/api/v1";

type RandomChallenge = {
  start: string;
  target: string;
  theme: string;
};

type RandomChallengeResponse = RandomChallenge | { challenges?: RandomChallenge[] };

function cleanNoun(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .slice(0, 30);
}

function parseJsonObject(text: string): RandomChallengeResponse | null {
  const cleanText = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    return JSON.parse(cleanText) as RandomChallengeResponse;
  } catch {
    const match = cleanText.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as RandomChallengeResponse;
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

function normalizeChallenge(value: RandomChallenge | null | undefined): RandomChallenge | null {
  if (!value) return null;

  const start = cleanNoun(value.start);
  const target = cleanNoun(value.target);
  if (!start || !target || start === target) return null;

  return {
    start,
    target,
    theme: String(value.theme ?? "Random nouns").slice(0, 40)
  };
}

function pickChallenge(parsed: RandomChallengeResponse) {
  const candidates = Array.isArray((parsed as { challenges?: unknown }).challenges)
    ? ((parsed as { challenges: RandomChallenge[] }).challenges)
    : [parsed as RandomChallenge];

  const seen = new Set<string>();
  const valid = candidates.flatMap((candidate) => {
    const challenge = normalizeChallenge(candidate);
    if (!challenge) return [];

    const key = `${challenge.start}->${challenge.target}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [challenge];
  });

  if (valid.length === 0) {
    throw new Error("Random challenge generator returned an invalid pair.");
  }

  return valid[randomInt(valid.length)];
}

export async function POST() {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error: "OPENROUTER_API_KEY is not configured",
          message: "The server cannot generate a random challenge without OpenRouter."
        },
        { status: 503 }
      );
    }

    const model = process.env.OPENROUTER_CHAT_MODEL ?? "qwen/qwen-plus-2025-07-28";
    const uniquenessSeed = `${Date.now()}-${randomUUID()}`;
    const messages = [
      {
        role: "system",
        content:
          "You generate varied random challenges for an English noun mind orienteering game. Return strict JSON only."
      },
      {
        role: "user",
        content: [
          "Generate six different mind orienteering challenge candidates.",
          `Uniqueness seed: ${uniquenessSeed}`,
          "",
          "Requirements:",
          "- start and target must each be one common English noun.",
          "- Use lowercase singular nouns.",
          "- No proper nouns.",
          "- No verbs, adjectives, phrases, compounds with spaces, or obscure academic terms.",
          "- The pair should be surprising but plausibly connected.",
          "- Avoid pairs that are too obviously close, such as cat -> dog or apple -> fruit.",
          "- Avoid pairs that are absurdly unrelated.",
          "- Do not use any of these example pairs: apple -> prison, cat -> university, rain -> hospital, music -> law, money -> museum, baby -> internet, school -> happiness, language -> war.",
          "- Use the uniqueness seed to vary the semantic domains each time.",
          "",
          "Return JSON:",
          "{",
          '  "challenges": [',
          '    {',
          '      "start": "one noun",',
          '      "target": "one noun",',
          '      "theme": "2-5 words describing the conceptual bridge"',
          '    }',
          '  ]',
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
        temperature: 1.05,
        top_p: 0.95,
        max_tokens: 700
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`OpenRouter random challenge failed: ${response.status} ${detail}`);
    }

    const result = await response.json();
    const content = getMessageContentText(result?.choices?.[0]?.message?.content);
    await recordUsage("openrouter", {
      inputTokens: result?.usage?.prompt_tokens ?? estimateTokensFromMessages(messages),
      outputTokens: result?.usage?.completion_tokens ?? estimateTokens(content),
      requests: 1
    });

    const parsed = parseJsonObject(content);
    if (!parsed) throw new Error("Random challenge generator did not return valid JSON.");

    const challenge = pickChallenge(parsed);

    return NextResponse.json({
      id: `random-${Date.now()}`,
      start: challenge.start,
      target: challenge.target,
      theme: challenge.theme,
      note: "A randomly generated semantic bridge."
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "random_challenge_failed",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
