import { createServer, Server } from "node:http";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { UserRepository } from "./db.js";
import { TelegramLinkingServer } from "./handler.js";

export function createLinkingServer(): Server {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN environment variable is required for the server");
  }

  const dbPath = process.env.DATABASE_PATH || resolve(process.cwd(), "data", "blinkit_auto.sqlite3");
  const dbDir = dirname(dbPath);
  mkdirSync(dbDir, { recursive: true });

  const repo = new UserRepository(dbPath);
  repo.initialize();

  const handler = new TelegramLinkingServer(repo, token);
  return createServer((req, res) => handler.handleRequest(req, res));
}

export function startServer() {
  try {
    const server = createLinkingServer();
    const port = parseInt(process.env.PORT || "3000", 10);
    
    server.listen(port, "0.0.0.0", () => {
      console.log(`Telegram Linking Server listening on 0.0.0.0:${port}`);
    });

    const shutdown = () => {
      console.log("Shutting down server gracefully...");
      server.close(() => {
        console.log("Server stopped.");
        process.exit(0);
      });
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    
    return { server, shutdown };
  } catch (error: any) {
    console.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
}

// Start if we are executed directly
if (process.argv[1] && import.meta.url.includes(process.argv[1].replace(/\\/g, "/").split("/").pop() || "index.ts")) {
  if (process.env.NODE_ENV !== "test") {
    startServer();
  }
}
