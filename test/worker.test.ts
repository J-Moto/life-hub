import { describe, expect, it } from "vitest";
import { exports } from "cloudflare:workers";

// End-to-end through the Worker. No valid Access token exists in tests, so everything must be refused.
describe("Worker front door", () => {
  const SELF = (exports as any).default as Fetcher;

  it("refuses the page without Access", async () => {
    const res = await SELF.fetch("https://hub.example.com/");
    expect(res.status).toBe(401);
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("refuses the API without Access", async () => {
    expect((await SELF.fetch("https://hub.example.com/api/today")).status).toBe(401);
  });

  it("refuses a spoofed localhost Host header", async () => {
    const res = await SELF.fetch("http://localhost:8787/api/today", { headers: { "CF-Connecting-IP": "192.168.1.50" } });
    expect(res.status).toBe(401);
  });

  it("refuses a forged token", async () => {
    const res = await SELF.fetch("https://hub.example.com/api/today", {
      headers: { "Cf-Access-Jwt-Assertion": "a.b.c" },
    });
    expect(res.status).toBe(401);
  });
});
