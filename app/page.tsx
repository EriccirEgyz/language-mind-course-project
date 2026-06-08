"use client";

import { FormEvent, useState } from "react";

type Challenge = {
  id: string;
  start: string;
  target: string;
  theme: string;
  note: string;
};

type StepResult = {
  from: string;
  to: string;
  accepted: boolean;
  failureType?: "semantic_rejection" | null;
  strength: "strong" | "medium" | "weak" | "broken";
  relationType: string;
  explanation: string;
  scores: {
    link: number;
    currentToTarget: number;
    previousToTarget: number;
    progressDelta: number;
    source: "embedding" | "llm_estimate";
  };
};

const challenges: Challenge[] = [
  {
    id: "apple-prison",
    start: "apple",
    target: "prison",
    theme: "Object to institution",
    note: "Build a natural bridge between a concrete object and a social institution."
  },
  {
    id: "cat-university",
    start: "cat",
    target: "university",
    theme: "Animal to institution",
    note: "Build a natural bridge between an animal and an educational institution."
  },
  {
    id: "rain-hospital",
    start: "rain",
    target: "hospital",
    theme: "Weather to institution",
    note: "Build a natural bridge between weather and a medical institution."
  },
  {
    id: "music-law",
    start: "music",
    target: "law",
    theme: "Art to institution",
    note: "Build a natural bridge between art and a social institution."
  },
  {
    id: "money-museum",
    start: "money",
    target: "museum",
    theme: "Economy to culture",
    note: "Build a natural bridge between economy and culture."
  },
  {
    id: "baby-internet",
    start: "baby",
    target: "internet",
    theme: "Development to technology",
    note: "Build a natural bridge between development and technology."
  },
  {
    id: "school-happiness",
    start: "school",
    target: "happiness",
    theme: "Institution to emotion",
    note: "Build a natural bridge between an institution and an emotion."
  },
  {
    id: "language-war",
    start: "language",
    target: "war",
    theme: "Communication to conflict",
    note: "Build a natural bridge between communication and conflict."
  }
];

const strengthLabel = {
  strong: "Accepted",
  medium: "Accepted",
  weak: "Rejected",
  broken: "Rejected"
};

