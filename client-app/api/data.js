const https = require("https");

const REPO = "sivanAssif/ProjeftIssta";
const API_PATH = `/repos/${REPO}/contents/data.json`;

function gh(method, path, token, payload) {
  return new Promise((resolve, reject) => {
    const body = payload ? Buffer.from(payload, "utf8") : null;
    const req = https.request({
      hostname: "api.github.com",
      path,
      method,
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "User-Agent": "issta-client",
        ...(body ? { "Content-Type": "application/json", "Content-Length": body.length } : {}),
      },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body !== undefined) {
      resolve(typeof req.body === "string" ? req.body : JSON.stringify(req.body));
      return;
    }
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

// Client-scoped API: exposes ONLY the env + follow tables. The client can never
// read or write any other internal table, even by tampering with the payload.
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-User");
  if (req.method === "OPTIONS") return res.status(204).end();

  const tok = process.env.GH_TOKEN;
  if (!tok) return res.status(500).json({ error: "GH_TOKEN not configured" });

  try {
    if (req.method === "GET") {
      const r = await gh("GET", API_PATH + "?ref=main&_=" + Date.now(), tok);
      if (r.status !== 200) return res.status(502).json({ error: "load failed " + r.status });
      const meta = JSON.parse(r.body);
      const full = JSON.parse(Buffer.from(meta.content, "base64").toString("utf8"));
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.status(200).send(JSON.stringify({
        env: Array.isArray(full.env) ? full.env : [],
        follow: Array.isArray(full.follow) ? full.follow : [],
      }));
    }

    if (req.method === "PUT" || req.method === "POST") {
      const raw = await readBody(req);
      if (!raw || raw.length > 500000) return res.status(400).json({ error: "bad payload" });
      let incoming;
      try { incoming = JSON.parse(raw); } catch { return res.status(400).json({ error: "not json" }); }
      if (!Array.isArray(incoming.env) || !Array.isArray(incoming.follow)) return res.status(400).json({ error: "missing tables" });

      const m = await gh("GET", API_PATH + "?ref=main&_=" + Date.now(), tok);
      if (m.status !== 200) return res.status(502).json({ error: "load failed " + m.status });
      const meta = JSON.parse(m.body);
      const full = JSON.parse(Buffer.from(meta.content, "base64").toString("utf8"));

      // Only these two tables are ever written from the client side.
      full.env = incoming.env;
      full.follow = incoming.follow;

      if (!Array.isArray(full.history)) full.history = [];
      const user = req.headers["x-user"] ? decodeURIComponent(req.headers["x-user"]) : "לקוח";
      if (Array.isArray(incoming.hist)) {
        incoming.hist.slice(0, 100).forEach((h) => {
          full.history.unshift({ ts: String(h.ts || ""), u: user, a: String(h.a || ""), src: "client" });
        });
        if (full.history.length > 500) full.history.length = 500;
      }

      const commit = {
        message: "עדכון מהלקוח — " + user,
        content: Buffer.from(JSON.stringify(full), "utf8").toString("base64"),
        branch: "main",
        sha: meta.sha,
      };
      const r = await gh("PUT", API_PATH, tok, JSON.stringify(commit));
      if (r.status !== 200 && r.status !== 201) return res.status(502).json({ error: "save failed " + r.status });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).end();
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
