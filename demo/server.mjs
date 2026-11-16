/**
 * Fictional marketing site: real backend integration with the Guard Node SDK.
 * THIS SERVER IS LOCAL-DEMO-ONLY and never binds to a public interface.
 * No mutation endpoint; state changes are controlled via the separate Guard API.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { GuardClient } from "../sdk/node.mjs";
import { pageForLicense, publicStatus } from "./gate.mjs";

const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"
};
const assets = new Map([
  ["/assets/site.css", ["site.css", "text/css; charset=utf-8"]],
  ["/assets/site.js", ["site.js", "text/javascript; charset=utf-8"]]
]);
function write(res, status, content, type = "text/html; charset=utf-8") {
  res.writeHead(status, { ...headers, "Content-Type": type });
  res.end(content);
}
export function createDemoServer({ client }) {
  if (!client || typeof client.decision !== "function") throw new TypeError("Guard server client required");
  return createServer(async (req, res) => {
    try {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (req.method !== "GET" && req.method !== "HEAD")
        return write(res, 405, "Method not allowed", "text/plain; charset=utf-8");
      if (path === "/healthz")
        return write(res, 200, JSON.stringify({ status: "ok", demo: true }), "application/json; charset=utf-8");
      if (assets.has(path)) {
        const [file, mime] = assets.get(path);
        const body = await readFile(new URL("./assets/" + file, import.meta.url));
        return write(res, 200, body, mime);
      }
      if (!["/", "/index.html", "/portfolio", "/api/demo/status"].includes(path))
        return write(res, 404, "Not found", "text/plain; charset=utf-8");
      const decision = await client.decision();
      if (path === "/api/demo/status")
        return write(res, 200, JSON.stringify(publicStatus(decision)), "application/json; charset=utf-8");
      const page = pageForLicense(decision, path === "/portfolio" ? "portfolio" : "home");
      const body = await readFile(new URL("./pages/" + page.page, import.meta.url));
      // Never include protected copy in the restricted response. CSS blur is not access control.
      return write(res, 200, body);
    } catch {
      return write(res, 503, "Temporary preview issue", "text/plain; charset=utf-8");
    }
  });
}
if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  if (process.env.DEMO_ENABLED !== "YES")
    throw new Error("Demo explicitly disabled; set DEMO_ENABLED=YES on local development machine only");
  const HOST = process.env.DEMO_HOST || "127.0.0.1";
  const PORT = Number(process.env.DEMO_PORT || 4190);
  if (!["127.0.0.1", "localhost"].includes(HOST) || !Number.isInteger(PORT) ||
      PORT < 1024 || PORT > 65535) throw new Error("Demo requires loopback address and valid port");
  const endpoint = new URL(process.env.GUARD_BASE_URL || "");
  if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(endpoint.hostname))
    throw new Error("Demo accepts local Guard backend only");
  const projectId = process.env.DEMO_PROJECT_ID;
  const projectKey = process.env.DEMO_PROJECT_KEY;
  if (!/^[0-9a-f-]{36}$/i.test(projectId || "") || !/^[a-f0-9]{64}$/i.test(projectKey || ""))
    throw new Error("Demo requires a registered project ID and its 64-character backend key");
  const client = new GuardClient({ endpoint: endpoint.origin, projectId, projectKey });
  const server = createDemoServer({ client });
  server.listen(PORT, HOST, () => {
    console.log("Fictional Guard demo listening on http://" + HOST + ":" + PORT +
      " (local only; no real customer site)");
  });
}
