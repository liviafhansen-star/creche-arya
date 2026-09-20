// Lint sem dependências: sintaxe de todos os JS do app + JSON válido + SQL sem coisas proibidas.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const walk = dir => readdirSync(dir).flatMap(n => {
  if (["node_modules", ".git", ".vercel", "vendor"].includes(n)) return [];
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk(root);
let bad = 0;
const fail = (f, msg) => { bad++; console.error(`✖ ${f.replace(root, "")}: ${msg}`); };

for (const f of files.filter(f => /\.(js|mjs)$/.test(f))) {
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); } catch (e) { fail(f, "erro de sintaxe\n" + String(e.stderr || e)); }
}
for (const f of files.filter(f => /\.(json|webmanifest)$/.test(f) && !f.endsWith("package-lock.json"))) {
  try { JSON.parse(readFileSync(f, "utf8")); } catch (e) { fail(f, "JSON inválido: " + e.message); }
}
for (const f of files.filter(f => f.endsWith(".sql") && !f.includes("legacy"))) {
  const s = readFileSync(f, "utf8");
  if (/@(gmail|hotmail|outlook)\.com/i.test(s)) fail(f, "e-mail pessoal hard-coded em SQL");
  if (/\bupdate\s+public\.\w+\s+set\s+user_id\s*=/i.test(s)) fail(f, "UPDATE de user_id em massa (perigoso)");
}
console.log(bad ? `\n${bad} problema(s).` : "lint ok");
process.exit(bad ? 1 : 0);
