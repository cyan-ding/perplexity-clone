const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("perplexity", {
  hasApiKey: () => ipcRenderer.invoke("perplexity:has-key"),
  streamChat: (body, handlers = {}) => {
    const requestId =
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const cleanup = () => {
      ipcRenderer.removeListener("perplexity:chunk", onChunk);
      ipcRenderer.removeListener("perplexity:done", onDone);
      ipcRenderer.removeListener("perplexity:error", onError);
    };

    const matchesRequest = (_, payload) => payload?.requestId === requestId;

    const onChunk = (event, payload) => {
      if (!matchesRequest(event, payload)) return;
      handlers.onChunk?.(payload.delta);
    };

    const onDone = (event, payload) => {
      if (!matchesRequest(event, payload)) return;
      cleanup();
      handlers.onDone?.(payload.lastChunk);
    };

    const onError = (event, payload) => {
      if (!matchesRequest(event, payload)) return;
      cleanup();
      handlers.onError?.(payload.message || "Request failed");
    };

    ipcRenderer.on("perplexity:chunk", onChunk);
    ipcRenderer.on("perplexity:done", onDone);
    ipcRenderer.on("perplexity:error", onError);
    ipcRenderer.send("perplexity:stream-chat", { requestId, body });

    return cleanup;
  },
});