function normalizeInput(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export default function Home() {
  const [challenge, setChallenge] = useState<Challenge>(challenges[0]);
  const [customStart, setCustomStart] = useState("");
  const [customTarget, setCustomTarget] = useState("");
  const [path, setPath] = useState<string[]>([challenge.start]);
  const [input, setInput] = useState("");
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [latestFeedback, setLatestFeedback] = useState<StepResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);

  const currentWord = path[path.length - 1];
  const averageLink =
    steps.length === 0
      ? 0
      : steps.reduce((sum, step) => sum + step.scores.link, 0) / steps.length;

  function reset(nextChallenge = challenge) {
    setPath([nextChallenge.start]);
    setInput("");
    setSteps([]);
    setLatestFeedback(null);
    setError("");
    setCompleted(false);
  }

  function selectChallenge(nextId: string) {
    const next = challenges.find((item) => item.id === nextId) ?? challenges[0];
    setChallenge(next);
    reset(next);
  }

  async function randomChallenge() {
    if (isGenerating) return;
    setIsGenerating(true);
    setError("");

    try {
      const response = await fetch("/api/challenge/random", { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.message ?? data?.error ?? "Random challenge failed");
      }

      const next = data as Challenge;
      setChallenge(next);
      reset(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Random challenge failed");
    } finally {
      setIsGenerating(false);
    }
  }

  function startCustomChallenge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const start = normalizeInput(customStart);
    const target = normalizeInput(customTarget);
    if (!start || !target) return;

    const next = {
      id: `custom-${Date.now()}`,
      start,
      target,
      theme: "Custom nouns",
      note: "A custom semantic bridge."
    };
    setChallenge(next);
    reset(next);
  }

  async function submitStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const word = normalizeInput(input);
    if (!word || isLoading || completed) return;

    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          previous: currentWord,
          current: word,
          target: challenge.target,
          path
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message ?? data?.error ?? "AI judgment failed");
      }

      const step: StepResult = {
        from: currentWord,
        to: word,
        accepted: data.accepted,
        failureType: data.failureType,
        strength: data.strength,
        relationType: data.relationType,
        explanation: data.explanation,
        scores: data.scores
      };

      setLatestFeedback(step);
      if (data.accepted) {
        setSteps((items) => [...items, step]);
        setPath((items) => [...items, word]);
        setInput("");
        if (word === challenge.target) setCompleted(true);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "AI judgment failed");
    } finally {
      setIsLoading(false);
    }
  }

  const lastAcceptedStep = steps[steps.length - 1];

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Language and Mind Creative Project</p>
          <h1>Semantic Maze</h1>
          <p className="subtitle">
            A word-association experiment about the mental lexicon, semantic networks, and spreading activation.
          </p>
        </div>
        <div className="concepts" aria-label="course concepts">
          <span>Lexicon</span>
          <span>Semantic Network</span>
          <span>Spreading Activation</span>
          <span>Meaning in Context</span>
        </div>
      </section>

      <section className="workspace">
        <aside className="panel challenge-panel">
          <h2>Challenges</h2>
          <div className="challenge-tools">
            <button className="tool-button" disabled={isGenerating} type="button" onClick={randomChallenge}>
              {isGenerating ? "Generating" : "Random Challenge"}
            </button>
            <form className="custom-form" onSubmit={startCustomChallenge}>
              <label htmlFor="custom-start">Custom Challenge</label>
              <input
                id="custom-start"
                maxLength={30}
                onChange={(event) => setCustomStart(event.target.value)}
                placeholder="Start noun"
                value={customStart}
              />
              <input
                id="custom-target"
                maxLength={30}
                onChange={(event) => setCustomTarget(event.target.value)}
                placeholder="Target noun"
                value={customTarget}
              />
              <button disabled={!customStart.trim() || !customTarget.trim()} type="submit">
                Start
              </button>
              <small>Enter English nouns.</small>
            </form>
          </div>
          <div className="challenge-list">
            {challenges.map((item) => (
              <button
                className={item.id === challenge.id ? "challenge active" : "challenge"}
                key={item.id}
                onClick={() => selectChallenge(item.id)}
                type="button"
              >
                <span>
                  {item.start} {"->"} {item.target}
                </span>
                <small>{item.theme}</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="panel game-panel">
          <div className="game-header">
            <div>
              <p className="label">Current Challenge</p>
              <h2>
                {challenge.start} <span>{"->"}</span> {challenge.target}
              </h2>
            </div>
            <button className="ghost-button" type="button" onClick={() => reset()}>
              Restart
            </button>
          </div>

          <p className="note">{challenge.note}</p>
          <p className="rule-note">Use English nouns for the maze.</p>

          <div className="path" aria-label="current path">
            {path.map((word, index) => (
              <div className="path-item" key={`${word}-${index}`}>
                <span className={word === challenge.target ? "node target" : "node"}>
                  {word}
                </span>
                {index < path.length - 1 && <span className="arrow">{"->"}</span>}
              </div>
            ))}
          </div>

          {!completed ? (
            <form className="input-row" onSubmit={submitStep}>
              <label htmlFor="next-word">
                From <strong>{currentWord}</strong> to
              </label>
              <input
                autoComplete="off"
                id="next-word"
                maxLength={30}
                onChange={(event) => setInput(event.target.value)}
                placeholder={`Target: ${challenge.target}`}
                value={input}
              />
              <button disabled={isLoading || !input.trim()} type="submit">
                {isLoading ? "Judging" : "Submit"}
              </button>
            </form>
          ) : (
            <div className="complete-box">
              <strong>Challenge Complete</strong>
              <span>
                You reached the target in {path.length - 1} step
                {path.length - 1 === 1 ? "" : "s"}.
              </span>
            </div>
          )}

          {error && <p className="error">{error}</p>}

          {latestFeedback && (
            <article className={`feedback ${latestFeedback.strength}`}>
              <div>
                <p className="label">
                  {latestFeedback.accepted ? "Latest Accepted Step" : "Link Rejected"}
                </p>
                <h3>
                  {latestFeedback.from} {"->"} {latestFeedback.to}
                </h3>
              </div>
              <div className="feedback-grid">
                <div>
                  <span>Judgment</span>
                  <strong>{latestFeedback.accepted ? "Accepted" : "Rejected"}</strong>
                </div>
                <div>
                  <span>Relation</span>
                  <strong>{latestFeedback.relationType}</strong>
                </div>
                <div>
                  <span>Link score</span>
                  <strong>{latestFeedback.scores.link.toFixed(3)}</strong>
                </div>
                <div>
                  <span>Target score</span>
                  <strong>{latestFeedback.scores.currentToTarget.toFixed(3)}</strong>
                </div>
              </div>
              <p className="score-source">
                Score source:{" "}
                {latestFeedback.scores.source === "embedding"
                  ? "Jina embedding cosine similarity"
                  : "LLM estimate"}
              </p>
              <p>{latestFeedback.explanation}</p>
            </article>
          )}
        </section>

        <aside className="panel analysis-panel">
          <h2>Trial Log</h2>
          <div className="metric">
            <span>Path length</span>
            <strong>{Math.max(path.length - 1, 0)}</strong>
          </div>
          <div className="metric">
            <span>Average link score</span>
            <strong>{averageLink ? averageLink.toFixed(3) : "-"}</strong>
          </div>
          <div className="metric">
            <span>Current to target</span>
            <strong>{lastAcceptedStep ? lastAcceptedStep.scores.currentToTarget.toFixed(3) : "-"}</strong>
          </div>

          <div className="step-list">
            {steps.length === 0 ? (
              <p className="empty">Accepted associations will appear here. Rejected inputs are shown only as feedback.</p>
            ) : (
              steps.map((step, index) => (
                <div className="step-card" key={`${step.from}-${step.to}-${index}`}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>
                      {step.from} {"->"} {step.to}
                    </strong>
                    <small>Accepted / {step.relationType}</small>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}
