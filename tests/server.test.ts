import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { UserRepository } from "../src/server/db.js";
import { TelegramLinkingServer } from "../src/server/handler.js";

const directories: string[] = [];
afterEach(() => {
  directories.forEach(d => rmSync(d, { recursive: true, force: true }));
  directories.length = 0;
  vi.restoreAllMocks();
});

function setupServer() {
  const directory = mkdtempSync(join(tmpdir(), "blinkit-server-"));
  directories.push(directory);
  const repo = new UserRepository(join(directory, "server.sqlite3"));
  repo.initialize();
  const server = new TelegramLinkingServer(repo, "mock-bot-token", "TestBot");
  return { repo, server };
}

function createMockRequest(method: string, url: string, body?: any): IncomingMessage {
  const req = new IncomingMessage(new Socket());
  req.method = method;
  req.url = url;
  req.headers = { host: "localhost" };
  
  if (body) {
    const payload = JSON.stringify(body);
    req.push(payload);
    req.push(null);
  }
  return req;
}

function createMockResponse(): { res: ServerResponse; data: Promise<{ status: number; body: string }> } {
  const res = new ServerResponse(new IncomingMessage(new Socket()));
  let body = "";
  
  const data = new Promise<{ status: number; body: string }>(resolve => {
    res.end = vi.fn((chunk: any) => {
      if (chunk) body += chunk;
      resolve({ status: res.statusCode, body });
      return res;
    }) as any;
  });
  
  return { res, data };
}

