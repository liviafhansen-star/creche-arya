// Testes estáticos de "fiação": pegam quebras que só apareceriam no navegador.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");
const jsFiles = ["js/config.js", "js/core.js", "js/auth.js", "js/router.js", "js/shared.js", "js/tutor.js", "js/creche.js", "js/main.js"];
const js = Object.fromEntries(jsFiles.map(f => [f, read(f)]));
const allJs = Object.values(js).join("\n");
const html = read("index.html");
const markup = html + "\n" + allJs;   // HTML estático + templates dentro dos JS

const uniq = a => [...new Set(a)];
const matches = (s, re) => [...s.matchAll(re)].map(m => m[1]);

test("todo data-act/data-input/data-change/data-submit tem handler registrado", () => {
  const kinds = [["data-act", "act"], ["data-input", "onInput"], ["data-change", "onChange"], ["data-submit", "onSubmit"]];
  const missing = [];
  for (const [attr, reg] of kinds) {
    const used = uniq(matches(markup, new RegExp(attr + '="([A-Za-z][\\w]*)"', "g")));
    const defined = new Set(matches(allJs, new RegExp("\\b" + reg + '\\("([A-Za-z][\\w]*)"', "g")));
    for (const u of used) if (!defined.has(u)) missing.push(`${attr}="${u}" sem ${reg}("${u}")`);
  }
  assert.deepEqual(missing, []);
});

test("nenhum handler registrado ficou órfão (sem uso no HTML/templates)", () => {
  const orphans = [];
  for (const [attr, reg] of [["data-act", "act"], ["data-input", "onInput"], ["data-change", "onChange"], ["data-submit", "onSubmit"]]) {
    const defined = uniq(matches(allJs, new RegExp("\\b" + reg + '\\("([A-Za-z][\\w]*)"', "g")));
    for (const d of defined) if (!markup.includes(`${attr}="${d}"`) && !(attr === "data-act" && allJs.includes(`dataset.act = "${d}"`))) orphans.push(`${reg}("${d}")`);
  }
  assert.deepEqual(orphans, []);
});

test("sem handlers inline (onclick=…): exigência do CSP sem 'unsafe-inline' em scripts", () => {
  const re = /\son(click|change|input|submit|load|error|focus|blur|keydown|keyup)\s*=/i;
  assert.equal(re.test(markup), false, "achou atributo on*= em HTML/template");
  assert.equal(/javascript:/i.test(markup), false, "achou javascript: URL");
});

test("HTML não carrega scripts/estilos de outras origens", () => {
  assert.deepEqual(matches(html, /<script[^>]+src="(https?:[^"]+)"/g), []);
  assert.deepEqual(matches(html, /<link[^>]+href="(https?:[^"]+)"/g), []);
});

test("todo ID usado por $()/getVal()/setVal() existe no HTML ou é criado num template", () => {
  const defined = new Set(matches(markup, /\bid="([\w-]+)"/g));
  const used = uniq([
    ...matches(allJs, /\$\("([\w-]+)"\)/g), ...matches(allJs, /\bgetVal\("([\w-]+)"\)/g),
    ...matches(allJs, /\bsetVal\("([\w-]+)"/g), ...matches(allJs, /\bflashHint\("([\w-]+)"\)/g)
  ]);
  const missing = used.filter(id => !defined.has(id));
  assert.deepEqual(missing, []);
});

test("scripts do index.html existem e estão na ordem de dependência", () => {
  const srcs = matches(html, /<script src="([^"?]+)/g);
  for (const s of srcs) assert.ok(fs.existsSync(path.join(root, s)), "falta " + s);
  const idx = n => srcs.findIndex(s => s.endsWith(n));
  ["lib/pure.js", "core.js", "auth.js", "router.js", "tutor.js", "creche.js", "main.js"].forEach((n, i, a) => { if (i) assert.ok(idx(n) > idx(a[i - 1]), `${n} deve vir depois de ${a[i - 1]}`); });
  assert.ok(idx("config.js") < idx("lib/pure.js"));
  assert.ok(idx("shared.js") === -1 || idx("shared.js") > idx("core.js"));
});

test("scripts do index.html incluem shared.js (usado por tutor e creche)", () => {
  assert.ok(html.includes("/js/shared.js"), "index.html precisa carregar /js/shared.js");
  const srcs = matches(html, /<script src="([^"?]+)/g);
  assert.ok(srcs.findIndex(s => s.endsWith("shared.js")) < srcs.findIndex(s => s.endsWith("tutor.js")));
});

test("versão do app é a mesma em index.html, sw.js, config.js e privacidade.html", () => {
  const v = read("sw.js").match(/const VERSION = "(\d+)"/)[1];
  assert.equal(read("js/config.js").match(/VERSION: "(\d+)"/)[1], v);
  const q = uniq(matches(html + read("privacidade.html"), /\?v=(\d+)/g));
  assert.deepEqual(q, [v]);
});

