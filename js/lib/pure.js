/* Funções puras (sem DOM, sem rede). Carregam no navegador (window.Pure) e no Node (require) para testes. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Pure = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- texto ---------- */
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"'`]/g, ch => ESC[ch]); }
  function onlyDigits(s) { return String(s || "").replace(/\D/g, ""); }

  /* ---------- datas (sempre no fuso local; nunca toISOString) ---------- */
  const pad = n => String(n).padStart(2, "0");
  function iso(y, m, d) { return `${y}-${pad(m + 1)}-${pad(d)}`; }
  function isoOf(date) { return iso(date.getFullYear(), date.getMonth(), date.getDate()); }
  function todayIso(now) { return isoOf(now || new Date()); }
  function dateObj(s) { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); }
  function addDaysIso(s, n) { const d = dateObj(s); d.setDate(d.getDate() + n); return isoOf(d); }
  function isWeekendIso(s) { const w = dateObj(s).getDay(); return w === 0 || w === 6; }
  function monthOf(s) { return String(s).slice(0, 7); }
  function monthEnd(ym) { const [y, m] = ym.split("-").map(Number); return ym + "-" + pad(new Date(y, m, 0).getDate()); }
  function formatBRDate(s) {
    if (!s) return "";
    const [y, m, d] = String(s).slice(0, 10).split("-");
    return d ? `${d}/${m}/${y.slice(2)}` : String(s);
  }
  function formatTime(isoTs) {
    if (!isoTs) return "";
    const d = new Date(isoTs);
    return isNaN(d) ? "" : pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  /* ---------- dinheiro e preços ---------- */
  const DEFAULT_PRICING = Object.freeze({ day: 40, over: 60, weekendDay: 0, weekendOver: 70 });
  const num = v => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
  function pricingFromCreche(c) {
    if (!c) return Object.assign({}, DEFAULT_PRICING);
    return {
      day: num(c.price_day) ?? DEFAULT_PRICING.day,
      over: num(c.price_over) ?? DEFAULT_PRICING.over,
      weekendDay: num(c.price_weekend_day) ?? DEFAULT_PRICING.weekendDay,
      weekendOver: num(c.price_weekend_over) ?? DEFAULT_PRICING.weekendOver
    };
  }
  /** state: 'was' (foi) | 'over' (pernoite) | 'not' | 'none'. Fim de semana sem pernoite usa weekendDay (padrão R$ 0). */
  function priceFor(dateStr, state, pricing) {
    const p = pricing || DEFAULT_PRICING;
    if (state === "was") return isWeekendIso(dateStr) ? p.weekendDay : p.day;
    if (state === "over") return isWeekendIso(dateStr) ? p.weekendOver : p.over;
    return 0;
  }
  function parseMoney(v, opts) {
    const allowZero = !!(opts && opts.allowZero);
    const s = String(v == null ? "" : v).trim().replace(/\s/g, "").replace("R$", "");
    if (!s) return { ok: false, msg: "Informe o valor." };
    const norm = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
    const n = Number(norm);
    if (!isFinite(n)) return { ok: false, msg: "Valor inválido." };
    if (n < 0 || (n === 0 && !allowZero)) return { ok: false, msg: allowZero ? "O valor não pode ser negativo." : "O valor precisa ser maior que zero." };
    if (n > 100000) return { ok: false, msg: "Valor alto demais. Confira." };
    return { ok: true, value: Math.round(n * 100) / 100 };
  }

  /* ---------- pagamentos: cobertura por data (paid_through) ---------- */
  function parsePaidThroughFromNote(note, paymentDate) {
    if (!note) return null;
    const m = String(note).match(/pago\s*at[eé]\s*(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/i);
    if (!m) return null;
    const day = Number(m[1]), month = Number(m[2]);
    let year = m[3] ? Number(m[3]) : (paymentDate ? Number(String(paymentDate).slice(0, 4)) : new Date().getFullYear());
    if (year < 100) year += 2000;
    if (!day || !month || month > 12 || day > 31) return null;
    return `${year}-${pad(month)}-${pad(day)}`;
  }
  function effectivePaidThrough(p) {
    if (!p) return null;
    return p.paid_through || parsePaidThroughFromNote(p.note, p.date);
  }
  /** Maior paid_through. onlyStatuses (opcional) restringe por status ('confirmado', …). */
  function maxPaidThrough(payments, onlyStatuses) {
    return (payments || []).reduce((max, p) => {
      if (onlyStatuses && !onlyStatuses.includes(p.status || "enviado")) return max;
      if (p.status === "recusado") return max;
      const pt = effectivePaidThrough(p);
      return pt && (!max || pt > max) ? pt : max;
    }, null);
  }
  /** charges: { 'YYYY-MM-DD': valor }. Devido em aberto = dias APÓS a cobertura. */
  function sumCharges(charges, opts) {
    opts = opts || {};
    let t = 0;
    for (const [day, v] of Object.entries(charges || {})) {
      if (opts.month && !day.startsWith(opts.month)) continue;
      if (opts.from && day < opts.from) continue;
      if (opts.to && day > opts.to) continue;
      if (opts.after && day <= opts.after) continue;
      t += v;
    }
    return Math.round(t * 100) / 100;
  }
  /** Quanto falta pagar para cobrir até `through`, dado o que já estava coberto até `alreadyThrough`. */
  function dueThrough(charges, alreadyThrough, through) {
    return sumCharges(charges, { after: alreadyThrough || undefined, to: through });
  }
  /** Até que dia `value` cobre as cobranças posteriores a `after`? -> { through, covered } */
  function coverageForValue(charges, after, value) {
    const days = Object.keys(charges || {}).filter(d => (!after || d > after) && charges[d] > 0).sort();
    let acc = 0, through = null;
    for (const d of days) {
      if (acc + charges[d] > value + 0.005) break;
      acc += charges[d]; through = d;
    }
    return { through, covered: Math.round(acc * 100) / 100 };
  }
  function monthStatus(owed, pending) {
    if (owed === 0) return "vazio";
    if (pending === 0) return "pago";
    return pending < owed ? "parcial" : "aberto";
  }

  /* ---------- validações (PIX, telefone, e-mail) ---------- */
  const isRepeated = d => /^(\d)\1+$/.test(d);
  function validateCPF(raw) {
    const cpf = onlyDigits(raw);
    if (cpf.length !== 11) return { ok: false, msg: "CPF precisa ter 11 dígitos." };
    if (isRepeated(cpf)) return { ok: false, msg: "CPF inválido (sequência repetida)." };
    const calc = (base, factor) => {
      let sum = 0;
      for (let i = 0; i < base.length; i++) sum += Number(base[i]) * (factor - i);
      const mod = (sum * 10) % 11;
      return mod === 10 ? 0 : mod;
    };
    if (calc(cpf.slice(0, 9), 10) !== Number(cpf[9]) || calc(cpf.slice(0, 10), 11) !== Number(cpf[10])) return { ok: false, msg: "CPF inválido." };
    return { ok: true, value: cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") };
  }
  function validateCNPJ(raw) {
    const cnpj = onlyDigits(raw);
    if (cnpj.length !== 14) return { ok: false, msg: "CNPJ precisa ter 14 dígitos." };
    if (isRepeated(cnpj)) return { ok: false, msg: "CNPJ inválido (sequência repetida)." };
    const calc = base => {
      const len = base.length, nums = base.split("").map(Number);
      let sum = 0, pos = len - 7;
      for (let i = len; i >= 1; i--) { sum += nums[len - i] * pos--; if (pos < 2) pos = 9; }
      const r = sum % 11;
      return r < 2 ? 0 : 11 - r;
    };
    const d1 = calc(cnpj.slice(0, 12)), d2 = calc(cnpj.slice(0, 12) + d1);
    if (d1 !== Number(cnpj[12]) || d2 !== Number(cnpj[13])) return { ok: false, msg: "CNPJ inválido." };
    return { ok: true, value: cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") };
  }
  function validateTelefone(raw) {
    const d = onlyDigits(raw);
    if (d.length < 10 || d.length > 11) return { ok: false, msg: "Telefone precisa ter DDD + número (10 ou 11 dígitos)." };
    const ddd = Number(d.slice(0, 2));
    if (ddd < 11 || ddd > 99) return { ok: false, msg: "DDD inválido." };
    if (d.length === 11 && d[2] !== "9") return { ok: false, msg: "Celular deve começar com 9 após o DDD." };
    return { ok: true, value: d.length === 10 ? d.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3") : d.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3") };
  }
  function validateEmail(raw) {
    const email = String(raw || "").trim();
    if (!email) return { ok: false, msg: "Informe o e-mail." };
    if (/\s/.test(email)) return { ok: false, msg: "E-mail não pode ter espaços." };
    if ((email.match(/@/g) || []).length !== 1) return { ok: false, msg: "E-mail precisa ter um único @." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email)) return { ok: false, msg: "E-mail em formato inválido." };
    return { ok: true, value: email.toLowerCase() };
  }
  function validatePixAleatoria(raw) {
    const v = String(raw || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)) return { ok: false, msg: "Chave aleatória deve ser um UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)." };
    return { ok: true, value: v.toLowerCase() };
  }
  function validatePixKey(type, raw) {
    switch (type) {
      case "CPF": return validateCPF(raw);
      case "CNPJ": return validateCNPJ(raw);
      case "Telefone": return validateTelefone(raw);
      case "E-mail": return validateEmail(raw);
      case "Aleatória": return validatePixAleatoria(raw);
      default: return { ok: false, msg: "Escolha o tipo da chave." };
    }
  }
  function validatePassword(pw) {
    const s = String(pw || "");
    if (s.length < 8) return { ok: false, msg: "A senha precisa ter pelo menos 8 caracteres." };
    if (!/[a-zA-Z]/.test(s) || !/\d/.test(s)) return { ok: false, msg: "Use letras e números na senha." };
    return { ok: true };
  }
  function validateUpload(file, opts) {
    opts = opts || {};
    const max = opts.maxBytes || 5 * 1024 * 1024;
    const types = opts.types || ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
    if (!file) return { ok: false, msg: "Nenhum arquivo." };
    if (!types.includes(file.type)) return { ok: false, msg: "Tipo não permitido. Envie foto (JPG, PNG, WEBP, HEIC) ou PDF." };
    if (file.size > max) return { ok: false, msg: `Arquivo grande demais (máx. ${Math.round(max / 1048576)} MB).` };
    return { ok: true };
  }
  function safeFileName(name) {
    const base = String(name || "arquivo").split(/[\\/]/).pop().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const ext = (base.match(/\.[a-zA-Z0-9]{1,5}$/) || [""])[0].toLowerCase();
    const stem = base.replace(/\.[^.]*$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "arquivo";
    return stem + ext;
  }

  /* ---------- máscaras ---------- */
  function formatPhoneBr(digits) {
    const d = onlyDigits(digits).slice(0, 11);
    if (!d) return "";
    if (d.length <= 2) return "(" + d;
    if (d.length <= 6) return "(" + d.slice(0, 2) + ") " + d.slice(2);
    if (d.length <= 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
    return "(" + d.slice(0, 2) + ") " + d.slice(2, 3) + " " + d.slice(3, 7) + "-" + d.slice(7, 11);
  }
  function formatCpfMask(raw) {
    const d = onlyDigits(raw).slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 6) return d.slice(0, 3) + "." + d.slice(3);
    if (d.length <= 9) return d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6);
    return d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6, 9) + "-" + d.slice(9);
  }
  function formatCnpjMask(raw) {
    const d = onlyDigits(raw).slice(0, 14);
    if (d.length <= 2) return d;
    if (d.length <= 5) return d.slice(0, 2) + "." + d.slice(2);
    if (d.length <= 8) return d.slice(0, 2) + "." + d.slice(2, 5) + "." + d.slice(5);
    if (d.length <= 12) return d.slice(0, 2) + "." + d.slice(2, 5) + "." + d.slice(5, 8) + "/" + d.slice(8);
    return d.slice(0, 2) + "." + d.slice(2, 5) + "." + d.slice(5, 8) + "/" + d.slice(8, 12) + "-" + d.slice(12);
  }

  /* ---------- WhatsApp ---------- */
  function waLink(phone, text) {
    let d = onlyDigits(phone);
    if (d.length === 10 || d.length === 11) d = "55" + d;
    const base = d.length >= 12 && d.length <= 13 ? "https://wa.me/" + d : "https://wa.me/";
    return base + "?text=" + encodeURIComponent(text || "");
  }
  function inviteMessage(crecheName, code, origin) {
    return `Oi! Use o Cãotrole para avisar a ${crecheName || "creche"} e acompanhar as idas do seu pet.\n` +
      `1) Crie sua conta: ${origin || ""}/tutor/cadastro\n2) Em Perfil → Creche, digite o código: ${code}`;
  }

  /* ---------- estado único do dia (board da creche) ---------- */
  const STATE_ORDER = ["presente", "avisou_vem", "esperado", "avisou_nao_vem", "saiu", "faltou"];
  const STATE_LABEL = {
    presente: "Presente", saiu: "Saiu", faltou: "Faltou",
    avisou_vem: "Avisou que vem", avisou_nao_vem: "Avisou que não vem", esperado: "Esperado"
  };
  /** Retorna o estado do pet HOJE ou null se não pertence ao board. */
  function petDayState(pet, checkin, attendance, dow) {
    if (attendance && attendance.status) return attendance.status;
    if (checkin && checkin.status === "coming") return "avisou_vem";
    const days = Array.isArray(pet.weekdays) ? pet.weekdays.map(Number) : [];
    const expected = days.length ? days.includes(dow) : !pet.tutor_user_id;
    if (checkin && checkin.status === "not_coming") return expected ? "avisou_nao_vem" : null;
    return expected ? "esperado" : null;
  }
  function boardCounts(items) {
    const c = { total: items.length, vem: 0, presente: 0, saiu: 0, faltou: 0, naoVem: 0 };
    for (const it of items) {
      if (it.state === "presente") c.presente++;
      else if (it.state === "saiu") c.saiu++;
      else if (it.state === "faltou") c.faltou++;
      else if (it.state === "avisou_nao_vem") c.naoVem++;
      else c.vem++;
    }
    return c;
  }
  const FILTERS = {
    todos: () => true,
    vem: it => ["esperado", "avisou_vem", "presente"].includes(it.state),
    presentes: it => it.state === "presente",
    faltas: it => it.state === "faltou" || it.state === "avisou_nao_vem"
  };
  /** Quais pets a ação em massa atinge (nunca quem avisou que não vem / faltou / já saiu). */
  function bulkTargets(items, action) {
    if (action === "presente") return items.filter(it => it.state === "esperado" || it.state === "avisou_vem");
    if (action === "saiu") return items.filter(it => it.state === "presente");
    return [];
  }

  /* ---------- CSV ---------- */
  function csvCell(v) {
    let s = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;           // evita injeção de fórmula no Excel
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(rows) { return rows.map(r => r.map(csvCell).join(";")).join("\n"); }

  return {
    esc, onlyDigits, pad, iso, isoOf, todayIso, dateObj, addDaysIso, isWeekendIso, monthOf, monthEnd, formatBRDate, formatTime,
    DEFAULT_PRICING, pricingFromCreche, priceFor, parseMoney,
    parsePaidThroughFromNote, effectivePaidThrough, maxPaidThrough, sumCharges, dueThrough, coverageForValue, monthStatus,
    validateCPF, validateCNPJ, validateTelefone, validateEmail, validatePixAleatoria, validatePixKey, validatePassword,
    validateUpload, safeFileName,
    formatPhoneBr, formatCpfMask, formatCnpjMask, waLink, inviteMessage,
    STATE_ORDER, STATE_LABEL, petDayState, boardCounts, FILTERS, bulkTargets,
    csvCell, toCsv
  };
});
