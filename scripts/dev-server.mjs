// Servidor estático de desenvolvimento com fallback de SPA (espelha vercel.json).
// Uso: npm run dev   (PORT=5173 por padrão)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.PORT || 5173);
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png"
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let path = decodeURIComponent(url.pathname);
  if (path === "/privacidade") path = "/privacidade.html";
  // FAKE_SUPABASE=1 (npm run dev:fake): troca o supabase-js por um banco falso em memória, só para testar telas
  if (process.env.FAKE_SUPABASE === "1" && path.startsWith("/vendor/supabase-")) path = "/tests/e2e/fake-supabase.js";
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) { res.writeHead(403).end("forbidden"); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" }).end(body);
  } catch {
    if (extname(path)) { res.writeHead(404).end("not found"); return; }   // asset inexistente → 404 (não devolve HTML)
    res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-cache" }).end(await readFile(join(root, "index.html")));
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
