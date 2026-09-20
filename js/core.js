"use strict";
/* Núcleo: ambiente, cliente Supabase, estado, erros/observabilidade, UI básica, eventos delegados. */

const {
  esc, onlyDigits, pad, iso, isoOf, todayIso, dateObj, addDaysIso, isWeekendIso, monthOf, monthEnd, formatBRDate, formatTime,
  priceFor, pricingFromCreche, parseMoney, formatPhoneBr, formatCpfMask, formatCnpjMask, waLink
} = Pure;

/* ---------- ambiente + cliente ---------- */
const ENV = (function () {
  const cfg = window.APP_CONFIG, host = location.hostname;
  if (cfg.ENVS.production.hosts.includes(host)) return Object.assign({ name: "production" }, cfg.ENVS.production);
  if (cfg.ENVS.development.url) return Object.assign({ name: "development" }, cfg.ENVS.development);
  return Object.assign({ name: "production", shared: true }, cfg.ENVS.production);
})();
const sb = window.supabase.createClient(ENV.url, ENV.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
const BUCKET = "creche-anexos";
const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

/* ---------- estado global ---------- */
const S = {
  user: null, role: null, profile: null,
  creche: null,                    // tutor: creche vinculada | creche: a própria
  link: null,                      // tutor: linha de tutor_links
  pets: [], activePetId: null,
  records: {}, payments: [], customMessages: [], draft: "",
  checkins: [],                    // tutor: check-ins de hoje
  myAttendance: [], attByDay: {},  // tutor: presença confirmada pela creche
  pricing: Pure.DEFAULT_PRICING,
  _charges: null
};
function resetState() {
  Object.assign(S, {
    user: null, role: null, profile: null, creche: null, link: null, pets: [], activePetId: null,
    records: {}, payments: [], customMessages: [], draft: "", checkins: [], myAttendance: [], attByDay: {},
    pricing: Pure.DEFAULT_PRICING, _charges: null
  });
}

/* ---------- observabilidade: erros com código de correlação ---------- */
const SESSION_ID = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
let errCount = 0;
const errSeen = new Set();
/** Erro "de usuário": Error simples lançado por validação (sem code/status do Supabase e sem ser bug de JS). Não vai para o servidor. */
function isUserError(err) {
  return err instanceof Error && err.constructor === Error && !err.code && !err.status;
}
function logError(ctx, err) {
  const message = String((err && err.message) || err || "erro").slice(0, 900);
  if (isUserError(err)) { console.warn("[" + SESSION_ID.slice(0, 8) + "] " + ctx + ": " + message); return null; }
  console.error("[" + SESSION_ID.slice(0, 8) + "] " + ctx, err);
  const code = SESSION_ID.slice(0, 4) + "-" + (++errCount);
  const key = ctx + "|" + message;
  if (S.user && errCount <= 20 && !errSeen.has(key)) {
    errSeen.add(key);
    sb.from("client_errors").insert({
      user_id: S.user.id, session_id: SESSION_ID.slice(0, 64), ctx: String(ctx).slice(0, 120), message,
      stack: String((err && err.stack) || "").slice(0, 3900), url: location.pathname.slice(0, 300)
    }).then(() => {}, () => {});
  }
  return code;
}
window.addEventListener("error", e => logError("window.error", e.error || e.message));
window.addEventListener("unhandledrejection", e => logError("unhandledrejection", e.reason));

function friendlyError(err) {
  const m = String((err && err.message) || err || "");
  if (/failed to fetch|networkerror|load failed/i.test(m)) return "Sem conexão com a internet. Tente de novo.";
  if (err && (err.code === "42501" || /row-level security|permission denied/i.test(m))) return "Você não tem permissão para fazer isso.";
  if (err && err.code === "23505") return "Esse registro já existe.";
  if (err && err.status === 429) return "Muitas tentativas. Aguarde um pouco e tente de novo.";
  return m || "Algo deu errado.";
}
function notifyError(ctx, err, prefix) {
  const code = logError(ctx, err);
  toast((prefix ? prefix + " " : "") + friendlyError(err) + (code ? " (cód. " + code + ")" : ""), "err", 7000);
}
/** Lança o erro do Supabase, se houver; devolve os dados. */
function must(res) {
  if (res && res.error) { const e = new Error(res.error.message); e.code = res.error.code; e.status = res.status; throw e; }
  return res ? res.data : null;
}
/** Busca todas as linhas (o PostgREST corta em 1000). build() deve devolver uma query nova a cada chamada. */
async function fetchAll(build) {
  const out = [], size = 1000;
  for (let from = 0; from < 20000; from += size) {
    const rows = must(await build().range(from, from + size - 1)) || [];
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

/* ---------- toasts ---------- */
const toastActions = new Map();
function toast(msg, kind, ms, action) {
  const box = $("toasts");
  if (!box) return;
  const el = document.createElement("div");
  el.className = "toast " + (kind || "ok");
  el.setAttribute("role", kind === "err" ? "alert" : "status");
  const span = document.createElement("span");
  span.textContent = msg;
  el.appendChild(span);
  if (action) {
    const id = "t" + Math.random().toString(36).slice(2);
    toastActions.set(id, action.fn);
    const b = document.createElement("button");
    b.type = "button"; b.className = "toast-btn"; b.dataset.act = "toastAction"; b.dataset.id = id; b.textContent = action.label;
    el.appendChild(b);
  }
  box.appendChild(el);
  setTimeout(() => el.remove(), ms || 3500);
}

/* ---------- modal acessível (foco preso, Esc, retorno de foco) ---------- */
let modalReturnFocus = null, modalOnClose = null;
function openModal(title, html, opts) {
  modalReturnFocus = document.activeElement;
  modalOnClose = (opts && opts.onClose) || null;
  $("modalTitle").textContent = title;
  setHtml($("modalBody"), html);
  $("modal").classList.remove("hidden");
  document.body.classList.add("modal-open");
  const first = $("modal").querySelector("[autofocus], input, textarea, .option, .btn, button:not(.close)") || $("modal").querySelector(".close");
  if (first) setTimeout(() => first.focus(), 0);
}
function closeModal() {
  if ($("modal").classList.contains("hidden")) return;
  $("modal").classList.add("hidden");
  document.body.classList.remove("modal-open");
  const cb = modalOnClose; modalOnClose = null;
  if (cb) cb();
  if (modalReturnFocus && document.contains(modalReturnFocus)) modalReturnFocus.focus();
  modalReturnFocus = null;
}
document.addEventListener("keydown", e => {
  if ($("modal").classList.contains("hidden")) return;
  if (e.key === "Escape") { e.preventDefault(); closeModal(); return; }
  if (e.key !== "Tab") return;
  const f = [...$("modal").querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex='-1'])")].filter(x => x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
$("modal").addEventListener("click", e => { if (e.target === $("modal")) closeModal(); });

/** Diálogo de confirmação (Promise<boolean>). */
function confirmDialog(message, opts) {
  opts = opts || {};
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (done) return; done = true; dlgResolve = null; resolve(v); };
    dlgResolve = finish;
    openModal(opts.title || "Confirmar",
      `<p>${esc(message)}</p>
       <div class="row dlg-row">
         <button type="button" class="btn secondary" data-act="dlgAnswer" data-v="0">${esc(opts.cancelLabel || "Cancelar")}</button>
         <button type="button" class="btn ${opts.danger ? "danger" : "pink-btn"}" data-act="dlgAnswer" data-v="1" autofocus>${esc(opts.okLabel || "Confirmar")}</button>
       </div>`, { onClose: () => finish(false) });
  });
}
let dlgResolve = null;

/* ---------- imagens privadas (URLs assinadas) ---------- */
const urlCache = new Map();
async function signedUrl(path) {
  if (!path) return null;
  const hit = urlCache.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error || !data) return null;
  urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 3300 * 1000 });
  return data.signedUrl;
}
function imgHtml(path, alt) { return path ? `<img data-path="${esc(path)}" alt="${esc(alt || "")}">` : ""; }
function hydrateImages(root) {
  (root || document).querySelectorAll("img[data-path]:not([src])").forEach(async img => {
    const u = await signedUrl(img.dataset.path);
    if (u) img.src = u; else img.remove();
  });
}
function setHtml(el, html) { if (!el) return; el.innerHTML = html; hydrateImages(el); }
async function openAttachment(path) {
  const w = window.open("", "_blank");
  const u = await signedUrl(path);
  if (!u) { if (w) w.close(); throw new Error("Não consegui abrir o arquivo."); }
  if (w) { w.opener = null; w.location.href = u; } else location.href = u;
}

