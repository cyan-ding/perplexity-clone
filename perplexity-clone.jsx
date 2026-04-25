import React, { useState, useRef, useEffect } from "react";
import {
  Search,
  Telescope,
  Settings,
  Key,
  Loader2,
  Copy,
  Check,
  X,
  Sparkles,
  BookOpen,
  Zap,
  Brain,
  ChevronDown,
  AlertCircle,
  MessageSquare,
  Trash2,
} from "lucide-react";

// Perplexity API model catalog with pricing for cost estimation
const MODELS = {
  sonar: {
    id: "sonar",
    label: "Sonar",
    blurb: "Fast, cheap. Everyday questions.",
    icon: Zap,
    supportsContext: true,
    inputPer1M: 1,
    outputPer1M: 1,
    requestPer1K: { low: 5, medium: 8, high: 12 },
  },
  "sonar-pro": {
    id: "sonar-pro",
    label: "Sonar Pro",
    blurb: "Better answers, more sources.",
    icon: Sparkles,
    supportsContext: true,
    inputPer1M: 3,
    outputPer1M: 15,
    requestPer1K: { low: 6, medium: 10, high: 14 },
  },
  "sonar-reasoning-pro": {
    id: "sonar-reasoning-pro",
    label: "Reasoning Pro",
    blurb: "Multi-step reasoning. Shows work.",
    icon: Brain,
    supportsContext: true,
    inputPer1M: 2,
    outputPer1M: 8,
    requestPer1K: { low: 6, medium: 10, high: 14 },
  },
  "sonar-deep-research": {
    id: "sonar-deep-research",
    label: "Deep Research",
    blurb: "Long, exhaustive reports. Slow + costly.",
    icon: Telescope,
    supportsContext: false,
    inputPer1M: 2,
    outputPer1M: 8,
    citationPer1M: 2,
    reasoningPer1M: 3,
    searchPer1K: 5,
  },
};

// Compute cost from a usage object returned by the API. Falls back to client-side
// estimate using token counts so we can show something reasonable even when the API
// doesn't include the cost block.
function computeCost(modelId, usage, contextSize) {
  if (!usage) return 0;
  if (usage.cost && typeof usage.cost.total_cost === "number") {
    return usage.cost.total_cost;
  }
  const m = MODELS[modelId];
  if (!m) return 0;
  const inTok = usage.prompt_tokens || 0;
  const outTok = usage.completion_tokens || 0;
  let cost = (inTok / 1_000_000) * m.inputPer1M + (outTok / 1_000_000) * m.outputPer1M;
  if (m.requestPer1K) {
    cost += m.requestPer1K[contextSize] / 1000;
  }
  if (modelId === "sonar-deep-research") {
    const cit = usage.citation_tokens || 0;
    const reason = usage.reasoning_tokens || 0;
    const queries = usage.num_search_queries || 0;
    cost += (cit / 1_000_000) * (m.citationPer1M || 0);
    cost += (reason / 1_000_000) * (m.reasoningPer1M || 0);
    cost += (queries / 1000) * (m.searchPer1K || 0);
  }
  return cost;
}

