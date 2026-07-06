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
        "User-Agent": "issta-dashboard",
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
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.status(200).send(Buffer.from(meta.content, "base64").toString("utf8"));
    }

    if (req.method === "PUT" || req.method === "POST") {
      const data = await readBody(req);
      if (!data || data.length > 900000) return res.status(400).json({ error: "bad payload" });
      try { JSON.parse(data); } catch { return res.status(400).json({ error: "not json" }); }
      let sha;
      const m = await gh("GET", API_PATH + "?ref=main", tok);
      if (m.status === 200) { try { sha = JSON.parse(m.body).sha; } catch {} }
      const user = req.headers["x-user"] ? decodeURIComponent(req.headers["x-user"]) : "לא ידוע";
      const commit = { message: "עדכון דשבורד — " + user, content: Buffer.from(data, "utf8").toString("base64"), branch: "main" };
      if (sha) commit.sha = sha;
      const r = await gh("PUT", API_PATH, tok, JSON.stringify(commit));
      if (r.status !== 200 && r.status !== 201) return res.status(502).json({ error: "save failed " + r.status });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).end();
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
