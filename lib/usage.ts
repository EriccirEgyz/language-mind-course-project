import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type UsageProvider = "jina" | "openrouter";

type ProviderUsage = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
};

export type UsageSnapshot = {
  updatedAt: string | null;
  providers: Record<UsageProvider, ProviderUsage>;
};

const usagePath = path.join(process.cwd(), "data", "usage.json");

function emptyUsage(): UsageSnapshot {
  return {
    updatedAt: null,
    providers: {
      jina: { requests: 0, inputTokens: 0, outputTokens: 0 },
      openrouter: { requests: 0, inputTokens: 0, outputTokens: 0 }
    }
  };
}

export function estimateTokens(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const cjk = (trimmed.match(/[\u3400-\u9fff]/g) ?? []).length;
  const asciiChunks = trimmed.replace(/[\u3400-\u9fff]/g, " ").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, cjk + Math.ceil(asciiChunks * 1.3));
}

export function estimateTokensFromMessages(messages: Array<{ content: string }>) {
  return messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
}

export async function readUsage(): Promise<UsageSnapshot> {
  try {
    const raw = await readFile(usagePath, "utf8");
    const parsed = JSON.parse(raw) as UsageSnapshot;
    return {
      ...emptyUsage(),
      ...parsed,
      providers: {
        ...emptyUsage().providers,
        ...parsed.providers
      }
    };
  } catch {
    return emptyUsage();
  }
}

export async function recordUsage(
  provider: UsageProvider,
  usage: { inputTokens?: number; outputTokens?: number; requests?: number }
) {
  const snapshot = await readUsage();
  const current = snapshot.providers[provider];

  const next: UsageSnapshot = {
    updatedAt: new Date().toISOString(),
    providers: {
      ...snapshot.providers,
      [provider]: {
        requests: current.requests + (usage.requests ?? 1),
        inputTokens: current.inputTokens + (usage.inputTokens ?? 0),
        outputTokens: current.outputTokens + (usage.outputTokens ?? 0)
      }
    }
  };

  await mkdir(path.dirname(usagePath), { recursive: true });
  await writeFile(usagePath, JSON.stringify(next, null, 2), "utf8");
  return next;
}
