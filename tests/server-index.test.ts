import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { exec, execSync } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

describe("Telegram Linking Server Entry Point", () => {
  let dbPath: string;
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "blinkit-server-"));
    dbPath = join(testDir, "test-server.sqlite3");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("fails to start if TELEGRAM_BOT_TOKEN is missing", () => {
    try {
      execSync("npx tsx src/server/index.ts", {
        env: { ...process.env, TELEGRAM_BOT_TOKEN: "", NODE_ENV: "production" },
        stdio: "pipe"
      });
      expect.fail("Should have thrown error");
    } catch (err: any) {
      expect(err.stderr?.toString() || err.stdout?.toString()).toContain("TELEGRAM_BOT_TOKEN environment variable is required");
    }
  });

  it("starts and responds to /health and handles graceful shutdown", async () => {
    const port = 3006; // use different port for test
    const serverProcess = exec(`npx tsx src/server/index.ts`, {
      env: { ...process.env, TELEGRAM_BOT_TOKEN: "test-token", DATABASE_PATH: dbPath, PORT: port.toString(), NODE_ENV: "production" }
    });

    let stdout = "";
    let stderr = "";
    serverProcess.stdout?.on("data", (data) => { stdout += data; });
    serverProcess.stderr?.on("data", (data) => { stderr += data; });

    // Wait for server to start
    let started = false;
    for (let i = 0; i < 20; i++) {
      if (stdout.includes(`Telegram Linking Server listening on 0.0.0.0:${port}`)) {
        started = true;
        break;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    
    if (!started) console.log("STDOUT:", stdout, "\nSTDERR:", stderr);

    expect(stdout).toContain(`Telegram Linking Server listening on 0.0.0.0:${port}`);

    // Check /health
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    
    // Check session still works
    const sessRes = await fetch(`http://127.0.0.1:${port}/api/link/session`, { method: "POST" });
    expect(sessRes.status).toBe(200);

    // Trigger graceful shutdown
    serverProcess.kill("SIGTERM");
    
    // Wait for shutdown
    await new Promise(r => setTimeout(r, 1000));
    
    if (process.platform !== "win32") {
      expect(stdout).toContain("Shutting down server gracefully...");
      expect(stdout).toContain("Server stopped.");
    }
  }, 15000);
});