/* ---------- utilidades de UI ---------- */
function flashHint(id) {
  const el = $(id); if (!el) return;
  el.classList.remove("hidden");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), 2200);
}
const setVal = (id, v) => { const el = $(id); if (el) el.value = v == null ? "" : v; };
const getVal = id => { const el = $(id); return el ? el.value : ""; };
function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function maskPhoneInput(el) {
  const before = el.value, start = el.selectionStart;
  const digitsBefore = onlyDigits(before.slice(0, start)).length;
  el.value = formatPhoneBr(before);
  if (document.activeElement !== el) return;
  if (start >= before.length - 1) { el.setSelectionRange(el.value.length, el.value.length); return; }
  let seen = 0, pos = el.value.length;
  for (let i = 0; i < el.value.length; i++) if (/\d/.test(el.value[i]) && ++seen >= digitsBefore) { pos = i + 1; break; }
  try { el.setSelectionRange(pos, pos); } catch (e) { /* ignorar */ }
}

/* ---------- eventos delegados (sem onclick inline → CSP sem 'unsafe-inline') ---------- */
const ACTIONS = {}, INPUTS = {}, CHANGES = {}, SUBMITS = {};
function act(name, fn) { ACTIONS[name] = fn; }
function onInput(name, fn) { INPUTS[name] = fn; }
function onChange(name, fn) { CHANGES[name] = fn; }
function onSubmit(name, fn) { SUBMITS[name] = fn; }