test("arquivos do shell do service worker existem", () => {
  const sw = read("sw.js"), v = sw.match(/const VERSION = "(\d+)"/)[1];
  const list = sw.slice(sw.indexOf("const SHELL"), sw.indexOf("];", sw.indexOf("const SHELL")));
  for (const p of matches(list, /"(\/[^"]*)"/g)) {
    const f = p.split("?")[0];
    if (f === "/") continue;
    assert.ok(fs.existsSync(path.join(root, f)), "SW precacheia arquivo inexistente: " + f);
  }
  for (const m of list.matchAll(/"(\/[^"]*)" \+ VERSION|"(\/[^"]*\?v=)" \+ VERSION/g)) {
    const f = (m[1] || m[2]).replace("?v=", "");
    assert.ok(fs.existsSync(path.join(root, f)), "SW precacheia arquivo inexistente: " + f);
  }
  assert.ok(v);
});

test("vercel.json: CSP restritivo, cabeçalhos de segurança e rewrite da política", () => {
  const cfg = JSON.parse(read("vercel.json"));
  const all = cfg.headers.find(h => h.source === "/(.*)").headers;
  const get = k => (all.find(h => h.key === k) || {}).value;
  const csp = get("Content-Security-Policy");
  assert.ok(csp, "sem CSP");
  assert.ok(/script-src 'self'(;|$)/.test(csp), "script-src deve ser só 'self'");
  assert.ok(!/unsafe-eval|script-src[^;]*unsafe-inline/.test(csp));
  assert.ok(/frame-ancestors 'none'/.test(csp) && /object-src 'none'/.test(csp) && /base-uri 'self'/.test(csp));
  assert.equal(get("X-Content-Type-Options"), "nosniff");
  assert.ok(get("Strict-Transport-Security"));
  assert.ok(cfg.rewrites.some(r => r.source === "/privacidade"));
  assert.ok(cfg.rewrites.some(r => r.destination === "/index.html"));
});

test("manifest: ícones PNG existem e nome está íntegro (UTF-8)", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  assert.equal(m.name, "Cãotrole Financeiro");
  assert.ok(m.icons.some(i => i.sizes === "192x192") && m.icons.some(i => i.sizes === "512x512") && m.icons.some(i => i.purpose === "maskable"));
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(root, i.src)), "ícone ausente: " + i.src);
  assert.ok(!fs.readFileSync(path.join(root, "manifest.webmanifest")).slice(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), "manifest não deve ter BOM");
});

test("XSS: campos digitados pelo usuário nunca entram em template sem esc()", () => {
  // Heurística: dentro de `...${expr}...` numa linha com HTML, expr que toca campo de usuário precisa de esc()/money()/formatX().
  const risky = /\.(name|note|notes|text|tutor_name|pet_name|breed|key|email|attachment_name|owner1_name|owner2_name|invite_code)\b/;
  const safe = /esc\(|money\(|formatBRDate\(|formatTime\(|formatPhoneBr\(|toLocaleDateString\(|\.length|\?\s*"|\?\s*'|Pure\.STATE_LABEL/;
  const offenders = [];
  for (const [file, src] of Object.entries(js)) {
    src.split("\n").forEach((line, i) => {
      if (!line.includes("<") || !line.includes("${")) return;
      for (const m of line.matchAll(/\$\{([^}]+)\}/g)) {
        const expr = m[1];
        if (risky.test(expr) && !safe.test(expr)) offenders.push(`${file}:${i + 1}  \${${expr}}`);
      }
    });
  }
  assert.deepEqual(offenders, []);
});

test("migration e app concordam na versão do schema", () => {
  const dir = path.join(root, "supabase/migrations");
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
  assert.ok(files.length >= 1);
  files.forEach(f => assert.match(f, /^\d{14}_[a-z0-9_]+\.sql$/));
  const versions = files.flatMap(f => matches(fs.readFileSync(path.join(dir, f), "utf8"), /insert into public\.app_schema \(version\) values \((\d+)\)/g).map(Number));
  const need = Number(read("js/config.js").match(/REQUIRED_SCHEMA: (\d+)/)[1]);
  assert.equal(Math.max(...versions), need);
});

test("nenhum e-mail pessoal nem chave secreta no código versionado", () => {
  const scan = ["index.html", ...jsFiles, "README.md", "vercel.json", "docs/SECURITY.md"].filter(f => fs.existsSync(path.join(root, f)));
  for (const f of scan) {
    const s = read(f);
    assert.ok(!/@(gmail|hotmail|outlook)\.com/i.test(s), f + " contém e-mail pessoal");
    assert.ok(!/service_role|sb_secret_/i.test(s.replace(/service_role\)/g, "")) || f === "docs/SECURITY.md", f + " menciona chave secreta");
  }
});
