const { app, BrowserWindow, ipcMain, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

let API_KEY = "";

function loadApiKey() {
  // In packaged apps, never prefer process.cwd() first — launching from Terminal or
  // Finder can point cwd at / or a random directory and dotenv does not override by
  // default, so a mis-ordered load can leave API_KEY empty even with Resources/.env.
  if (app.isPackaged) {
    const resourcesEnv = path.join(process.resourcesPath, ".env");
    if (fs.existsSync(resourcesEnv)) {
      dotenv.config({ path: resourcesEnv, quiet: true });
    }
    const userDataEnv = path.join(app.getPath("userData"), ".env");
    if (fs.existsSync(userDataEnv)) {
      dotenv.config({ path: userDataEnv, override: true, quiet: true });
    }
  } else {
    const cwdEnv = path.join(process.cwd(), ".env");
    if (fs.existsSync(cwdEnv)) {
      dotenv.config({ path: cwdEnv, quiet: true });
    }
    const userDataEnv = path.join(app.getPath("userData"), ".env");
    if (fs.existsSync(userDataEnv)) {
      dotenv.config({ path: userDataEnv, override: true, quiet: true });
    }
  }

  API_KEY =
    process.env.PERPLEXITY_API_KEY ||
    process.env.PPLX_API_KEY ||
    process.env.PERPLEXITY_KEY ||
    "";
}

function createWindow() {
  const appPath = app.getAppPath();
  const preload = path.join(appPath, "electron", "preload.cjs");

  const win = new BrowserWindow({
    width: 1100,
    height: 850,
    minWidth: 760,
    minHeight: 640,
    title: "Inquiry",
    backgroundColor: "#f3ebd9",
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("Inquiry: window failed to load", errorCode, errorDescription, validatedURL);
  });

  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("Inquiry: renderer process exited", details);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const indexHtml = path.join(appPath, "dist", "index.html");
    if (app.isPackaged && !fs.existsSync(indexHtml)) {
      console.error("Inquiry: missing dist — run `npm run build` before packaging.", indexHtml);
    }
    win.loadFile(indexHtml);
  }
}

app.whenReady().then(() => {
  loadApiKey();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function getChatsFilePath() {
  return path.join(app.getPath("userData"), "inquiry-chats.json");
}

ipcMain.handle("inquiry:load-chats", () => {
  const fp = getChatsFilePath();
  try {
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
});

ipcMain.handle("inquiry:save-chats", (_event, data) => {
  const fp = getChatsFilePath();
  try {
    fs.writeFileSync(fp, JSON.stringify(data), "utf8");
  } catch {
    // Failed to write userData; UI still works, history may not persist.
  }
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
      } catch {}
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
        } catch {}
      }
    }

    send("done", { lastChunk });
  } catch (error) {
    send("error", { message: error.message || "Request failed" });
  }
});