document.addEventListener("click", async e => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) { console.warn("ação desconhecida:", el.dataset.act); return; }
  e.preventDefault();
  if (el.dataset.busy === "1") return;
  el.dataset.busy = "1"; el.setAttribute("aria-busy", "true");
  try { await fn(el, e); }
  catch (err) { notifyError(el.dataset.act, err); }
  finally { delete el.dataset.busy; el.removeAttribute("aria-busy"); }
});
document.addEventListener("input", e => {
  const el = e.target.closest("[data-input]");
  if (el && INPUTS[el.dataset.input]) { try { INPUTS[el.dataset.input](el, e); } catch (err) { logError("input:" + el.dataset.input, err); } }
});
document.addEventListener("change", async e => {
  const el = e.target.closest("[data-change]");
  if (!el || !CHANGES[el.dataset.change]) return;
  try { await CHANGES[el.dataset.change](el, e); } catch (err) { notifyError("change:" + el.dataset.change, err); }
});
document.addEventListener("submit", async e => {
  const form = e.target.closest("form[data-submit]");
  if (!form) return;
  e.preventDefault();
  const fn = SUBMITS[form.dataset.submit];
  if (!fn) return;
  const btn = form.querySelector("[type=submit]");
  if (btn) { if (btn.disabled) return; btn.disabled = true; }
  try { await fn(form, e); }
  catch (err) { notifyError("submit:" + form.dataset.submit, err); }
  finally { if (btn) btn.disabled = false; }
});

act("closeModal", () => closeModal());
act("dlgAnswer", el => { const r = dlgResolve; if (r) r(el.dataset.v === "1"); closeModal(); });   // resolve ANTES de fechar (onClose resolveria false)
act("toastAction", async el => {
  const fn = toastActions.get(el.dataset.id);
  toastActions.delete(el.dataset.id);
  el.closest(".toast").remove();
  if (fn) await fn();
});
act("togglePw", el => {
  const inp = $(el.dataset.target);
  const show = inp.type === "password";
  inp.type = show ? "text" : "password";
  el.setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha");
});
act("togglePanel", el => {
  const p = $(el.dataset.target);
  const open = p.classList.toggle("hidden") === false;
  el.setAttribute("aria-expanded", String(open));
});
onInput("phone", el => maskPhoneInput(el));
