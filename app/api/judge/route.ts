import { NextResponse } from "next/server";
import { estimateTokens, estimateTokensFromMessages, recordUsage } from "../../../lib/usage";

type JudgeRequest = {
  previous: string;
  current: string;
  target: string;
  path?: string[];
};

type RelationJudge = {
  accepted: boolean;
  relationType: string;
  explanation: string;
  estimatedScores?: {
    link: number;
    currentToTarget: number;
    previousToTarget: number;
  };
};

const OPENROUTER_URL = "https://openrouter.ai/api/v1";

function readThreshold(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 && value < 1 ? value : fallback;
}

function cleanWord(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase().slice(0, 30);
}

function cosineSimilarity(a: number[], b: number[]) {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function parseJsonObject(text: string): RelationJudge | null {
  try {
    return JSON.parse(text) as RelationJudge;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as RelationJudge;
    } catch {
      return null;
    }
  }
}

function normalizeScore(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function thresholdRelationType(score: number) {
  return "Other";
}

async function openRouterFetch(path: string, body: unknown) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        error: "OPENROUTER_API_KEY is not configured",
        message: "The server has not configured OPENROUTER_API_KEY, so AI judgment is unavailable."
      },
      { status: 503 }
    );
  }

  const response = await fetch(`${OPENROUTER_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      "X-Title": "Language Mind Course Project"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenRouter ${path} failed: ${response.status} ${detail}`);
  }

  return response.json();
}