describe("Telegram Linking Server", () => {
  it("rejects invalid/malformed update", async () => {
    const { server } = setupServer();
    const req = createMockRequest("POST", "/webhook/telegram");
    req.push("invalid json");
    req.push(null);
    const { res, data } = createMockResponse();
    
    await server.handleRequest(req, res);
    const response = await data;
    expect(response.status).toBe(400);
  });

  it("first /start creates a user", async () => {
    const { server, repo } = setupServer();
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({ ok: true } as any);
    
    const req = createMockRequest("POST", "/webhook/telegram", {
      message: {
        text: "/start",
        chat: { id: 123456 },
        from: { id: 123456, username: "testuser" }
      }
    });
    const { res, data } = createMockResponse();
    
    await server.handleRequest(req, res);
    const response = await data;
    expect(response.status).toBe(200);
    
    const user = repo.getUserByChatId("123456");
    expect(user).toBeDefined();
    expect(user?.telegramUserId).toBe("123456");
    expect(user?.username).toBe("testuser");
    
    expect(fetchMock).toHaveBeenCalledWith("https://api.telegram.org/botmock-bot-token/sendMessage", expect.objectContaining({
      body: expect.stringContaining("Welcome to Blinkit-Auto!")
    }));
  });

  it("repeated /start does not create duplicate users", async () => {
    const { server, repo } = setupServer();
    vi.spyOn(global, "fetch").mockResolvedValue({ ok: true } as any);
    
    const req1 = createMockRequest("POST", "/webhook/telegram", {
      message: { text: "/start", chat: { id: 777 }, from: { id: 777, username: "first" } }
    });
    const { res: res1, data: data1 } = createMockResponse();
    await server.handleRequest(req1, res1);
    await data1;
    
    const user1 = repo.getUserByChatId("777");
    
    const req2 = createMockRequest("POST", "/webhook/telegram", {
      message: { text: "/start", chat: { id: 777 }, from: { id: 777, username: "updated" } }
    });
    const { res: res2, data: data2 } = createMockResponse();
    await server.handleRequest(req2, res2);
    await data2;
    
    const user2 = repo.getUserByChatId("777");
    
    expect(user1?.id).toBe(user2?.id);
    expect(user2?.username).toBe("updated");
  });

  it("missing optional username is handled safely", async () => {
    const { server, repo } = setupServer();
    vi.spyOn(global, "fetch").mockResolvedValue({ ok: true } as any);
    
    const req = createMockRequest("POST", "/webhook/telegram", {
      message: { text: "/start", chat: { id: 888 }, from: { id: 888 } }
    });
    const { res, data } = createMockResponse();
    await server.handleRequest(req, res);
    await data;
    
    const user = repo.getUserByChatId("888");
    expect(user?.username).toBeUndefined();
    expect(user?.telegramChatId).toBe("888");
  });

  it("verify endpoint returns linked status without exposing token", async () => {
    const { server, repo } = setupServer();
    repo.upsertTelegramUser("999", "999", "secretuser");
    
    const req = createMockRequest("GET", "/api/verify/999");
    const { res, data } = createMockResponse();
    
    await server.handleRequest(req, res);
    const response = await data;
    expect(response.status).toBe(200);
    
    const json = JSON.parse(response.body);
    expect(json.linked).toBe(true);
    expect(json.user.username).toBe("secretuser");
    expect(response.body).not.toContain("mock-bot-token");
  });

  it("handles linking sessions correctly", async () => {
    const { server } = setupServer();
    vi.spyOn(global, "fetch").mockResolvedValue({ ok: true } as any);

    // 1. Create session
    const reqSession = createMockRequest("POST", "/api/link/session");
    const { res: resSession, data: dataSession } = createMockResponse();
    await server.handleRequest(reqSession, resSession);
    const sessionResponse = await dataSession;
    expect(sessionResponse.status).toBe(200);
    const { linkingCode, botUsername } = JSON.parse(sessionResponse.body);
    expect(linkingCode).toBeDefined();
    expect(botUsername).toBe("TestBot");

    // 2. Check status before linking
    const reqStatus1 = createMockRequest("GET", `/api/link/status/${linkingCode}`);
    const { res: resStatus1, data: dataStatus1 } = createMockResponse();
    await server.handleRequest(reqStatus1, resStatus1);
    const status1 = JSON.parse((await dataStatus1).body);
    expect(status1.linked).toBe(false);

    // 3. Complete linking via webhook
    const reqWebhook = createMockRequest("POST", "/webhook/telegram", {
      message: { text: `/start ${linkingCode}`, chat: { id: 111 }, from: { id: 111, username: "linker" } }
    });
    const { res: resWebhook, data: dataWebhook } = createMockResponse();
    await server.handleRequest(reqWebhook, resWebhook);
    await dataWebhook;

    // 4. Check status after linking
    const reqStatus2 = createMockRequest("GET", `/api/link/status/${linkingCode}`);
    const { res: resStatus2, data: dataStatus2 } = createMockResponse();
    await server.handleRequest(reqStatus2, resStatus2);
    const status2 = JSON.parse((await dataStatus2).body);
    expect(status2.linked).toBe(true);
    expect(status2.userToken).toBeDefined();

    // 5. Test api/notify
    const reqNotify = createMockRequest("POST", "/api/notify", { userToken: status2.userToken, message: "Hello CLI" });
    const { res: resNotify, data: dataNotify } = createMockResponse();
    await server.handleRequest(reqNotify, resNotify);
    const notifyResponse = await dataNotify;
    expect(notifyResponse.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith("https://api.telegram.org/botmock-bot-token/sendMessage", expect.objectContaining({
      body: expect.stringContaining("Hello CLI")
    }));
  });

  it("dynamically resolves bot username via getMe and registers webhook", async () => {
    const { repo } = setupServer();
    const server = new TelegramLinkingServer(repo, "mock-bot-token");
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      if (url.toString().includes("getMe")) {
        return { ok: true, json: async () => ({ ok: true, result: { username: "DynamicResolvedBot" } }) } as any;
      }
      if (url.toString().includes("setWebhook")) {
        return { ok: true, json: async () => ({ ok: true }) } as any;
      }
      return { ok: false } as any;
    });

    await server.initialize("https://test.server.com");
    
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("getMe"));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("setWebhook?url=https%3A%2F%2Ftest.server.com%2Fwebhook%2Ftelegram"));

    const reqSession = createMockRequest("POST", "/api/link/session");
    const { res: resSession, data: dataSession } = createMockResponse();
    await server.handleRequest(reqSession, resSession);
    const sessionResponse = await dataSession;
    
    const { botUsername } = JSON.parse(sessionResponse.body);
    expect(botUsername).toBe("DynamicResolvedBot");
  });
});
