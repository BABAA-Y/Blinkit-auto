import { IncomingMessage, ServerResponse } from "node:http";
import type { UserRepository } from "./db.js";

export class TelegramLinkingServer {
  constructor(
    private readonly users: UserRepository,
    private readonly botToken: string
  ) {
    if (!this.botToken) {
      throw new Error("TELEGRAM_BOT_TOKEN environment variable is required for the server");
    }
  }

  public async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = req.headers.host || "localhost";
    const url = new URL(req.url || "/", `http://${host}`);
    
    if (req.method === "POST" && url.pathname === "/webhook/telegram") {
      await this.handleWebhook(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/verify/")) {
      const chatId = url.pathname.replace("/api/verify/", "");
      const user = this.users.getUserByChatId(chatId);
      if (user) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ linked: true, user: { id: user.id, username: user.username } }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ linked: false }));
      }
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  }

  private async handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await parseJsonBody(req);
      if (!body || typeof body !== "object") throw new Error("Invalid payload");
      
      if (body.message) {
        const text = body.message.text;
        const chat = body.message.chat;
        const from = body.message.from;

        if (chat && chat.id) {
          const chatId = String(chat.id);
          const userId = from?.id ? String(from.id) : undefined;
          const username = from?.username;

          if (text === "/start") {
            this.users.upsertTelegramUser(chatId, userId, username);
            await this.sendTelegramMessage(chatId, "Welcome to Blinkit-Auto! Your Telegram account has been successfully linked.");
          }
        }
      }
      res.writeHead(200);
      res.end("OK");
    } catch (e) {
      res.writeHead(400);
      res.end("Bad Request");
    }
  }

  private async sendTelegramMessage(chatId: string, text: string): Promise<void> {
    await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  }
}

async function parseJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => data += chunk);
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
