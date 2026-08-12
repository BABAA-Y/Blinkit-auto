import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

describe("CLI Routing", () => {
  const runCli = (args: string[]) => {
    return execFileSync("node", ["dist/src/index.js", ...args], { encoding: "utf8" }).trim();
  };

  it("returns package version for --version", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const output = runCli(["--version"]);
    expect(output).toMatch(new RegExp(`blinkit-auto v${pkg.version}`));
  });

  it("returns package version for -v", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const output = runCli(["-v"]);
    expect(output).toMatch(new RegExp(`blinkit-auto v${pkg.version}`));
  });

  it("returns clean CLI help for --help", () => {
    const output = runCli(["--help"]);
    expect(output.includes("BLINKIT-AUTO")).toBe(true);
    expect(output.includes("Wishlist Availability Monitor")).toBe(true);
    expect(output.includes("Usage:")).toBe(true);
    expect(output.includes("blinkit-auto [command]")).toBe(true);
  });

  it("returns clean CLI help for -h", () => {
    const output = runCli(["-h"]);
    expect(output.includes("BLINKIT-AUTO")).toBe(true);
    expect(output.includes("Wishlist Availability Monitor")).toBe(true);
    expect(output.includes("Usage:")).toBe(true);
  });

  it("existing command routing remains unchanged (status)", () => {
    // Run status command with a temporary database so we don't interfere with real data
    const output = execFileSync("node", ["dist/src/index.js", "status"], { 
      encoding: "utf8",
      env: { ...process.env, BLINKIT_AUTO_DB_PATH: "tests/temp_cli_status.sqlite3" }
    });
    expect(output.includes("LOCAL WORKER STATUS")).toBe(true);
    // Clean up
    try { rmSync("tests/temp_cli_status.sqlite3", { force: true }); } catch (e) {}
  });
});