async function getEmbeddings(words: string[]) {
  const apiKey = process.env.JINA_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        error: "JINA_API_KEY is not configured",
        message: "The server has not configured JINA_API_KEY, so embedding similarity is unavailable."
      },
      { status: 503 }
    );
  }

  const model = process.env.JINA_EMBEDDING_MODEL ?? "jina-embeddings-v3";
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  const undici = await import("undici");
  const dispatcher = proxyUrl ? new undici.ProxyAgent(proxyUrl) : undefined;
  const response = await undici.fetch("https://api.jina.ai/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: words
    }),
    dispatcher
  });

  if (dispatcher) {
    await dispatcher.close();
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Jina embeddings failed: ${response.status} ${detail}`);
  }

  const result = (await response.json()) as {
    data?: Array<{ embedding: number[] }>;
    usage?: { total_tokens?: number };
  };
  await recordUsage("jina", {
    inputTokens: result.usage?.total_tokens ?? words.reduce((sum, word) => sum + estimateTokens(word), 0),
    requests: 1
  });

  const embeddings = result?.data?.map((item: { embedding: number[] }) => item.embedding);
  if (!Array.isArray(embeddings) || embeddings.length !== words.length) {
    throw new Error("Jina embedding response has an unexpected shape.");
  }

  return embeddings as number[][];
}

async function getOpenRouterEmbeddings(words: string[]) {
  const model = process.env.OPENROUTER_EMBEDDING_MODEL ?? "baai/bge-m3";
  const result = await openRouterFetch("/embeddings", {
    model,
    input: words
  });

  if (result instanceof NextResponse) return result;

  const embeddings = result?.data?.map((item: { embedding: number[] }) => item.embedding);
  if (!Array.isArray(embeddings) || embeddings.length !== words.length) {
    throw new Error("OpenRouter embedding response has an unexpected shape.");
  }

  return embeddings as number[][];
}

async function judgeWithLlm(input: {
  previous: string;
  current: string;
  target: string;
  path: string[];
  linkScore: number | null;
  targetScore: number | null;
  previousTargetScore: number | null;
  progressDelta: number | null;
  scoreSource: "embedding" | "llm_estimate";
}) {
  const model = process.env.OPENROUTER_CHAT_MODEL ?? "qwen/qwen-plus-2025-07-28";
  const messages = [
    {
      role: "system",
      content:
        "You classify accepted links in a Language and Mind semantic maze. The game asks players to use English nouns, but your job here is only to classify the semantic relation and explain it. Output strict JSON in English."
    },
    {
      role: "user",
      content: [
        `Game path: ${input.path.join(" -> ")}`,
        `Previous word: ${input.previous}`,
        `Player input: ${input.current}`,
        `Target word: ${input.target}`,
        `Score source: ${input.scoreSource}`,
        `Embedding link score from previous to current: ${
          input.linkScore === null ? "unavailable" : input.linkScore.toFixed(3)
        }`,
        `Embedding current-to-target score: ${
          input.targetScore === null ? "unavailable" : input.targetScore.toFixed(3)
        }`,
        `Embedding previous-to-target score: ${
          input.previousTargetScore === null ? "unavailable" : input.previousTargetScore.toFixed(3)
        }`,
        `Progress delta: ${input.progressDelta === null ? "unavailable" : input.progressDelta.toFixed(3)}`,
        "",
        "Return JSON with this shape:",
        "{",
        '  "accepted": boolean,',
        '  "relationType": "Taxonomic | Coordinate | Part-whole | Functional | Thematic | Causal | Contrast | World-knowledge | Other",',
        '  "explanation": "one concise English sentence",',
        '  "estimatedScores": {',
        '    "link": number from 0 to 1 for the naturalness of previous -> current,',
        '    "currentToTarget": number from 0 to 1 for current -> target closeness,',
        '    "previousToTarget": number from 0 to 1 for previous -> target closeness',
        "  }",
        "}",
        "",
        "Rules:",
        "- This link has already been accepted by an embedding threshold.",
        "- Keep accepted=true in your JSON.",
        "- Your task is only relation classification and explanation.",
        "",
        "Relation type guide:",
        "- Taxonomic: subtype or supertype relation, e.g. apple -> fruit, cat -> animal.",
        "- Coordinate: same-category peers, e.g. cat -> dog, apple -> pear.",
        "- Part-whole: part/whole relation, e.g. wheel -> car, leaf -> tree.",
        "- Functional: use, purpose, tool, or affordance, e.g. key -> door, knife -> food.",
        "- Thematic: same event, setting, or role frame, e.g. doctor -> hospital, rain -> umbrella.",
        "- Causal: cause, result, or consequence, e.g. crime -> prison, rain -> flood.",
        "- Contrast: opposition or strong contrast, e.g. war -> peace, prison -> freedom.",
        "- World-knowledge: cultural, historical, institutional, or encyclopedic knowledge, e.g. music -> copyright.",
        "- Other: use only when none of the above fits."
      ].join("\n")
    }
  ];
  const result = await openRouterFetch("/chat/completions", {
    model,
    response_format: { type: "json_object" },
    messages,
    temperature: 0.2,
    max_tokens: 500
  });

  if (result instanceof NextResponse) return result;

  const content = result?.choices?.[0]?.message?.content;
  await recordUsage("openrouter", {
    inputTokens: result?.usage?.prompt_tokens ?? estimateTokensFromMessages(messages),
    outputTokens: result?.usage?.completion_tokens ?? estimateTokens(String(content ?? "")),
    requests: 1
  });
  const parsed = parseJsonObject(String(content ?? ""));
  if (!parsed) throw new Error("LLM judge did not return valid JSON.");

  return parsed;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as JudgeRequest;
    const previous = cleanWord(payload.previous);
    const current = cleanWord(payload.current);
    const target = cleanWord(payload.target);
    const path = Array.isArray(payload.path) ? payload.path.map(cleanWord).filter(Boolean) : [previous];
    const useEmbeddings = process.env.OPENROUTER_USE_EMBEDDINGS === "true";

    if (!previous || !current || !target) {
      return NextResponse.json(
        { error: "previous, current and target are required." },
        { status: 400 }
      );
    }

    let linkScore: number | null = null;
    let currentToTarget: number | null = null;
    let previousToTarget: number | null = null;
    let progressDelta: number | null = null;

    if (useEmbeddings) {
      const embeddings = process.env.JINA_API_KEY
        ? await getEmbeddings([previous, current, target])
        : await getOpenRouterEmbeddings([previous, current, target]);
      if (embeddings instanceof NextResponse) return embeddings;

      const [previousVector, currentVector, targetVector] = embeddings;
      linkScore = cosineSimilarity(previousVector, currentVector);
      currentToTarget = cosineSimilarity(currentVector, targetVector);
      previousToTarget = cosineSimilarity(previousVector, targetVector);
      progressDelta = currentToTarget - previousToTarget;
    }

    const linkThreshold = readThreshold("SEMANTIC_LINK_THRESHOLD", 0.6);
    let llmJudge: RelationJudge | null = null;
    if (linkScore !== null && linkScore >= linkThreshold) {
      const judged = await judgeWithLlm({
        previous,
        current,
        target,
        path: [...path, current],
        linkScore,
        targetScore: currentToTarget,
        previousTargetScore: previousToTarget,
        progressDelta,
        scoreSource: useEmbeddings ? "embedding" : "llm_estimate"
      });
      if (judged instanceof NextResponse) return judged;
      llmJudge = judged;
    }

    const estimated = llmJudge?.estimatedScores;
    const safeLink = linkScore ?? normalizeScore(estimated?.link);
    const safeCurrentToTarget = currentToTarget ?? normalizeScore(estimated?.currentToTarget);
    const safePreviousToTarget = previousToTarget ?? normalizeScore(estimated?.previousToTarget);
    const safeProgressDelta = progressDelta ?? safeCurrentToTarget - safePreviousToTarget;
    const isFirstMoveToTarget = path.length === 1 && current === target;
    const rawAccepted = safeLink >= linkThreshold;
    const directTargetTooLoose = isFirstMoveToTarget && safeLink < linkThreshold;
    const accepted = directTargetTooLoose ? false : rawAccepted;
    const relationType = directTargetTooLoose
      ? "Direct target jump"
      : llmJudge?.relationType ?? thresholdRelationType(safeLink);
    const explanation = directTargetTooLoose
      ? "This jumps directly to the target, but the relation needs an extra event or context. The maze rewards a more natural intermediate noun."
      : (llmJudge?.explanation ??
        (accepted
          ? `The link score is ${safeLink.toFixed(3)}, so this is accepted as a natural association.`
          : `The link score is ${safeLink.toFixed(3)}, below the ${linkThreshold.toFixed(2)} threshold for a natural step.`));
    return NextResponse.json({
      ...(llmJudge ?? {}),
      failureType: accepted ? null : "semantic_rejection",
      accepted,
      strength: accepted ? "medium" : "broken",
      decision: accepted ? "accepted" : "rejected",
      relationType,
      explanation,
      scores: {
        link: Number(safeLink.toFixed(3)),
        currentToTarget: Number(safeCurrentToTarget.toFixed(3)),
        previousToTarget: Number(safePreviousToTarget.toFixed(3)),
        progressDelta: Number(safeProgressDelta.toFixed(3)),
        source: useEmbeddings ? "embedding" : "llm_estimate"
      },
      models: {
        embedding: useEmbeddings
          ? (process.env.JINA_API_KEY
              ? (process.env.JINA_EMBEDDING_MODEL ?? "jina-embeddings-v3")
              : (process.env.OPENROUTER_EMBEDDING_MODEL ?? "baai/bge-m3"))
          : null,
        embeddingProvider: useEmbeddings ? (process.env.JINA_API_KEY ? "jina" : "openrouter") : null,
        chat: process.env.OPENROUTER_CHAT_MODEL ?? "qwen/qwen-plus-2025-07-28"
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "judge_failed",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
