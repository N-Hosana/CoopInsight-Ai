import https from "https";
import http from "http";

/**
 * The one place the Python AI service is called from.
 *
 * The UI never talks to the AI service directly — everything goes through this
 * backend, which holds the auth and the role gating. Every caller here is
 * expected to handle the service being down: it is a separate process, it is
 * optional, and the application has to keep working without it.
 */
export const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";

export const callAIService = async (
  path: string,
  method = "GET",
  body?: object,
  timeoutMs = 10000
): Promise<any> => {
  const url = new URL(path, AI_SERVICE_URL);
  const mod = url.protocol === "https:" ? https : http;
  return new Promise<any>((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
      },
    };
    const req = mod.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error("AI service timeout"));
    });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
};
