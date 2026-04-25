const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(process.cwd(), ".env") });

const API_KEY =
  process.env.PERPLEXITY_API_KEY ||
  process.env.PPLX_API_KEY ||
  process.env.PERPLEXITY_KEY ||
  "";

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 850,
    minWidth: 760,
    minHeight: 640,
    title: "Inquiry",
    backgroundColor: "#f3ebd9",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("perplexity:has-key", () => Boolean(API_KEY));

ipcMain.on("perplexity:stream-chat", async (event, { requestId, body }) => {
  const send = (channel, payload) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(`perplexity:${channel}`, { requestId, ...payload });
    }
  };

  if (!API_KEY) {
    send("error", {
      message:
        "Missing API key. Add PERPLEXITY_API_KEY=pplx-... to .env, then restart the app.",
    });
    return;
  }

  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      let message = `${res.status}: ${errText}`;
      try {
        const parsed = JSON.parse(errText);
        if (parsed.error?.message) message = parsed.error.message;
      } catch (error) {
        // Keep the raw response as the error message.
      }
      send("error", { message });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let lastChunk = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;

        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;

        try {
          const json = JSON.parse(payload);
          lastChunk = json;
          const delta = json.choices?.[0]?.delta?.content || "";
          if (delta) send("chunk", { delta });
        } catch (error) {
          // Ignore malformed SSE frames.
        }
      }
    }

    send("done", { lastChunk });
  } catch (error) {
    send("error", { message: error.message || "Request failed" });
  }
});