// Lightweight markdown -> HTML. Handles the bits Perplexity actually returns:
// **bold**, *italic*, `code`, [n] citation refs, ## headers, lists, paragraphs.
// Citation refs like [1] become superscript anchors that scroll to the source list.
function renderMarkdown(text) {
  if (!text) return "";
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks
  html = html.replace(/```([\s\S]*?)```/g, (_, code) => {
    return `<pre class="bg-stone-900 text-stone-100 p-4 my-3 overflow-x-auto text-[13px] leading-relaxed" style="font-family: 'JetBrains Mono', monospace;">${code.trim()}</pre>`;
  });

  // Inline code
  html = html.replace(
    /`([^`]+)`/g,
    `<code class="bg-stone-200/60 px-1.5 py-0.5 text-[0.9em]" style="font-family: 'JetBrains Mono', monospace;">$1</code>`
  );

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3 class="text-lg mt-5 mb-2" style="font-family: \'Fraunces\', serif; font-weight: 600;">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-xl mt-6 mb-3" style="font-family: \'Fraunces\', serif; font-weight: 600;">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="text-2xl mt-6 mb-3" style="font-family: \'Fraunces\', serif; font-weight: 700;">$1</h1>');

  // Bold / italic
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");

  // Citation refs [1] [2,3]
  html = html.replace(/\[(\d+(?:,\s*\d+)*)\]/g, (_, nums) => {
    const list = nums.split(",").map((n) => n.trim());
    return list
      .map(
        (n) =>
          `<a href="#cite-${n}" class="inline-block align-super text-[10px] ml-0.5 px-1.5 py-0.5 bg-amber-100 text-stone-800 hover:bg-amber-200 transition-colors no-underline" style="font-family: 'JetBrains Mono', monospace;">${n}</a>`
      )
      .join("");
  });

  // Lists
  html = html.replace(/^[\-\*] (.+)$/gm, '<li class="ml-5 list-disc my-1">$1</li>');
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="ml-5 list-decimal my-1">$1</li>');
  html = html.replace(/(<li[^>]*>.*?<\/li>(\s*<li[^>]*>.*?<\/li>)+)/gs, '<ul class="my-2">$1</ul>');

  // Paragraphs (split on double newline, leave block elements alone)
  const blocks = html.split(/\n\n+/);
  html = blocks
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (/^<(h\d|ul|ol|li|pre|blockquote)/.test(trimmed)) return trimmed;
      return `<p class="my-3 leading-[1.7]">${trimmed.replace(/\n/g, "<br/>")}</p>`;
    })
    .join("\n");

  return html;
}

// Strip <think>...</think> blocks (returned by reasoning models) and return
// { thinking, answer } so we can show them separately.
function splitThinking(text) {
  if (!text) return { thinking: "", answer: "" };
  const m = text.match(/<think>([\s\S]*?)<\/think>([\s\S]*)/);
  if (m) return { thinking: m[1].trim(), answer: m[2].trim() };
  return { thinking: "", answer: text };
}

function ThinkingBlock({ content }) {
  const [open, setOpen] = useState(false);
  if (!content) return null;
  return (
    <div className="my-4 border-l-2 border-stone-300">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 text-[11px] tracking-[0.15em] uppercase text-stone-500 hover:text-stone-800"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        <Brain className="w-3 h-3" />
        Reasoning
        <ChevronDown
          className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          className="px-3 pb-3 text-[13px] text-stone-600 leading-relaxed whitespace-pre-wrap"
          style={{ fontFamily: "'Fraunces', serif" }}
        >
          {content}
        </div>
      )}
    </div>
  );
}

function getElectronBridge() {
  if (typeof window === "undefined") return null;
  return window.perplexity?.streamChat ? window.perplexity : null;
}

const INQUIRY_CHATS_KEY = "inquiry-chats-v1";

function newThreadId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function mapActiveChats(state, mapThread) {
  return {
    ...state,
    threads: state.threads.map((t) => (t.id === state.activeThreadId ? mapThread(t) : t)),
  };
}

function titleFromQuery(q) {
  const one = (q || "").replace(/\s+/g, " ").trim();
  if (!one) return "New chat";
  return one.length > 64 ? one.slice(0, 62) + "…" : one;
}

function formatChatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (now - d < 6 * 24 * 60 * 60 * 1000) {
    return d.toLocaleDateString(undefined, { weekday: "short" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function createInitialChats(lifetimeTotalSpent = 0) {
  const id = newThreadId();
  return {
    version: 2,
    lifetimeTotalSpent,
    activeThreadId: id,
    threads: [
      {
        id,
        title: "New chat",
        updatedAt: Date.now(),
        model: "sonar",
        contextSize: "medium",
        totalCost: 0,
        messages: [],
      },
    ],
  };
}

function normalizeChats(data) {
  if (!data || !Array.isArray(data.threads)) return null;
  if (data.version != null && data.version !== 1 && data.version !== 2) return null;
  const threads = data.threads
    .filter((t) => t && typeof t.id === "string" && Array.isArray(t.messages))
    .map((t) => ({
      id: t.id,
      title: typeof t.title === "string" ? t.title : "Chat",
      updatedAt: typeof t.updatedAt === "number" ? t.updatedAt : Date.now(),
      model: MODELS[t.model] ? t.model : "sonar",
      contextSize: ["low", "medium", "high"].includes(t.contextSize) ? t.contextSize : "medium",
      totalCost: typeof t.totalCost === "number" ? t.totalCost : 0,
      messages: t.messages,
    }));
  if (!threads.length) return null;
  const active =
    data.activeThreadId && threads.some((x) => x.id === data.activeThreadId)
      ? data.activeThreadId
      : threads[0].id;

  const fromThreads = threads.reduce((sum, t) => sum + (t.totalCost || 0), 0);
  const lifetime =
    typeof data.lifetimeTotalSpent === "number" && !Number.isNaN(data.lifetimeTotalSpent)
      ? data.lifetimeTotalSpent
      : fromThreads;

  return { version: 2, lifetimeTotalSpent: lifetime, activeThreadId: active, threads };
}

async function readPersistedChats() {
  if (typeof window === "undefined") return null;
  if (window.inquiry?.loadChats) {
    return await window.inquiry.loadChats();
  }
  try {
    const r = localStorage.getItem(INQUIRY_CHATS_KEY);
    return r ? JSON.parse(r) : null;
  } catch {
    return null;
  }
}

async function writePersistedChats(data) {
  if (typeof window === "undefined") return;
  if (window.inquiry?.saveChats) {
    await window.inquiry.saveChats(data);
    return;
  }
  try {
    localStorage.setItem(INQUIRY_CHATS_KEY, JSON.stringify(data));
  } catch {
    // quota / private mode
  }
}

function SourceCard({ source, index }) {
  const url = source.url || source;
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    host = url;
  }
  const title = source.title || host;
  return (
    <a
      id={`cite-${index + 1}`}
      href={url}
      target="_blank"
      rel="noreferrer"
      className="block group p-3 bg-stone-50 hover:bg-amber-50 border border-stone-200 hover:border-amber-300 transition-all"
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-stone-800"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          {index + 1}
        </span>
        <span
          className="text-[10px] text-stone-500 truncate"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          {host}
        </span>
      </div>
      <div
        className="text-[13px] text-stone-800 group-hover:text-stone-950 line-clamp-2 leading-snug"
        style={{ fontFamily: "'Fraunces', serif" }}
      >
        {title}
      </div>
      {source.snippet && (
        <div className="text-[11px] text-stone-500 mt-1 line-clamp-2 leading-snug">
          {source.snippet}
        </div>
      )}
    </a>
  );
}

function MessageBlock({ msg, onAskFollowUp }) {
  const [copied, setCopied] = useState(false);

  if (msg.role === "user") {
    return (
      <div className="my-8">
        <div className="text-[10px] tracking-[0.2em] text-stone-400 uppercase mb-2"
             style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          Query
        </div>
        <h2
          className="text-2xl md:text-3xl text-stone-900 leading-tight"
          style={{ fontFamily: "'Fraunces', serif", fontWeight: 500 }}
        >
          {msg.content}
        </h2>
      </div>
    );
  }

  const { thinking, answer } = splitThinking(msg.content);
  const sources = msg.sources || [];
  const related = msg.related || [];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(answer);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="mb-12">
      {msg.error ? (
        <div className="bg-red-50 border border-red-200 p-4 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
          <div>
            <div className="text-[11px] tracking-[0.15em] uppercase text-red-700 mb-1"
                 style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              Error
            </div>
            <div className="text-sm text-red-900">{msg.error}</div>
          </div>
        </div>
      ) : (
        <>
          {/* Sources first - editorial style */}
          {sources.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <BookOpen className="w-3 h-3 text-stone-500" />
                <span
                  className="text-[10px] tracking-[0.2em] uppercase text-stone-500"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                >
                  {sources.length} {sources.length === 1 ? "source" : "sources"}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {sources.slice(0, 6).map((s, i) => (
                  <SourceCard key={i} source={s} index={i} />
                ))}
              </div>
              {sources.length > 6 && (
                <details className="mt-2">
                  <summary
                    className="text-[11px] text-stone-500 cursor-pointer hover:text-stone-800"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    + {sources.length - 6} more sources
                  </summary>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
                    {sources.slice(6).map((s, i) => (
                      <SourceCard key={i + 6} source={s} index={i + 6} />
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {thinking && <ThinkingBlock content={thinking} />}

          {/* Answer */}
          <div className="flex items-center gap-2 mb-3">
            <span
              className="text-[10px] tracking-[0.2em] uppercase text-stone-500"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              Answer
            </span>
            <div className="flex-1 border-t border-stone-200" />
            <button
              onClick={copy}
              className="text-stone-400 hover:text-stone-800 transition-colors p-1"
              title="Copy"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>
          <div
            className="text-stone-800 text-[16px]"
            style={{ fontFamily: "'Fraunces', serif" }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(answer) }}
          />

          {msg.streaming && (
            <span className="inline-block w-2 h-5 bg-stone-800 ml-1 animate-pulse" />
          )}

          {/* Meta footer: cost + tokens */}
          {msg.usage && !msg.streaming && (
            <div
              className="mt-6 pt-3 border-t border-stone-200 flex flex-wrap gap-x-5 gap-y-1 text-[10px] tracking-[0.1em] uppercase text-stone-500"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              <span>Model · {msg.modelLabel}</span>
              <span>In · {msg.usage.prompt_tokens} tok</span>
              <span>Out · {msg.usage.completion_tokens} tok</span>
              {typeof msg.cost === "number" && (
                <span className="text-amber-700">Cost · ${msg.cost.toFixed(4)}</span>
              )}
            </div>
          )}

          {/* Related questions */}
          {related.length > 0 && !msg.streaming && (
            <div className="mt-6">
              <div
                className="text-[10px] tracking-[0.2em] uppercase text-stone-500 mb-2"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              >
                Follow ups
              </div>
              <div className="flex flex-col gap-1">
                {related.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => onAskFollowUp(q)}
                    className="text-left px-3 py-2 hover:bg-amber-50 border-b border-stone-100 text-stone-700 hover:text-stone-950 text-sm transition-colors flex items-center justify-between group"
                    style={{ fontFamily: "'Fraunces', serif" }}
                  >
                    <span>{q}</span>
                    <span className="text-stone-300 group-hover:text-amber-600">→</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
export default function PerplexityClone() {
  const [apiKey, setApiKey] = useState("");
  const [hasEnvApiKey, setHasEnvApiKey] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [chats, setChats] = useState(null);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const chatsRef = useRef(null);

  useEffect(() => {
    if (chats) chatsRef.current = chats;
  }, [chats]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = await readPersistedChats();
      if (cancelled) return;
      setChats(normalizeChats(raw) ?? createInitialChats());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (chats === null) return;
    const t = setTimeout(() => {
      writePersistedChats(chats).catch(() => {});
    }, 450);
    return () => clearTimeout(t);
  }, [chats]);

  useEffect(() => {
    const bridge = getElectronBridge();
    if (!bridge) {
      setShowSettings(true);
      return;
    }

    bridge.hasApiKey().then((hasKey) => {
      setHasEnvApiKey(hasKey);
      setShowSettings(!hasKey);
    });
  }, []);

  const activeThread =
    chats && chats.threads.length
      ? chats.threads.find((t) => t.id === chats.activeThreadId) || chats.threads[0]
      : null;
  const messages = activeThread?.messages ?? [];
  const model = activeThread?.model ?? "sonar";
  const contextSize = activeThread?.contextSize ?? "medium";
  const displayCost = activeThread?.totalCost ?? 0;
  const lifetimeTotal =
    typeof chats?.lifetimeTotalSpent === "number" ? chats.lifetimeTotalSpent : 0;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const send = async (overrideQuery) => {
    const query = (overrideQuery || input).trim();
    if (!query) return;
    const bridge = getElectronBridge();
    if (!bridge && !apiKey) {
      setShowSettings(true);
      return;
    }
    if (bridge && hasEnvApiKey === false) {
      setShowSettings(true);
      return;
    }

    const store = chatsRef.current;
    if (!store) return;
    const thread = store.threads.find((t) => t.id === store.activeThreadId);
    if (!thread) return;

    const model = thread.model;
    const contextSize = thread.contextSize;

    setInput("");
    const userMsg = { role: "user", content: query };
    const conv = [...thread.messages, userMsg];

    setChats((prev) =>
      mapActiveChats(prev, (t) => {
        const nextTitle = t.messages.length === 0 ? titleFromQuery(query) : t.title;
        return {
          ...t,
          title: nextTitle,
          updatedAt: Date.now(),
          messages: [
            ...t.messages,
            userMsg,
            {
              role: "assistant",
              content: "",
              streaming: true,
              modelLabel: MODELS[model].label,
            },
          ],
        };
      })
    );
    setIsLoading(true);

    const body = {
      model,
      messages: [
        ...conv.map(({ role, content }) => ({
          role,
          content: role === "assistant" ? splitThinking(content).answer : content,
        })),
      ],
      stream: true,
      return_related_questions: true,
    };
    if (MODELS[model].supportsContext) {
      body.web_search_options = { search_context_size: contextSize };
    }

    try {
      let acc = "";
      let lastChunk = null;

      const onDelta = (delta) => {
        acc += delta;
        setChats((prev) =>
          mapActiveChats(prev, (t) => {
            const next = [...t.messages];
            if (!next.length) return t;
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, content: acc };
            return { ...t, updatedAt: Date.now(), messages: next };
          })
        );
      };

      if (bridge) {
        await new Promise((resolve, reject) => {
          bridge.streamChat(body, {
            onChunk: onDelta,
            onDone: (chunk) => {
              lastChunk = chunk;
              resolve();
            },
            onError: (message) => reject(new Error(message)),
          });
        });
      } else {
        const res = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errText = await res.text();
          let errMsg = `${res.status}: ${errText}`;
          try {
            const j = JSON.parse(errText);
            if (j.error?.message) errMsg = j.error.message;
          } catch {}
          throw new Error(errMsg);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const json = JSON.parse(payload);
              lastChunk = json;
              const delta = json.choices?.[0]?.delta?.content || "";
              if (delta) onDelta(delta);
            } catch {}
          }
        }
      }

      const sources =
        lastChunk?.search_results ||
        (lastChunk?.citations?.map((url) => ({ url })) || []);
      const related = lastChunk?.related_questions || [];
      const usage = lastChunk?.usage;
      const cost = computeCost(model, usage, contextSize);

      setChats((prev) => {
        const withMessages = mapActiveChats(prev, (t) => {
          const next = [...t.messages];
          if (!next.length) return t;
          next[next.length - 1] = {
            role: "assistant",
            content: acc,
            sources,
            related,
            usage,
            cost,
            modelLabel: MODELS[model].label,
            streaming: false,
          };
          return {
            ...t,
            updatedAt: Date.now(),
            totalCost: t.totalCost + cost,
            messages: next,
          };
        });
        return {
          ...withMessages,
          lifetimeTotalSpent: (prev.lifetimeTotalSpent ?? 0) + cost,
        };
      });
    } catch (err) {
      setChats((prev) =>
        mapActiveChats(prev, (t) => {
          const next = [...t.messages];
          if (!next.length) return t;
          next[next.length - 1] = {
            role: "assistant",
            error: err.message || "Request failed",
            streaming: false,
          };
          return { ...t, updatedAt: Date.now(), messages: next };
        })
      );
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const newThread = () => {
    setChats((prev) => {
      const cur = prev.threads.find((t) => t.id === prev.activeThreadId);
      const id = newThreadId();
      return {
        ...prev,
        activeThreadId: id,
        threads: [
          {
            id,
            title: "New chat",
            updatedAt: Date.now(),
            model: cur?.model ?? "sonar",
            contextSize: cur?.contextSize ?? "medium",
            totalCost: 0,
            messages: [],
          },
          ...prev.threads,
        ],
      };
    });
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const selectThread = (id) => {
    setChats((p) => ({ ...p, activeThreadId: id }));
    setInput("");
  };

  const deleteThread = (id) => {
    setChats((prev) => {
      const lifetime = prev.lifetimeTotalSpent ?? 0;
      const remaining = prev.threads.filter((t) => t.id !== id);
      if (remaining.length === 0) {
        return createInitialChats(lifetime);
      }
      let nextActive = prev.activeThreadId;
      if (nextActive === id) {
        const sorted = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt);
        nextActive = sorted[0].id;
      }
      return { ...prev, lifetimeTotalSpent: lifetime, threads: remaining, activeThreadId: nextActive };
    });
  };

  const sortedThreads =
    chats && [...chats.threads].sort((a, b) => b.updatedAt - a.updatedAt);

  const ModelIcon = MODELS[model].icon;
  const usingElectronApi = Boolean(getElectronBridge());
  const apiKeyReady = usingElectronApi ? hasEnvApiKey : Boolean(apiKey.trim());

  if (chats === null) {
    return (
      <div
        className="min-h-screen w-full flex items-center justify-center"
        style={{
          background: "radial-gradient(ellipse at top, #faf6ee 0%, #f3ebd9 100%)",
        }}
      >
        <Loader2 className="w-6 h-6 text-stone-500 animate-spin" />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen w-full flex"
      style={{
        background:
          "radial-gradient(ellipse at top, #faf6ee 0%, #f3ebd9 100%)",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300..900;1,300..900&family=JetBrains+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />

      <div
        className="fixed inset-0 pointer-events-none opacity-[0.04] mix-blend-multiply"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      <aside
        className="w-52 sm:w-60 shrink-0 border-r border-stone-200/90 bg-stone-100/40 flex flex-col h-screen min-h-0 z-10"
        style={{ fontFamily: "'Inter', sans-serif" }}
      >
        <div className="p-3 border-b border-stone-200/80">
          <div
            className="text-lg tracking-tight text-stone-900 mb-2 px-0.5"
            style={{ fontFamily: "'Fraunces', serif", fontWeight: 600 }}
          >
            Chats
          </div>
          <button
            type="button"
            onClick={newThread}
            className="w-full py-2 text-[10px] tracking-[0.2em] uppercase bg-stone-900 text-amber-50 hover:bg-stone-700"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            + New chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5 min-h-0">
          {sortedThreads.map((t) => {
            const active = t.id === chats.activeThreadId;
            return (
              <div
                key={t.id}
                className={`group flex items-stretch gap-0.5 rounded p-1.5 cursor-pointer ${
                  active
                    ? "bg-amber-100/80 border border-amber-200/60"
                    : "hover:bg-stone-200/50 border border-transparent"
                }`}
                onClick={() => selectThread(t.id)}
              >
                <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0 text-stone-500" />
                <div className="flex-1 min-w-0 pr-0.5">
                  <div
                    className="text-[13px] text-stone-800 truncate"
                    style={{ fontFamily: "'Fraunces', serif" }}
                  >
                    {t.title}
                  </div>
                  <div
                    className="text-[9px] text-stone-500 mt-0.5"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    {formatChatTime(t.updatedAt)}
                  </div>
                </div>
                <button
                  type="button"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteThread(t.id);
                  }}
                  className="self-start p-0.5 opacity-0 group-hover:opacity-100 text-stone-400 hover:text-red-700 transition-opacity"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      <div className="flex-1 min-w-0 min-h-screen overflow-y-auto">
        <div className="relative max-w-3xl mx-auto px-5 sm:px-8 py-8">
          <header className="flex items-center justify-between mb-10">
            <div className="flex items-baseline gap-3">
              <div
                className="text-3xl tracking-tight text-stone-900"
                style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontStyle: "italic" }}
              >
                Inquiry
              </div>
              <div
                className="text-[10px] tracking-[0.25em] uppercase text-stone-500"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              >
                · pplx ·
              </div>
            </div>
            <div className="flex items-center gap-1">
              {lifetimeTotal > 0 && (
                <div
                  className="text-right mr-2 px-2.5 py-1.5 bg-amber-50 border border-amber-200"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  title="Cumulative cost estimates stored locally; survives deleted chats. Official billing: console.perplexity.ai"
                >
                  <div className="text-[9px] tracking-[0.2em] uppercase text-amber-800/80">Total (this app)</div>
                  <div className="text-xs tabular-nums text-amber-900 font-medium">
                    ${lifetimeTotal.toFixed(4)}
                  </div>
                  {displayCost > 0 && displayCost < lifetimeTotal && (
                    <div className="text-[9px] text-amber-700/90 mt-0.5">
                      This chat ${displayCost.toFixed(4)}
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={newThread}
                className="text-[10px] tracking-[0.15em] uppercase text-stone-600 hover:text-stone-900 px-2 py-1 hover:bg-stone-200/50 transition-colors"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              >
                New
              </button>
              <button
                onClick={() => setShowSettings(true)}
                className="text-stone-500 hover:text-stone-900 p-2"
                title="Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </header>

          {messages.length === 0 && (
            <div className="my-12 text-center">
              <div
                className="text-5xl md:text-6xl text-stone-900 leading-[1.05] mb-4"
                style={{ fontFamily: "'Fraunces', serif", fontWeight: 300 }}
              >
                Ask, and you shall<br />
                <span style={{ fontStyle: "italic", fontWeight: 500 }}>
                  receive sources.
                </span>
              </div>
              <p
                className="text-stone-500 text-sm max-w-md mx-auto leading-relaxed"
              >
                A quiet front-end for the Perplexity API. Switch between fast search
                and exhaustive deep research. Costs surfaced per query.
              </p>

              <div className="mt-10 flex flex-col gap-1.5 max-w-md mx-auto">
                {[
                  "What were the major findings in the latest IPCC report?",
                  "Compare DuckDB vs ClickHouse for analytics workloads",
                  "Recent breakthroughs in room-temperature superconductors",
                ].map((s, i) => (
                  <button
                    key={i}
                    onClick={() => send(s)}
                    className="text-left px-4 py-2.5 bg-white/40 hover:bg-white border border-stone-200 hover:border-amber-300 text-stone-700 text-sm transition-all"
                    style={{ fontFamily: "'Fraunces', serif" }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div ref={scrollRef}>
            {messages.map((m, i) => (
              <MessageBlock key={i} msg={m} onAskFollowUp={(q) => send(q)} />
            ))}
          </div>

          <div className="sticky bottom-4 mt-8">
            <div className="bg-white border border-stone-300 shadow-[0_8px_30px_rgba(60,40,20,0.08)]">
              <div className="flex items-center gap-1 px-2 py-2 border-b border-stone-200 overflow-x-auto">
                {Object.values(MODELS).map((m) => {
                  const Icon = m.icon;
                  const active = model === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() =>
                        setChats((p) => mapActiveChats(p, (t) => ({ ...t, model: m.id, updatedAt: Date.now() })))
                      }
                      className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] whitespace-nowrap transition-colors ${
                        active
                          ? "bg-stone-900 text-amber-50"
                          : "text-stone-600 hover:bg-stone-100"
                      }`}
                      style={{ fontFamily: "'JetBrains Mono', monospace" }}
                      title={m.blurb}
                    >
                      <Icon className="w-3 h-3" />
                      {m.label}
                    </button>
                  );
                })}
                {MODELS[model].supportsContext && (
                  <>
                    <div className="w-px h-4 bg-stone-300 mx-1" />
                    <select
                      value={contextSize}
                      onChange={(e) =>
                        setChats((p) =>
                          mapActiveChats(p, (t) => ({
                            ...t,
                            contextSize: e.target.value,
                            updatedAt: Date.now(),
                          }))
                        )
                      }
                      className="text-[11px] bg-transparent text-stone-600 px-1 py-1 border-none outline-none"
                      style={{ fontFamily: "'JetBrains Mono', monospace" }}
                    >
                      <option value="low">Ctx · low</option>
                      <option value="medium">Ctx · med</option>
                      <option value="high">Ctx · high</option>
                    </select>
                  </>
                )}
              </div>

              <div className="flex items-end p-1">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    model === "sonar-deep-research"
                      ? "Ask anything — Deep Research can take a minute or two…"
                      : "Ask anything…"
                  }
                  rows={1}
                  disabled={isLoading}
                  className="flex-1 resize-none px-3 py-2.5 bg-transparent outline-none text-stone-900 placeholder:text-stone-400 text-[15px] max-h-32"
                  style={{ fontFamily: "'Fraunces', serif" }}
                />
                <button
                  type="button"
                  onClick={() => send()}
                  disabled={isLoading || !input.trim()}
                  className="m-1 p-2 bg-stone-900 text-amber-50 hover:bg-stone-700 disabled:bg-stone-300 disabled:cursor-not-allowed transition-colors"
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Search className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
            <div
              className="text-center mt-2 text-[10px] tracking-[0.15em] uppercase text-stone-400"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              <ModelIcon className="w-3 h-3 inline mr-1.5 -mt-0.5" />
              {MODELS[model].label} · {MODELS[model].blurb}
            </div>
          </div>
        </div>
      </div>

      {showSettings && (
        <div
          className="fixed inset-0 z-50 bg-stone-950/40 flex items-center justify-center p-4"
          onClick={() => apiKeyReady && setShowSettings(false)}
        >
          <div
            className="bg-stone-50 max-w-md w-full p-6 border border-stone-300 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-stone-700" />
                <h2
                  className="text-xl text-stone-900"
                  style={{ fontFamily: "'Fraunces', serif", fontWeight: 600 }}
                >
                  API Key
                </h2>
              </div>
              {apiKeyReady && (
                <button
                  onClick={() => setShowSettings(false)}
                  className="text-stone-500 hover:text-stone-900"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <p className="text-sm text-stone-600 mb-3 leading-relaxed">
              {usingElectronApi ? (
                hasEnvApiKey ? (
                  <>
                    Using your Perplexity API key from{" "}
                    <code
                      className="bg-stone-200 px-1 text-[12px]"
                      style={{ fontFamily: "'JetBrains Mono', monospace" }}
                    >
                      .env
                    </code>
                    .
                  </>
                ) : (
                  <>
                    Add{" "}
                    <code
                      className="bg-stone-200 px-1 text-[12px]"
                      style={{ fontFamily: "'JetBrains Mono', monospace" }}
                    >
                      PERPLEXITY_API_KEY=pplx-...
                    </code>{" "}
                    to{" "}
                    <code
                      className="bg-stone-200 px-1 text-[12px]"
                      style={{ fontFamily: "'JetBrains Mono', monospace" }}
                    >
                      .env
                    </code>
                    , then restart the app.
                  </>
                )
              ) : (
                <>
                  Paste your Perplexity API key. It&apos;s kept in this session only —
                  nothing is stored or sent anywhere except directly to{" "}
                  <code
                    className="bg-stone-200 px-1 text-[12px]"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    api.perplexity.ai
                  </code>
                  .
                </>
              )}
            </p>
            {!usingElectronApi && (
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="pplx-..."
                autoFocus
                className="w-full px-3 py-2.5 bg-white border border-stone-300 focus:border-stone-700 outline-none text-stone-900 text-sm"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && apiKey.trim()) setShowSettings(false);
                }}
              />
            )}
            <div className="mt-4 text-[11px] text-stone-500">
              Get one at{" "}
              <a
                href="https://www.perplexity.ai/settings/api"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-stone-900"
              >
                perplexity.ai/settings/api
              </a>
            </div>
            <button
              onClick={() => apiKeyReady && setShowSettings(false)}
              disabled={!apiKeyReady}
              className="mt-5 w-full py-2.5 bg-stone-900 text-amber-50 hover:bg-stone-700 disabled:bg-stone-300 transition-colors text-sm tracking-wide"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              {apiKeyReady ? "CONTINUE" : "WAITING FOR .ENV KEY"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
