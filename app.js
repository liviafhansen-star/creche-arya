// ---- Conexão com o Supabase (banco de dados online) ----
const SUPABASE_URL = "https://svtlpvsfdmfdrgzhpbvz.supabase.co";
const SUPABASE_KEY = "sb_publishable_u1RNww4af2uybpEGbEicmw_Nh2cR_3R";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const BUCKET = "creche-anexos";

let currentUserId = null;

function isCrecheRole() {
  const role = (data.profile && data.profile.account_role) || (typeof pendingRole !== "undefined" ? pendingRole : "tutor") || "tutor";
  return role === "creche";
}
function clientsLsKey() { return "creche_clients_" + (currentUserId || "anon"); }
function attendanceLsKey() { return "creche_attendance_" + (currentUserId || "anon"); }
function loadClientsFallback() {
  try {
    const raw = localStorage.getItem(clientsLsKey());
    if (raw) { const parsed = JSON.parse(raw); if (Array.isArray(parsed) && (!data.profile.clients || !data.profile.clients.length)) data.profile.clients = parsed; }
  } catch (e) {}
  try {
    const rawA = localStorage.getItem(attendanceLsKey());
    if (rawA) { const parsedA = JSON.parse(rawA); if (parsedA && typeof parsedA === "object" && (!data.profile.attendance || !Object.keys(data.profile.attendance).length)) data.profile.attendance = parsedA; }
  } catch (e) {}
}

function emptyProfile(uid) {
  return {
    user_id: uid,
    name: "",
    days: [],
    weekday_overnight: "Não",
    weekend_overnight: "Não",
    pix_key: "",
    pix_type: "",
    pix_keys: [],
    account_role: "tutor",
    photo_path: null,
    birth_date: null,
    breed: "",
    owner1_name: "",
    owner1_contact: "",
    owner2_name: "",
    owner2_contact: "",
    clients: [],
    attendance: {},
    price_day: 40,
    price_over: 60
  };
}

async function getSessionUser() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session || !session.user) return null;
  currentUserId = session.user.id;
  return session.user;
}

async function ensureUserRows(user) {
  currentUserId = user.id;
  const { data: profileRow, error: pErr } = await sb.from("creche_profile").select("*").eq("user_id", user.id).maybeSingle();
  if (pErr) throw pErr;
  if (!profileRow || profileRow.user_id !== user.id) {
    const blank = emptyProfile(user.id);
    blank.account_role = pendingRole === "creche" ? "creche" : "tutor";
    const { error } = await sb.from("creche_profile").insert(blank);
    // ignore duplicate (already exists)
    if (error && !String(error.message || error).toLowerCase().includes("duplicate") && error.code != "23505") throw error;
  }
  const { data: msgRow, error: mErr } = await sb.from("creche_app_message").select("text").eq("user_id", user.id).maybeSingle();
  if (mErr) throw mErr;
  if (!msgRow) {
    const { error } = await sb.from("creche_app_message").insert({ user_id: user.id, text: "" });
    if (error && error.code != "23505" && !String(error.message || error).toLowerCase().includes("duplicate")) throw error;
  }
}

function petName() {
  return (data.profile && data.profile.name && data.profile.name.trim()) || "seu pet";
}

function updateChromeNames() {
  const creche = isCrecheRole();
  const name = (data.profile && data.profile.name && data.profile.name.trim()) || (creche ? "Minha creche" : "Meu pet");
  const header = document.getElementById("headerPetName");
  if (header) header.textContent = name;
  const dog = document.getElementById("dogName");
  if (dog && document.activeElement !== dog) dog.placeholder = "Nome do pet";
  const petMenu = document.querySelector(".pet-menu");
  if (petMenu) petMenu.setAttribute("aria-label", creche ? "Abrir perfil da creche" : "Abrir perfil");
}


let data = {
  profile: emptyProfile(null), records: {}, payments: [], customMessages: [],
  message: "Oii, chegamos daqui uns 5min com a Arya"
};
let viewDate = new Date(); viewDate.setDate(1);
const money = n => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);
const pad = n => String(n).padStart(2, "0");
function iso(y, m, d) { return `${y}-${pad(m + 1)}-${pad(d)}` }
function dateObj(s) { let [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d) }
function priceFor(s, state) { let d = dateObj(s), weekend = d.getDay() === 0 || d.getDay() === 6; if (state === "not" || state === "none") return 0; if (state === "over") return weekend ? 70 : 60; return weekend ? 0 : 40 }
function publicUrl(path) { return path ? sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null }

// ---- Carregar tudo do Supabase ----
async function resetLocalData(uid) {
  data.profile = emptyProfile(uid || null);
  data.records = {};
  data.payments = [];
  data.customMessages = [];
  data.message = "";
  openMonthsSelected = null;
}

async function loadAll() {
  const user = await getSessionUser();
  // Sempre zera memória local antes de buscar — evita “vazar” dados da sessão anterior
  resetLocalData(user && user.id);
  if (!user) { renderAll(); return; }
  try {
    await ensureUserRows(user);
    const uid = user.id;
    const results = await Promise.all([
      sb.from("creche_profile").select("*").eq("user_id", uid).maybeSingle(),
      sb.from("creche_app_message").select("text").eq("user_id", uid).maybeSingle(),
      sb.from("creche_records").select("date,status").eq("user_id", uid),
      sb.from("creche_payments").select("*").eq("user_id", uid).order("id", { ascending: true }),
      sb.from("creche_custom_messages").select("*").eq("user_id", uid).order("id", { ascending: true }),
    ]);
    for (const r of results) {
      if (r.error) throw r.error;
    }
    const [profileRes, msgRes, recordRes, paymentRes, customRes] = results;
    // Defesa: nunca aceitar linha de outro user_id
    const profileRow = profileRes.data && profileRes.data.user_id === uid ? profileRes.data : null;
    const recordRows = (recordRes.data || []).filter(r => true); // already filtered by query
    data.profile = profileRow || emptyProfile(uid);
        if (!data.profile.account_role) {
      data.profile.account_role = wantedLandingRole();
      await sb.from("creche_profile").update({ account_role: data.profile.account_role }).eq("user_id", uid);
    }
    const lockedRole = data.profile.account_role === "creche" ? "creche" : "tutor";
    const wantedRole = wantedLandingRole();
    if (lockedRole !== wantedRole) {
      await sb.auth.signOut();
      currentUserId = null;
      showLoginScreen();
      const errEl = document.getElementById("loginError");
      if (errEl) {
        errEl.textContent = roleMismatchMessage(lockedRole);
        errEl.classList.remove("hidden");
      }
      return;
    }
    pendingRole = lockedRole;
    localStorage.setItem("creche_pending_role", pendingRole);
    if (!Array.isArray(data.profile.clients)) data.profile.clients = [];
    if (!data.profile.attendance || typeof data.profile.attendance !== "object") data.profile.attendance = {};
    loadClientsFallback();
    if ((!data.profile.clients || !data.profile.clients.length)) {
      try {
        const raw = localStorage.getItem(clientsLsKey());
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length) data.profile.clients = parsed;
        }
      } catch (e) {}
    }
    data.message = (msgRes.data && msgRes.data.text) || "";
    data.records = {};
    recordRows.forEach(r => { data.records[r.date] = r.status; });
    data.payments = paymentRes.data || [];
    data.customMessages = customRes.data || [];
  } catch (err) {
    console.error(err);
    resetLocalData(user.id);
    alert("Não consegui carregar teus dados (isolamento por conta).\n(" + (err.message || err) + ")");
  }
  renderAll();
}


const SCREEN_PATH = { home: "/inicio", calendar: "/calendario", messages: "/mensagens", payments: "/pagamentos", profile: "/perfil", crecheFamilies: "/familias" };
const PATH_SCREEN = { "/": "home", "/inicio": "home", "/calendario": "calendar", "/mensagens": "messages", "/pagamentos": "payments", "/perfil": "profile", "/familias": "crecheFamilies", "/cadastro": null };

function currentPath() {
  return (location.pathname.replace(/\/$/, "") || "/");
}
function screenFromPath() {
  const p = currentPath();
  if (p === "/cadastro") return null;
  return PATH_SCREEN[p] || PATH_SCREEN["/"] || "home";
}
function setScreenRoute(id, opts) {
  opts = opts || {};
  if (id === "home" || id === "calendar" || id === "messages" || id === "payments" || id === "profile" || id === "crecheFamilies") {
    const want = SCREEN_PATH[id] || "/inicio";
    if (currentPath() !== want) {
      history[opts.replace ? "replaceState" : "pushState"]({ screen: id }, "", want);
    }
  }
}

function go(id, opts) {
  opts = opts || {};
  if (isCrecheRole() && id === "messages" && opts.fromNav) id = "crecheFamilies";
  const el = document.getElementById(id);
  if (!el) return;
  document.querySelectorAll(".screen").forEach(x => x.classList.remove("active"));
  el.classList.add("active");
  document.querySelectorAll(".nav button").forEach(x => {
    const match = x.dataset.screen === id || (id === "home" && x.dataset.screen === "home");
    x.classList.toggle("active", match);
  });
  if (!opts.skipRoute) setScreenRoute(id, { replace: !!opts.replace });
  renderAll();
  scrollTo(0, 0);
}

function renderAll() { applyRoleLayout(); renderHome(); renderOpenMonths(); renderCalendar(); renderProfile(); renderPayments(); renderSavedMessages(); renderCrecheToday(); renderCrecheFamilies(); renderCrecheProfile(); updateChromeNames(); updateBrandForRole(); const mt = document.getElementById("messageText"); if (mt) mt.value = data.message || ""; updateQuickLabels(); }

let openMonthsSelected = null;
const MESES_ABREV = ["Jan.", "Fev.", "Mar.", "Abr.", "Mai.", "Jun.", "Jul.", "Ago.", "Set.", "Out.", "Nov.", "Dez."];

function monthLastDate(ym) {
  const parts = ym.split("-").map(Number);
  const y = parts[0], m = parts[1];
  const last = new Date(y, m, 0).getDate();
  return ym + "-" + pad(last);
}
function isDatePaid(s) {
  const pt = maxPaidThrough();
  return !!(pt && s <= pt);
}
function monthOwedAmount(ym) {
  let o = 0;
  Object.entries(data.records).forEach(([s, r]) => { if (s.startsWith(ym)) o += priceFor(s, r); });
  return o;
}
/** Pendente do mês: idas ainda não cobertas pelo paid_through */
function monthPendingAmount(ym) {
  let pending = 0;
  Object.entries(data.records).forEach(([s, r]) => {
    if (!s.startsWith(ym)) return;
    if (isDatePaid(s)) return;
    pending += priceFor(s, r);
  });
  return pending;
}
function monthIsPago(ym) {
  const owed = monthOwedAmount(ym);
  return owed > 0 && monthPendingAmount(ym) === 0;
}

function computeYearSummary() {
  const year = new Date().getFullYear();
  return Array.from({ length: 12 }, (_, i) => {
    const ym = `${year}-${pad(i + 1)}`;
    const owed = monthOwedAmount(ym);
    const pending = monthPendingAmount(ym);
    const paid = Math.max(0, owed - pending);
    return { ym, label: MESES_ABREV[i], owed, paid, pending, isPago: monthIsPago(ym) };
  });
}
function renderOpenMonths() {
  const summary = computeYearSummary();
  if (openMonthsSelected === null) openMonthsSelected = new Set(summary.filter(m => m.pending > 0).map(m => m.ym));
  const el = document.getElementById("monthChips");
  el.innerHTML = summary.map(m => `
    <button class="month-chip ${m.pending > 0 ? "has-pending" : ""} ${openMonthsSelected.has(m.ym) ? "selected" : ""}" onclick="toggleOpenMonth('${m.ym}')">
      <b>${m.label}</b>${m.pending > 0 ? `<small>${money(m.pending)}</small>` : ""}
    </button>`).join("");
  const total = summary.filter(m => openMonthsSelected.has(m.ym)).reduce((a, m) => a + m.pending, 0);
  document.getElementById("openTotal").textContent = money(total);
  const lbl = document.getElementById("homeMonthsLabel");
  if (lbl) lbl.textContent = openMonthsSelected.size === 0 ? "Nenhum mês selecionado" : `${openMonthsSelected.size} ${openMonthsSelected.size === 1 ? "mês selecionado" : "meses selecionados"}`;
}
function toggleOpenMonth(ym) { openMonthsSelected.has(ym) ? openMonthsSelected.delete(ym) : openMonthsSelected.add(ym); renderOpenMonths() }
function toggleHomeMonths() {
  const panel = document.getElementById("homeMonthsPanel");
  const wasHidden = panel.classList.contains("hidden");
  panel.classList.toggle("hidden");
  document.getElementById("homeMonthsArrow").textContent = wasHidden ? "▴" : "▾";
}

function updateQuickLabels() {
  const n = petName();
  const map = [
    ["quickTakeLabel", "Levar " + n],
    ["quickPickupLabel", "Buscar " + n],
  ];
  map.forEach(([id, text]) => { const el = document.getElementById(id); if (el) el.textContent = text; });
  const header = document.getElementById("headerPetName");
  if (header) header.textContent = (data.profile && data.profile.name && data.profile.name.trim()) || "Meu pet";
}
function renderHome() {
  const now = new Date();
  let ym = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`, total = 0, count = 0;
  Object.entries(data.records).forEach(([s, r]) => { if (s.startsWith(ym)) { total += priceFor(s, r); if (r !== "none" && r !== "not") count++ } });
  const pending = monthPendingAmount(ym);
  document.getElementById("monthTotal").textContent = money(pending);
  document.getElementById("monthStatus").textContent = `${count} ida${count === 1 ? "" : "s"} registrada${count === 1 ? "" : "s"}`;
  const statusEl = document.getElementById("monthPaymentStatus");
  const pago = monthIsPago(ym);
  statusEl.textContent = total === 0 ? "Sem lançamentos" : (pago ? "Pago" : (pending > 0 && pending < total ? "Parcial" : "Não Pago"));
  statusEl.className = "payment-badge " + (pago ? "paid" : "unpaid");
  const coverEl = document.getElementById("homePaymentCover");
  if (coverEl) {
    const label = paymentCoverageLabel(ym);
    coverEl.textContent = label || (total === 0 ? "" : "Nenhuma cobertura de pagamento neste mês");
    coverEl.classList.toggle("hidden", !coverEl.textContent);
  }
  updateHeroDogPhoto();
  let el = document.getElementById("nextTrips"), dates = [];
  let today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = 0; i < 21; i++) { let d = new Date(today); d.setDate(today.getDate() + i); let s = iso(d.getFullYear(), d.getMonth(), d.getDate()); let dow = d.getDay(); if (data.profile.days.includes(dow)) dates.push({ s, d }) }
  el.innerHTML = dates.slice(0, 5).map(x => `<div class="trip"><div><b>${x.d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })}</b><small>${data.records[x.s] && data.records[x.s] !== "none" ? "Registrado" : "Ainda não registrado"}</small></div><span class="amount">${data.records[x.s] ? money(priceFor(x.s, data.records[x.s])) : "—"}</span></div>`).join("") || "<div class='trip'>Nenhuma ida configurada.</div>"
}
function parsePaidThroughFromNote(note, paymentDate) {
  if (!note) return null;
  const m = String(note).match(/pago\s*at[eé]\s*(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/i);
  if (!m) return null;
  const day = Number(m[1]), month = Number(m[2]);
  let year;
  if (m[3]) {
    year = Number(m[3]);
    if (year < 100) year += 2000;
  } else {
    year = paymentDate ? Number(String(paymentDate).slice(0, 4)) : new Date().getFullYear();
  }
  if (!day || !month || month > 12 || day > 31) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** paid_through explícito, senão tenta extrair da nota (ex.: "pago até 16.09") */
function effectivePaidThrough(p) {
  if (!p) return null;
  if (p.paid_through) return p.paid_through;
  return parsePaidThroughFromNote(p.note, p.date);
}

function maxPaidThrough() {
  return data.payments.reduce((max, p) => {
    const pt = effectivePaidThrough(p);
    return (pt && (!max || pt > max)) ? pt : max;
  }, null);
}

function paymentCoveringMonth(ym) {
  const monthStart = ym + "-01";
  let best = null;
  data.payments.forEach(p => {
    const pt = effectivePaidThrough(p);
    if (!pt) return;
    if (pt < monthStart) return;
    if (!best || pt > effectivePaidThrough(best) || (pt === effectivePaidThrough(best) && p.date > best.date)) best = p;
  });
  if (!best) {
    const inMonth = data.payments.filter(p => p.date && p.date.startsWith(ym)).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    if (inMonth.length) best = inMonth[0];
  }
  return best;
}

function formatBRDate(isoDate) {
  if (!isoDate) return "";
  const [y, m, d] = String(isoDate).slice(0, 10).split("-");
  if (!d) return isoDate;
  return `${d}/${m}/${y.slice(2)}`;
}

function paymentCoverageLabel(ym) {
  const p = paymentCoveringMonth(ym);
  if (!p) return "";
  const pt = effectivePaidThrough(p);
  const when = formatBRDate(p.date);
  if (pt) return `Pago em ${when} · cobre até ${formatBRDate(pt)}`;
  return when ? `Pagamento registrado em ${when}` : "";
}

function updateHeroDogPhoto() {
  const wrap = document.getElementById("heroDog");
  if (!wrap) return;
  const path = data.profile && data.profile.photo_path;
  if (path) {
    const url = publicUrl(path);
    wrap.innerHTML = `<img src="${url}" alt="">`;
    wrap.classList.remove("hidden");
  } else {
    wrap.innerHTML = "";
    wrap.classList.add("hidden");
  }
}

function renderCalendar() {
  const y = viewDate.getFullYear(), m = viewDate.getMonth(), title = viewDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  document.getElementById("calendarTitle").textContent = title.charAt(0).toUpperCase() + title.slice(1);
  const grid = document.getElementById("calendarGrid"); let html = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(x => `<div class="dow">${x}</div>`).join("");
  let first = new Date(y, m, 1).getDay(), last = new Date(y, m + 1, 0).getDate();
  const paidThrough = maxPaidThrough();
  let monthOwed = 0, monthPaid = 0;
  const ym = `${y}-${pad(m + 1)}`;
  for (let i = 0; i < first; i++) html += "<div class='day empty'></div>";
  const payDates = new Set(
    (data.payments || [])
      .map(p => p.date && String(p.date).slice(0, 10))
      .filter(Boolean)
  );
  for (let d = 1; d <= last; d++) {
    let s = iso(y, m, d), r = data.records[s] || "none";
    monthOwed += priceFor(s, r);
    const billable = r === "was" || r === "over";
    const isPaid = billable && paidThrough && s <= paidThrough;
    const isOpen = billable && !isPaid;
    let cl = "";
    if (r === "not") cl = "not";
    else if (isPaid) cl = r === "over" ? "over paid-day" : "was paid-day";
    else if (isOpen) cl = r === "over" ? "over open-day" : "was open-day";
    else if (r === "over") cl = "over";
    else if (r === "was") cl = "was";
    const isPayReg = payDates.has(s);
    if (isPayReg) cl = (cl + " pay-reg").trim();
    const badges = [];
    if (isPaid) badges.push('<div class="paid-badge" title="Dia coberto pelo pagamento">💰</div>');
    if (isPayReg) badges.push('<div class="pay-reg-badge" title="Pagamento registrado neste dia">💳</div>');
    let stateLabel = "—";
    if (r === "was") stateLabel = isOpen ? "FOI (em aberto)" : "FOI";
    else if (r === "over") stateLabel = isOpen ? "PERNOITE (em aberto)" : "PERNOITE";
    else if (r === "not") stateLabel = "NÃO FOI";
    else if (isPayReg) stateLabel = "PAGOU";
    html += `<button class="day ${cl}" onclick="editDay('${s}')"><div class="num">${d}</div>${badges.join("")}<div class="state">${stateLabel}</div></button>`;
  }
  grid.innerHTML = html;
  document.getElementById("calendarMonthTotal").textContent = money(monthOwed);
  const csEl = document.getElementById("calendarMonthState");
  const monthPago = monthIsPago(ym);
  const pendingCal = monthPendingAmount(ym);
  csEl.textContent = monthOwed === 0 ? "Sem lançamentos" : monthPago ? "Pago" : (pendingCal > 0 && pendingCal < monthOwed ? "Parcial" : "Pendente");
  csEl.className = "payment-badge " + (monthPago ? "paid" : "unpaid");
  const infoEl = document.getElementById("calendarPaymentInfo");
  if (infoEl) {
    const label = paymentCoverageLabel(ym);
    infoEl.textContent = label || (monthOwed === 0 ? "" : "Sem data de pagamento para este mês");
    infoEl.classList.toggle("hidden", !infoEl.textContent);
  }
}
function changeMonth(n) { viewDate.setMonth(viewDate.getMonth() + n); renderAll() }
function editDay(s) { let d = dateObj(s); openModal(`Registrar ${d.toLocaleDateString("pt-BR")}`, `
<button class="option" onclick="setDay('${s}','was')"><strong>🟢 Foi</strong><small>${money(priceFor(s, "was"))}</small></button>
<button class="option" onclick="setDay('${s}','over')"><strong>🛏️ Foi + pernoite</strong><small>${money(priceFor(s, "over"))}</small></button>
<button class="option" onclick="setDay('${s}','not')"><strong>🔴 Não foi</strong><small>R$ 0,00</small></button>
<button class="option" onclick="setDay('${s}','none')"><strong>⚪ Não definido</strong><small>Sem cobrança</small></button>`) }
async function setDay(s, r) {
  closeModal();
  try {
    if (r === "none") {
      const { error } = await sb.from("creche_records").delete().eq("user_id", currentUserId).eq("date", s);
      if (error) throw error;
      delete data.records[s];
    } else {
      const { error } = await sb.from("creche_records").upsert({ user_id: currentUserId, date: s, status: r }, { onConflict: "user_id,date" });
      if (error) throw error;
      data.records[s] = r;
    }
  } catch (err) {
    console.error(err);
    alert("Não consegui salvar esse dia. Confira sua internet e tenta de novo.\n(" + (err.message || err) + ")");
  }
  renderAll();
}
function prepareMessage(type) {
  const n = petName();
  let msg = { take: `Oii, chegamos daqui uns 5min com a ${n}`, pickup: `Oii, estamos indo buscar a ${n} 😊`, notgo: `Oii, hoje a ${n} não vai para a creche.` }[type];
  data.message = msg; saveMessageText(msg); go("messages"); setTimeout(analyzeMessage, 50);
}
function newMessage() {
  openModal("Nova mensagem", `
    <label>Nome da mensagem<input id="newMsgName" placeholder="Chegada mais cedo"></label>
    <label>Texto<textarea id="newMsgText" rows="5" placeholder="Digite a mensagem que deseja salvar"></textarea></label>
    <button class="btn pink-btn full" onclick="saveNewMessage()">✓ Salvar mensagem</button>
  `);
}
async function saveNewMessage() {
  const name = document.getElementById("newMsgName").value.trim();
  const text = document.getElementById("newMsgText").value.trim();
  if (!name || !text) { alert("Preencha o nome e o texto da mensagem."); return }
  await sb.from("creche_custom_messages").insert({ user_id: currentUserId, name, text });
  closeModal(); await loadAll(); go("messages");
}
async function useCustomMessage(id) {
  const m = data.customMessages.find(x => x.id === id); if (!m) return;
  data.message = m.text; await saveMessageText(m.text); go("messages"); setTimeout(analyzeMessage, 50);
}
async function deleteCustomMessage(id) {
  await sb.from("creche_custom_messages").delete().eq("id", id);
  data.customMessages = data.customMessages.filter(x => x.id !== id); renderAll();
}
async function saveMessageText(t) { data.message = t; await sb.from("creche_app_message").upsert({ user_id: currentUserId, text: t }, { onConflict: "user_id" }) }
function analyzeMessage() { let t = document.getElementById("messageText").value.trim(); saveMessageText(t); let low = t.toLowerCase(), status = low.includes("não vai") || low.includes("nao vai") ? "❌ Não vai" : (low.includes("cheg") || low.includes("com a arya")) ? "🐶 Levar pet" : "❓ Não identifiquei a ação"; document.getElementById("analysis").classList.remove("hidden"); document.getElementById("analysis").innerHTML = `<b>Entendi:</b> ${status}<br><span>Tu ainda pode editar a mensagem antes de enviar.</span>` }
function sendWhatsApp() { let t = document.getElementById("messageText").value.trim(); saveMessageText(t); let text = encodeURIComponent(t); window.location.href = `https://wa.me/?text=${text}` }


const PIX_TYPES = ["CPF", "CNPJ", "Telefone", "E-mail", "Aleatória"];
let pixDraftType = "Telefone";
let selectedPixId = null;
let editingPixId = null;

function getPixKeys() {
  const p = data.profile || {};
  let keys = Array.isArray(p.pix_keys) ? p.pix_keys.slice() : [];
  if (!keys.length && p.pix_key) {
    keys = [{ id: "legacy", type: p.pix_type || "Telefone", key: p.pix_key }];
  }
  return keys;
}

function renderPixTypeChips() {
  const el = document.getElementById("pixTypeChips");
  if (!el) return;
  el.innerHTML = PIX_TYPES.map(t =>
    `<button type="button" class="${pixDraftType === t ? "on" : ""}" onclick="setPixDraftType('${t}')">${t === "Aleatória" ? "Aleatória" : t}</button>`
  ).join("");
}

function setPixDraftType(t) {
  pixDraftType = t;
  renderPixTypeChips();
  syncPixInputMode();
}

function renderPixKeys() {
  renderPixTypeChips();
  syncPixInputMode();
  const list = document.getElementById("pixKeysList");
  const actions = document.getElementById("pixKeyActions");
  if (!list) return;
  const keys = getPixKeys();
  if (!keys.length) {
    list.innerHTML = "<small>Nenhuma chave salva ainda.</small>";
    if (actions) actions.classList.add("hidden");
    selectedPixId = null;
    return;
  }
  if (!selectedPixId || !keys.some(k => k.id === selectedPixId)) selectedPixId = keys[0].id;
  list.innerHTML = keys.map(k => `
    <button type="button" class="pix-key-card ${k.id === selectedPixId ? "selected" : ""}" onclick="selectPixKey('${k.id}')">
      <span class="pix-type-badge">${k.type || "PIX"}</span>
      <span class="pix-key-val">${k.key || ""}</span>
    </button>`).join("");
  if (actions) actions.classList.remove("hidden");
}

function selectPixKey(id) {
  selectedPixId = id;
  renderPixKeys();
}

async function persistPixKeys(keys) {
  data.profile.pix_keys = keys;
  const sel = keys.find(k => k.id === selectedPixId) || keys[0] || null;
  data.profile.pix_key = sel ? sel.key : "";
  data.profile.pix_type = sel ? sel.type : "";
  const payload = { pix_keys: keys, pix_key: data.profile.pix_key, pix_type: data.profile.pix_type };
  const { error } = await sb.from("creche_profile").update(payload).eq("user_id", currentUserId);
  if (error) {
    // fallback se coluna pix_keys ainda não existir
    const { error: e2 } = await sb.from("creche_profile").update({ pix_key: data.profile.pix_key, pix_type: data.profile.pix_type }).eq("user_id", currentUserId);
    if (e2) throw e2;
    alert("Salvei a chave principal. Para várias chaves, rode o SQL add-pix-keys.sql no Supabase.");
  }
}


function onlyDigits(s) { return String(s || "").replace(/\D/g, ""); }

function isRepeatedDigits(d) { return /^(\d)\1+$/.test(d); }

function validateCPF(raw) {
  const cpf = onlyDigits(raw);
  if (cpf.length !== 11) return { ok: false, msg: "CPF precisa ter 11 dígitos." };
  if (isRepeatedDigits(cpf)) return { ok: false, msg: "CPF inválido (sequência repetida)." };
  const calc = (base, factor) => {
    let sum = 0;
    for (let i = 0; i < base.length; i++) sum += Number(base[i]) * (factor - i);
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };
  const d1 = calc(cpf.slice(0, 9), 10);
  const d2 = calc(cpf.slice(0, 10), 11);
  if (d1 !== Number(cpf[9]) || d2 !== Number(cpf[10])) return { ok: false, msg: "CPF inválido." };
  const fmt = cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return { ok: true, value: fmt };
}

function validateCNPJ(raw) {
  const cnpj = onlyDigits(raw);
  if (cnpj.length !== 14) return { ok: false, msg: "CNPJ precisa ter 14 dígitos." };
  if (isRepeatedDigits(cnpj)) return { ok: false, msg: "CNPJ inválido (sequência repetida)." };
  const calc = (base) => {
    let len = base.length;
    let nums = base.split("").map(Number);
    let sum = 0, pos = len - 7;
    for (let i = len; i >= 1; i--) {
      sum += nums[len - i] * pos--;
      if (pos < 2) pos = 9;
    }
    const res = sum % 11;
    return res < 2 ? 0 : 11 - res;
  };
  const d1 = calc(cnpj.slice(0, 12));
  const d2 = calc(cnpj.slice(0, 12) + String(d1));
  if (d1 !== Number(cnpj[12]) || d2 !== Number(cnpj[13])) return { ok: false, msg: "CNPJ inválido." };
  const fmt = cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return { ok: true, value: fmt };
}

/** Telefone BR: 10 dígitos (fix) ou 11 (celular com 9) */
function validateTelefone(raw) {
  const d = onlyDigits(raw);
  if (d.length < 10 || d.length > 11) return { ok: false, msg: "Telefone precisa ter DDD + número (10 ou 11 dígitos)." };
  const ddd = Number(d.slice(0, 2));
  if (ddd < 11 || ddd > 99) return { ok: false, msg: "DDD inválido." };
  if (d.length === 11 && d[2] !== "9") return { ok: false, msg: "Celular deve começar com 9 após o DDD." };
  if (d.length === 10) {
    const fmt = d.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
    return { ok: true, value: fmt };
  }
  const fmt = d.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  return { ok: true, value: fmt };
}

function validateEmail(raw) {
  const email = String(raw || "").trim();
  if (!email) return { ok: false, msg: "Informe o e-mail." };
  if (/\s/.test(email)) return { ok: false, msg: "E-mail não pode ter espaços." };
  if ((email.match(/@/g) || []).length !== 1) return { ok: false, msg: "E-mail precisa ter um único @." };
  // sintaxe básica usuario@dominio.tld
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
  if (!re.test(email)) return { ok: false, msg: "E-mail em formato inválido." };
  return { ok: true, value: email.toLowerCase() };
}

function validatePixAleatoria(raw) {
  const v = String(raw || "").trim();
  // chave aleatória EVP: UUID
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(v)) return { ok: false, msg: "Chave aleatória deve ser um UUID (ex.: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)." };
  return { ok: true, value: v.toLowerCase() };
}

function validatePixKey(type, raw) {
  if (type === "CPF") return validateCPF(raw);
  if (type === "CNPJ") return validateCNPJ(raw);
  if (type === "Telefone") return validateTelefone(raw);
  if (type === "E-mail") return validateEmail(raw);
  if (type === "Aleatória") return validatePixAleatoria(raw);
  return { ok: false, msg: "Escolhe o tipo da chave." };
}

async function savePixKey() {
  const input = document.getElementById("pixKeyInput");
  const raw = (input && input.value || "").trim();
  if (!raw) { alert("Digite a chave PIX."); return }
  if (!pixDraftType) { alert("Escolhe o tipo da chave."); return }
  const check = validatePixKey(pixDraftType, raw);
  if (!check.ok) { alert(check.msg); return }
  const key = check.value;
  let keys = getPixKeys().filter(k => k.id !== "legacy" || editingPixId === "legacy");
  if (editingPixId) {
    keys = keys.map(k => k.id === editingPixId ? { ...k, type: pixDraftType, key } : k);
    selectedPixId = editingPixId;
    editingPixId = null;
    const btn = document.getElementById("savePixBtn");
    if (btn) btn.textContent = "Salvar";
  } else {
    const id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
    keys.push({ id, type: pixDraftType, key });
    selectedPixId = id;
  }
  if (input) input.value = "";
  try {
    await persistPixKeys(keys);
  } catch (err) {
    alert("Não consegui salvar a chave.\\n(" + (err.message || err) + ")");
    return;
  }
  renderPixKeys();
}

function copySelectedPix() {
  const k = getPixKeys().find(x => x.id === selectedPixId);
  if (!k || !k.key) { alert("Nenhuma chave selecionada."); return }
  const ok = () => alert("Chave copiada!");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(k.key).then(ok).catch(() => alert("Chave: " + k.key));
  } else alert("Chave: " + k.key);
}

function editSelectedPix() {
  const k = getPixKeys().find(x => x.id === selectedPixId);
  if (!k) return;
  editingPixId = k.id;
  pixDraftType = k.type || "Telefone";
  const input = document.getElementById("pixKeyInput");
  if (input) input.value = k.key || "";
  const btn = document.getElementById("savePixBtn");
  if (btn) btn.textContent = "Atualizar";
  renderPixTypeChips();
  if (input) input.focus();
}

async function deleteSelectedPix() {
  if (!selectedPixId) return;
  if (!confirm("Excluir esta chave PIX?")) return;
  const keys = getPixKeys().filter(k => k.id !== selectedPixId);
  selectedPixId = keys[0] ? keys[0].id : null;
  editingPixId = null;
  const input = document.getElementById("pixKeyInput");
  if (input) input.value = "";
  const btn = document.getElementById("savePixBtn");
  if (btn) btn.textContent = "Salvar";
  try {
    await persistPixKeys(keys);
  } catch (err) {
    alert("Não consegui excluir.\\n(" + (err.message || err) + ")");
    return;
  }
  renderPixKeys();
}

function onPaymentFileChange() {
  const f = document.getElementById("paymentFile");
  const name = document.getElementById("paymentFileName");
  const clear = document.getElementById("paymentFileClear");
  const file = f && f.files && f.files[0];
  if (name) name.textContent = file ? file.name : "Nenhum arquivo escolhido";
  if (clear) clear.classList.toggle("hidden", !file);
}

function clearPaymentFile() {
  const f = document.getElementById("paymentFile");
  if (f) f.value = "";
  onPaymentFileChange();
}

function renderProfile() {
  let p = data.profile;
  document.getElementById("dogName").value = p.name || "";
  updateChromeNames();
  renderPixKeys();
  document.getElementById("birthDate").value = p.birth_date || "";
  document.getElementById("breed").value = p.breed || "";
  document.getElementById("owner1Name").value = p.owner1_name || "";
  document.getElementById("owner1Contact").value = p.owner1_contact ? formatPhoneBr(p.owner1_contact) : "";
  document.getElementById("owner2Name").value = p.owner2_name || "";
  document.getElementById("owner2Contact").value = p.owner2_contact ? formatPhoneBr(p.owner2_contact) : "";
  renderOvernightGroup("weekday", p.weekday_overnight);
  renderOvernightGroup("weekend", p.weekend_overnight);
  let names = ["D", "S", "T", "Q", "Q", "S", "S"];
  document.getElementById("days").innerHTML = names.map((n, i) => `<button class="${p.days.includes(i) ? "on" : ""}" onclick="toggleDay(${i})">${n}</button>`).join("");
  const ph = document.getElementById("profilePhoto"), ha = document.getElementById("headerAvatar");
  if (p.photo_path) { const url = publicUrl(p.photo_path); ph.innerHTML = `<img src="${url}">`; ha.innerHTML = `<img src="${url}">` }
}
function renderOvernightGroup(which, value) {
  const group = document.getElementById(which + "OvernightGroup");
  if (!group) return;
  group.querySelectorAll("button").forEach(btn => btn.classList.toggle("on", btn.textContent === value));
}
async function setOvernight(which, value) {
  data.profile[which + "_overnight"] = value;
  renderOvernightGroup(which, value);
  const col = which + "_overnight";
  await sb.from("creche_profile").update({ [col]: value }).eq("user_id", currentUserId);
}
function switchProfileTab(tab) {
  document.querySelectorAll(".ptab").forEach(b => b.classList.toggle("active", b.dataset.ptab === tab));
  document.getElementById("profileArya").classList.toggle("hidden", tab !== "arya");
  document.getElementById("profileDonos").classList.toggle("hidden", tab !== "donos");
}
async function toggleDay(i) { let a = data.profile.days; data.profile.days = a.includes(i) ? a.filter(x => x !== i) : [...a, i]; await sb.from("creche_profile").update({ days: data.profile.days }).eq("user_id", currentUserId); renderProfile() }

function flashHint(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("hidden");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), 1800);
}
async function savePetName() {
  const p = data.profile;
  p.name = document.getElementById("dogName").value.trim();
  const { error } = await sb.from("creche_profile").update({ name: p.name }).eq("user_id", currentUserId);
  if (error) { alert("Não consegui salvar o nome.\\n(" + (error.message || error) + ")"); return }
  updateChromeNames();
  updateQuickLabels();
  flashHint("petSaveHint");
}
async function savePetDetails() {
  const p = data.profile;
  p.birth_date = document.getElementById("birthDate").value || null;
  p.breed = document.getElementById("breed").value;
  const { error } = await sb.from("creche_profile").update({ birth_date: p.birth_date, breed: p.breed }).eq("user_id", currentUserId);
  if (error) { alert("Não consegui salvar os detalhes.\\n(" + (error.message || error) + ")"); return }
  flashHint("detailsSaveHint");
}

/** Máscara BR: (51) 3333-4444 ou (51) 9 9894-0123 */
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
function maskOwnerPhone(el) {
  if (!el) return;
  const before = el.value;
  const start = el.selectionStart;
  const digitsBeforeCaret = onlyDigits(before.slice(0, start)).length;
  el.value = formatPhoneBr(el.value);
  if (document.activeElement === el) {
    if (start >= before.length - 1) el.setSelectionRange(el.value.length, el.value.length);
    else {
      let seen = 0, pos = el.value.length;
      for (let i = 0; i < el.value.length; i++) {
        if (/\d/.test(el.value[i])) {
          seen++;
          if (seen >= digitsBeforeCaret) { pos = i + 1; break; }
        }
      }
      try { el.setSelectionRange(pos, pos); } catch (e) {}
    }
  }
}
function validateOwnerPhoneOptional(raw, label) {
  const t = String(raw || "").trim();
  if (!t) return { ok: true, value: "" };
  const check = validateTelefone(t);
  if (!check.ok) return { ok: false, msg: label + ": " + check.msg };
  return { ok: true, value: formatPhoneBr(check.value) };
}
function pixInputPlaceholder(type) {
  if (type === "CPF") return "000.000.000-00";
  if (type === "CNPJ") return "00.000.000/0000-00";
  if (type === "Telefone") return "(51) 9 9894-0123";
  if (type === "E-mail") return "nome@email.com";
  if (type === "Aleatória") return "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";
  return "Cole ou digite a chave";
}
function syncPixInputMode() {
  const el = document.getElementById("pixKeyInput");
  if (!el) return;
  el.placeholder = pixInputPlaceholder(pixDraftType);
  if (pixDraftType === "E-mail") {
    el.setAttribute("inputmode", "email");
    el.setAttribute("type", "email");
    el.removeAttribute("maxlength");
  } else if (pixDraftType === "Aleatória") {
    el.setAttribute("inputmode", "text");
    el.setAttribute("type", "text");
    el.setAttribute("maxlength", "36");
  } else {
    el.setAttribute("inputmode", "numeric");
    el.setAttribute("type", "tel");
    el.setAttribute("maxlength", pixDraftType === "CNPJ" ? "18" : (pixDraftType === "Telefone" ? "16" : "14"));
  }
  // reaplica máscara no valor atual
  maskPixInput(el);
}
function maskPixInput(el) {
  if (!el) return;
  if (pixDraftType === "Telefone") { maskOwnerPhone(el); return; }
  if (pixDraftType === "CPF") { el.value = formatCpfMask(el.value); return; }
  if (pixDraftType === "CNPJ") { el.value = formatCnpjMask(el.value); return; }
  if (pixDraftType === "E-mail") {
    el.value = String(el.value || "").replace(/\s/g, "");
    return;
  }
}

async function saveOwners() {
  const p = data.profile;
  p.owner1_name = document.getElementById("owner1Name").value.trim();
  p.owner2_name = document.getElementById("owner2Name").value.trim();
  const c1 = validateOwnerPhoneOptional(document.getElementById("owner1Contact").value, "Contato do dono 1");
  if (!c1.ok) { alert(c1.msg); return }
  const c2 = validateOwnerPhoneOptional(document.getElementById("owner2Contact").value, "Contato do dono 2");
  if (!c2.ok) { alert(c2.msg); return }
  p.owner1_contact = c1.value;
  p.owner2_contact = c2.value;
  document.getElementById("owner1Contact").value = c1.value;
  document.getElementById("owner2Contact").value = c2.value;
  const { error } = await sb.from("creche_profile").update({
    owner1_name: p.owner1_name,
    owner1_contact: p.owner1_contact,
    owner2_name: p.owner2_name,
    owner2_contact: p.owner2_contact
  }).eq("user_id", currentUserId);
  if (error) { alert("Não consegui salvar os donos.\n(" + (error.message || error) + ")"); return }
  flashHint("ownersSaveHint");
}
async function clearOwners() {
  if (!confirm("Limpar os dados dos donos?")) return;
  document.getElementById("owner1Name").value = "";
  document.getElementById("owner1Contact").value = "";
  document.getElementById("owner2Name").value = "";
  document.getElementById("owner2Contact").value = "";
  await saveOwners();
}

async function saveProfile() {
  let p = data.profile;
  p.name = document.getElementById("dogName").value.trim();
  // PIX keys salvas via savePixKey()/persistPixKeys
  p.birth_date = document.getElementById("birthDate").value || null;
  p.breed = document.getElementById("breed").value;
  p.owner1_name = document.getElementById("owner1Name").value;
  p.owner1_contact = document.getElementById("owner1Contact").value;
  p.owner2_name = document.getElementById("owner2Name").value;
  p.owner2_contact = document.getElementById("owner2Contact").value;
  await sb.from("creche_profile").update({ name: p.name, pix_key: p.pix_key, pix_type: p.pix_type, pix_keys: p.pix_keys || [], birth_date: p.birth_date, breed: p.breed, owner1_name: p.owner1_name, owner1_contact: p.owner1_contact, owner2_name: p.owner2_name, owner2_contact: p.owner2_contact }).eq("user_id", currentUserId);
  renderAll();
}
let cropper = null;
function startCrop(e) {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    openModal("Ajustar foto", `
      <div class="crop-wrap"><img id="cropImage" src="${reader.result}"></div>
      <p class="crop-hint">Arraste a foto para posicionar o rosto da Arya dentro do quadro. Use os botões abaixo para aproximar ou afastar.</p>
      <div class="zoom-controls">
        <button type="button" class="btn secondary" onclick="cropZoom(-0.1)">➖ Afastar</button>
        <button type="button" class="btn secondary" onclick="cropZoom(0.1)">➕ Aproximar</button>
      </div>
      <div class="row">
        <button class="btn secondary" onclick="closeModal()">Cancelar</button>
        <button class="btn pink-btn" onclick="confirmCrop()">✓ Usar foto</button>
      </div>
    `);
    const img = document.getElementById("cropImage");
    function start() {
      if (cropper) cropper.destroy();
      cropper = new Cropper(img, { aspectRatio: 1, viewMode: 1, background: false, autoCropArea: 1, guides: false, center: false });
    }
    if (img.complete) start(); else img.onload = start;
  };
  reader.readAsDataURL(f);
}
function cropZoom(amount) { if (cropper) cropper.zoom(amount) }
async function confirmCrop() {
  if (!cropper) return;
  const canvas = cropper.getCroppedCanvas({ width: 500, height: 500 });
  canvas.toBlob(async (blob) => {
    const path = `${currentUserId}/profile/${crypto.randomUUID()}.jpg`;
    await sb.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: "image/jpeg" });
    data.profile.photo_path = path;
    await sb.from("creche_profile").update({ photo_path: path }).eq("user_id", currentUserId);
    cropper.destroy(); cropper = null;
    closeModal();
    renderProfile();
  }, "image/jpeg", 0.9);
}
function renderSavedMessages() {
  const el = document.getElementById("savedMessages");
  if (!el) return;
  const n = petName();
  const built = [
    { name: "Levar " + n, text: "Oii, chegamos daqui uns 5min com a " + n, action: "prepareMessage('take')", icon: "🐶" },
    { name: "Buscar " + n, text: "Oii, estamos indo buscar a " + n + " 😊", action: "prepareMessage('pickup')", icon: "🏠" },
    { name: n + " não vai", text: "Oii, hoje a " + n + " não vai para a creche.", action: "prepareMessage('notgo')", icon: "❌" }
  ];
  const custom = data.customMessages.map(m => ({ name: m.name, text: m.text, action: `useCustomMessage(${m.id})`, icon: "💬", custom: m.id }));
  el.innerHTML = [...built, ...custom].map(m => `
    <div class="saved-message">
      <button onclick="${m.action}"><span>${m.icon}</span><div><b>${m.name}</b><small>${m.text}</small></div><span>›</span></button>
      ${m.custom ? `<button class="delete-msg" onclick="deleteCustomMessage(${m.custom})" title="Excluir">×</button>` : ""}
    </div>`).join("");
}
let paymentsMonthsSelected = new Set();
function togglePaymentsMonths() {
  const panel = document.getElementById("paymentsMonthsPanel");
  const wasHidden = panel.classList.contains("hidden");
  panel.classList.toggle("hidden");
  document.getElementById("paymentsMonthsArrow").textContent = wasHidden ? "▴" : "▾";
}
function togglePaymentsMonth(ym) { paymentsMonthsSelected.has(ym) ? paymentsMonthsSelected.delete(ym) : paymentsMonthsSelected.add(ym); renderPayments() }
function clearPaymentsMonths() { paymentsMonthsSelected.clear(); renderPayments() }
function renderPaymentsMonthChips() {
  const el = document.getElementById("paymentsMonthChips");
  if (!el) return;
  const year = new Date().getFullYear();
  el.innerHTML = MESES_ABREV.map((label, i) => {
    const ym = `${year}-${pad(i + 1)}`;
    return `<button class="month-chip ${paymentsMonthsSelected.has(ym) ? "selected" : ""}" onclick="togglePaymentsMonth('${ym}')"><b>${label}</b></button>`;
  }).join("");
  const lbl = document.getElementById("paymentsMonthsLabel");
  if (lbl) lbl.textContent = paymentsMonthsSelected.size === 0 ? "Todos os meses" : `${paymentsMonthsSelected.size} ${paymentsMonthsSelected.size === 1 ? "mês" : "meses"}`;
}
function renderPayments() {
  renderPaymentsMonthChips();
  const sel = paymentsMonthsSelected;
  let total = 0, pendingTotal = 0;
  Object.entries(data.records).forEach(([s, r]) => {
    if (!(sel.size === 0 || sel.has(s.slice(0, 7)))) return;
    const v = priceFor(s, r);
    total += v;
    if (!isDatePaid(s)) pendingTotal += v;
  });
  document.getElementById("paymentTotal").textContent = money(pendingTotal);
  document.getElementById("paymentState").textContent = total === 0 ? "Sem lançamentos" : pendingTotal === 0 ? "Pago" : "Pendente";

  const pf = document.getElementById("periodFrom").value, pt = document.getElementById("periodTo").value;
  let periodTotal = 0, periodPending = 0;
  Object.entries(data.records).forEach(([s, r]) => {
    if (s >= pf && s <= pt) {
      const v = priceFor(s, r);
      periodTotal += v;
      if (!isDatePaid(s)) periodPending += v;
    }
  });
  document.getElementById("periodTotal").textContent = money(periodPending);
  const psEl = document.getElementById("periodState");
  const periodPago = periodTotal > 0 && periodPending === 0;
  psEl.textContent = periodTotal === 0 ? "Sem lançamentos" : periodPago ? "Pago" : "Pendente";
  psEl.className = "payment-badge " + (periodPago ? "paid" : "unpaid");

  document.getElementById("paymentHistory").innerHTML = data.payments.length ? data.payments.slice().reverse().map(p => {
    const attach = p.attachment_path ? `<span class="attach-row"><button class="attach-link" onclick="window.open('${publicUrl(p.attachment_path)}','_blank')">📎 Ver comprovante</button><button class="attach-remove" onclick="removeAttachment(${p.id})" title="Remover anexo">🗑️</button></span>` : "";
    const thru = p.paid_through ? `<small>Cobre até ${dateObj(p.paid_through).toLocaleDateString("pt-BR")}</small>` : "";
    return `<div class="payment-row"><div><b>${dateObj(p.date).toLocaleDateString("pt-BR")}</b><small>${p.note || "Sem nota"}</small>${thru}${attach}</div><div class="payment-row-right"><b>${money(p.value)}</b><button class="attach-remove" onclick="deletePaymentRow(${p.id})" title="Excluir pagamento">🗑️</button></div></div>`;
  }).join("") : "<small>Nenhum pagamento registrado.</small>"
}
async function registerPayment() {
  let date = document.getElementById("paymentDate").value || new Date().toISOString().slice(0, 10);
  let value = Number(document.getElementById("paymentValue").value);
  let note = document.getElementById("paymentNote").value.trim();
  let paid_through = document.getElementById("paidThrough").value || null;
  let fileInput = document.getElementById("paymentFile");
  let file = fileInput && fileInput.files && fileInput.files[0];
  if (!value) return alert("Informe o valor.");
  if (!paid_through) return alert("Informe até que data este pagamento cobre as idas.");
  let attachment_path = null, attachment_type = null, attachment_name = null;
  if (file) {
    attachment_path = `${currentUserId}/payments/${crypto.randomUUID()}-${file.name}`;
    await sb.storage.from(BUCKET).upload(attachment_path, file, { contentType: file.type });
    attachment_type = file.type; attachment_name = file.name;
  }
  await sb.from("creche_payments").insert({ user_id: currentUserId, date, value, note, paid_through, attachment_path, attachment_type, attachment_name });
  document.getElementById("paymentValue").value = "";
  document.getElementById("paymentNote").value = "";
  document.getElementById("paidThrough").value = "";
  if (fileInput) fileInput.value = "";
  if (typeof clearPaymentFile === "function") clearPaymentFile();
  await loadAll();
}
async function removeAttachment(id) {
  if (!confirm("Remover o comprovante deste pagamento?")) return;
  const p = data.payments.find(x => x.id === id);
  if (!p || !p.attachment_path) return;
  await sb.storage.from(BUCKET).remove([p.attachment_path]);
  await sb.from("creche_payments").update({ attachment_path: null, attachment_type: null, attachment_name: null }).eq("id", id);
  p.attachment_path = null; p.attachment_type = null; p.attachment_name = null;
  renderAll();
}
async function deletePaymentRow(id) {
  if (!confirm("Excluir este pagamento?")) return;
  const p = data.payments.find(x => x.id === id);
  if (p && p.attachment_path) await sb.storage.from(BUCKET).remove([p.attachment_path]);
  await sb.from("creche_payments").delete().eq("id", id);
  data.payments = data.payments.filter(x => x.id !== id);
  renderAll();
}
function copyPix() { return copySelectedPix(); }
function copyPix_legacy() {
  const val = document.getElementById("pixKey").value.trim();
  const btn = document.getElementById("copyPixBtn");
  if (!val) { alert("Nenhuma chave PIX cadastrada ainda."); return }
  const original = btn.textContent;
  function ok() { btn.textContent = "✓ Copiado!"; setTimeout(() => { btn.textContent = original }, 1500) }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(val).then(ok).catch(() => alert("Não consegui copiar. Chave: " + val));
  } else {
    alert("Não consegui copiar automaticamente. Chave: " + val);
  }
}
function openModal(t, b) { document.getElementById("modalTitle").textContent = t; document.getElementById("modalBody").innerHTML = b; document.getElementById("modal").classList.remove("hidden") }
function closeModal() { document.getElementById("modal").classList.add("hidden") }

document.getElementById("paymentDate").value = new Date().toISOString().slice(0, 10);
(function setDefaultPeriod() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  document.getElementById("periodFrom").value = iso(from.getFullYear(), from.getMonth(), from.getDate());
  document.getElementById("periodTo").value = iso(to.getFullYear(), to.getMonth(), to.getDate());
})();


// ---- Cãotrole / creche operator ----
function todayIso() {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth(), d.getDate());
}

function ensureClientsShape() {
  if (!data.profile) return;
  if (!Array.isArray(data.profile.clients)) data.profile.clients = [];
  if (!data.profile.attendance || typeof data.profile.attendance !== "object") data.profile.attendance = {};
  if (data.profile.price_day == null) data.profile.price_day = 40;
  if (data.profile.price_over == null) data.profile.price_over = 60;
}

function persistClientsLocal() {
  try { localStorage.setItem(clientsLsKey(), JSON.stringify(data.profile.clients || [])); } catch (e) {}
  try { localStorage.setItem(attendanceLsKey(), JSON.stringify(data.profile.attendance || {})); } catch (e) {}
}

async function persistClientsAndAttendance() {
  ensureClientsShape();
  persistClientsLocal();
  if (!currentUserId) return;
  const payload = {
    clients: data.profile.clients || [],
    attendance: data.profile.attendance || {}
  };
  const { error } = await sb.from("creche_profile").update(payload).eq("user_id", currentUserId);
  if (error) {
    console.warn("clients/attendance column missing or rejected; using localStorage", error);
  }
}

function getClients() {
  ensureClientsShape();
  return data.profile.clients || [];
}

function getTodayAttendanceMap() {
  ensureClientsShape();
  const day = todayIso();
  if (!data.profile.attendance[day] || typeof data.profile.attendance[day] !== "object") {
    data.profile.attendance[day] = {};
  }
  return data.profile.attendance[day];
}

function clientExpectedToday(c) {
  const dow = new Date().getDay();
  const days = Array.isArray(c.weekdays) ? c.weekdays : [];
  if (!days.length) return true;
  return days.map(Number).includes(dow);
}

function updateNavForRole() {
  const creche = isCrecheRole();
  const nav = document.getElementById("appNav");
  if (nav) nav.classList.toggle("nav-creche", creche);
  const homeL = document.getElementById("navHomeLabel");
  const calL = document.getElementById("navCalendarLabel");
  const msgL = document.getElementById("navMessagesLabel");
  const payL = document.getElementById("navPaymentsLabel");
  const msgBtn = document.getElementById("navMessages");
  const profileBtn = document.getElementById("navProfile");
  if (creche) {
    if (homeL) homeL.textContent = "Hoje";
    if (calL) calL.textContent = "Agenda";
    if (msgL) msgL.textContent = "Famílias";
    if (payL) payL.textContent = "$";
    if (msgBtn) {
      msgBtn.dataset.screen = "crecheFamilies";
      msgBtn.innerHTML = '🐶<span id="navMessagesLabel">Famílias</span>';
    }
    if (profileBtn) {
      profileBtn.classList.remove("hidden");
    }
    // Expand nav to 5 for creche: Hoje Agenda Famílias Msgs $ — use profile as msgs? Spec:
    // Hoje, Agenda, Famílias, Msgs, $, Perfil — too many for bottom. Spec says reuse bottom nav retarget.
    // Mapping: home=Hoje, calendar=Agenda, messages button -> Famílias, payments=$, and we keep profile via pet-menu.
    // Add a way to Msgs: keep messages accessible via quick action. Retarget messages nav to Famílias.
  } else {
    if (homeL) homeL.textContent = "Início";
    if (calL) calL.textContent = "Calendário";
    if (msgBtn) {
      msgBtn.dataset.screen = "messages";
      msgBtn.innerHTML = '💬<span id="navMessagesLabel">Mensagens</span>';
    }
    if (payL) payL.textContent = "Pagamentos";
    if (profileBtn) profileBtn.classList.add("hidden");
  }
}

function goNavMid() {
  if (isCrecheRole()) go("crecheFamilies");
  else go("messages");
}

function applyRoleLayout() {
  const creche = isCrecheRole();
  const tutorHome = document.getElementById("tutorHomeBlock");
  const crecheToday = document.getElementById("crecheToday");
  const tutorProfile = document.getElementById("tutorProfileBlock");
  const crecheProfile = document.getElementById("crecheProfileBlock");
  if (tutorHome) tutorHome.classList.toggle("hidden", creche);
  if (crecheToday) crecheToday.classList.toggle("hidden", !creche);
  if (tutorProfile) tutorProfile.classList.toggle("hidden", creche);
  if (crecheProfile) crecheProfile.classList.toggle("hidden", !creche);
  updateNavForRole();
}

function renderCrecheToday() {
  if (!isCrecheRole()) return;
  ensureClientsShape();
  const label = document.getElementById("crecheTodayDateLabel");
  if (label) {
    label.textContent = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short" });
  }
  const clients = getClients().filter(clientExpectedToday);
  const att = getTodayAttendanceMap();
  let presente = 0, saiu = 0, faltou = 0;
  clients.forEach(c => {
    const st = att[c.id] || "";
    if (st === "presente") presente++;
    else if (st === "saiu") saiu++;
    else if (st === "faltou") faltou++;
  });
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set("crecheCountExpected", clients.length + " esperados");
  set("crecheCountPresent", presente + " presente");
  set("crecheCountOut", saiu + " saiu");
  set("crecheCountAbsent", faltou + " faltou");
  const list = document.getElementById("crecheTodayList");
  if (!list) return;
  if (!clients.length) {
    list.innerHTML = "<div class='trip'><div><b>Nenhum pet para hoje</b><small>Adicione o primeiro pet em Famílias</small></div></div>";
    return;
  }
  list.innerHTML = clients.map(c => {
    const st = att[c.id] || "";
    const chip = (val, label) => `<button type="button" class="status-chip${st === val ? " on" : ""}" onclick="setClientAttendance('${c.id}','${val}')">${label}</button>`;
    return `<div class="trip creche-row">
      <div>
        <b>${escapeHtml(c.name || "Pet")}</b>
        <small>${escapeHtml(c.tutor_name || "Tutor")} ${c.tutor_phone ? "· " + escapeHtml(c.tutor_phone) : ""}</small>
        <div class="status-row">
          ${chip("presente", "Presente")}
          ${chip("saiu", "Saiu")}
          ${chip("faltou", "Faltou")}
        </div>
      </div>
      <div class="creche-row-actions">
        <button type="button" class="text-btn" onclick="avisarTutor('${c.id}')">Avisar</button>
      </div>
    </div>`;
  }).join("");
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

async function setClientAttendance(clientId, status) {
  ensureClientsShape();
  const att = getTodayAttendanceMap();
  if (att[clientId] === status) delete att[clientId];
  else att[clientId] = status;
  await persistClientsAndAttendance();
  renderCrecheToday();
}

async function crecheBulkStatus(status) {
  ensureClientsShape();
  const clients = getClients().filter(clientExpectedToday);
  const att = getTodayAttendanceMap();
  clients.forEach(c => {
    if (status === "saiu") {
      if ((att[c.id] || "") === "presente" || !att[c.id]) att[c.id] = "saiu";
    } else {
      att[c.id] = status;
    }
  });
  await persistClientsAndAttendance();
  renderCrecheToday();
}

function avisarTutor(clientId) {
  const c = getClients().find(x => x.id === clientId);
  const name = (c && c.name) || "seu pet";
  data.message = `Oii! Atualização da creche sobre ${name}: `;
  saveMessageText(data.message);
  go("messages");
}

function renderCrecheFamilies() {
  if (!isCrecheRole()) return;
  ensureClientsShape();
  const list = document.getElementById("crecheFamiliesList");
  if (!list) return;
  const clients = getClients();
  if (!clients.length) {
    list.innerHTML = "<div class='trip'><div><b>Adicione o primeiro pet em Famílias</b><small>Cadastre nome, tutor e dias da semana</small></div></div>";
  } else {
    const dayNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    list.innerHTML = clients.map(c => {
      const days = (c.weekdays || []).map(Number).sort().map(d => dayNames[d]).join(", ") || "Todos os dias";
      return `<div class="trip">
        <div><b>${escapeHtml(c.name)}</b><small>${escapeHtml(c.tutor_name || "")} · ${days}</small></div>
        <div class="creche-row-actions">
          <button type="button" class="text-btn" onclick="editClient('${c.id}')">Editar</button>
          <button type="button" class="text-btn" onclick="deleteClient('${c.id}')">Excluir</button>
        </div>
      </div>`;
    }).join("");
  }
  renderClientWeekdayPicker();
}

let clientWeekdaysSelected = [];

function renderClientWeekdayPicker() {
  const el = document.getElementById("clientWeekdays");
  if (!el) return;
  const names = ["D", "S", "T", "Q", "Q", "S", "S"];
  el.innerHTML = names.map((n, i) =>
    `<button type="button" class="${clientWeekdaysSelected.includes(i) ? "on" : ""}" onclick="toggleClientWeekday(${i})">${n}</button>`
  ).join("");
}

function toggleClientWeekday(i) {
  if (clientWeekdaysSelected.includes(i)) clientWeekdaysSelected = clientWeekdaysSelected.filter(x => x !== i);
  else clientWeekdaysSelected = [...clientWeekdaysSelected, i];
  renderClientWeekdayPicker();
}

function openClientForm() {
  resetClientForm();
  const card = document.getElementById("crecheClientFormCard");
  if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetClientForm() {
  const idEl = document.getElementById("clientEditId");
  if (idEl) idEl.value = "";
  ["clientName", "clientTutorName", "clientTutorPhone", "clientNotes"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  clientWeekdaysSelected = [];
  renderClientWeekdayPicker();
  const title = document.getElementById("crecheClientFormTitle");
  if (title) title.textContent = "Novo pet";
}

function editClient(id) {
  const c = getClients().find(x => x.id === id);
  if (!c) return;
  document.getElementById("clientEditId").value = c.id;
  document.getElementById("clientName").value = c.name || "";
  document.getElementById("clientTutorName").value = c.tutor_name || "";
  document.getElementById("clientTutorPhone").value = c.tutor_phone ? formatPhoneBr(c.tutor_phone) : "";
  document.getElementById("clientNotes").value = c.notes || "";
  clientWeekdaysSelected = Array.isArray(c.weekdays) ? c.weekdays.map(Number) : [];
  renderClientWeekdayPicker();
  const title = document.getElementById("crecheClientFormTitle");
  if (title) title.textContent = "Editar pet";
  go("crecheFamilies");
}

async function saveClientForm() {
  ensureClientsShape();
  const name = (document.getElementById("clientName").value || "").trim();
  if (!name) { alert("Informe o nome do pet."); return; }
  const editId = (document.getElementById("clientEditId").value || "").trim();
  const row = {
    id: editId || ("c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
    name,
    tutor_name: (document.getElementById("clientTutorName").value || "").trim(),
    tutor_phone: onlyDigits(document.getElementById("clientTutorPhone").value || ""),
    notes: (document.getElementById("clientNotes").value || "").trim(),
    weekdays: clientWeekdaysSelected.slice().sort((a, b) => a - b)
  };
  const list = getClients();
  const idx = list.findIndex(x => x.id === row.id);
  if (idx >= 0) list[idx] = row; else list.push(row);
  data.profile.clients = list;
  await persistClientsAndAttendance();
  resetClientForm();
  flashHint("clientSaveHint");
  renderCrecheFamilies();
  renderCrecheToday();
}

async function deleteClient(id) {
  if (!confirm("Excluir este pet da lista?")) return;
  ensureClientsShape();
  data.profile.clients = getClients().filter(x => x.id !== id);
  // clean attendance refs
  Object.keys(data.profile.attendance || {}).forEach(day => {
    if (data.profile.attendance[day] && data.profile.attendance[day][id] != null) {
      delete data.profile.attendance[day][id];
    }
  });
  await persistClientsAndAttendance();
  renderCrecheFamilies();
  renderCrecheToday();
}

async function saveCrecheName() {
  const p = data.profile;
  p.name = (document.getElementById("crecheName").value || "").trim();
  const { error } = await sb.from("creche_profile").update({ name: p.name }).eq("user_id", currentUserId);
  if (error) { alert("Não consegui salvar o nome.\\n(" + (error.message || error) + ")"); return; }
  updateBrandForRole();
  updateChromeNames();
  flashHint("crecheNameHint");
}

async function saveCrechePrices() {
  const p = data.profile;
  const day = parseFloat(document.getElementById("crechePriceDay").value);
  const over = parseFloat(document.getElementById("crechePriceOver").value);
  p.price_day = isNaN(day) ? 40 : day;
  p.price_over = isNaN(over) ? 60 : over;
  const { error } = await sb.from("creche_profile").update({ price_day: p.price_day, price_over: p.price_over }).eq("user_id", currentUserId);
  if (error) {
    // columns may not exist yet — keep in profile memory
    console.warn(error);
  }
  flashHint("crechePricesHint");
}

function renderCrecheProfile() {
  if (!isCrecheRole()) return;
  const p = data.profile;
  const nameEl = document.getElementById("crecheName");
  if (nameEl && document.activeElement !== nameEl) nameEl.value = p.name || "";
  const dayEl = document.getElementById("crechePriceDay");
  const overEl = document.getElementById("crechePriceOver");
  if (dayEl && document.activeElement !== dayEl) dayEl.value = p.price_day != null ? p.price_day : 40;
  if (overEl && document.activeElement !== overEl) overEl.value = p.price_over != null ? p.price_over : 60;
  const ph = document.getElementById("crecheProfilePhoto");
  const ha = document.getElementById("headerAvatar");
  if (ph) {
    if (p.photo_path) {
      const url = publicUrl(p.photo_path);
      ph.innerHTML = `<img src="${url}">`;
      if (ha) ha.innerHTML = `<img src="${url}">`;
    } else {
      ph.textContent = "🏠";
    }
  }
}

// ---- Login / acesso ----


/** Usuários de teste que podem criar/entrar como creche (público: só tutor por enquanto). */
const CRECHE_TEST_USERNAMES = [
  "livia",
  "cleo",
  "tia-cleo",
  "admin",
  "liviafhansen"
];

const CRECHE_EMAIL_DOMAIN = "creche.caotrole.app";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeUsername(user) {
  return String(user || "").trim().toLowerCase().replace(/\s+/g, "-");
}

function isCrecheSyntheticEmail(email) {
  const e = normalizeEmail(email);
  return e.endsWith("@" + CRECHE_EMAIL_DOMAIN);
}

function crecheUsernameToEmail(username) {
  const u = normalizeUsername(username).replace(/[^a-z0-9._-]/g, "");
  if (!u) return "";
  return u + "@" + CRECHE_EMAIL_DOMAIN;
}

function crecheEmailToUsername(email) {
  const e = normalizeEmail(email);
  if (!isCrecheSyntheticEmail(e)) return "";
  return e.slice(0, -(CRECHE_EMAIL_DOMAIN.length + 1));
}

function canUseCrecheRole(usernameOrEmail) {
  const raw = String(usernameOrEmail || "").trim().toLowerCase();
  if (!raw) return false;
  if (raw.includes("@")) {
    if (isCrecheSyntheticEmail(raw)) return CRECHE_TEST_USERNAMES.includes(crecheEmailToUsername(raw));
    // e-mails reais antigos da allowlist (compat)
    return ["liviafhansen123@gmail.com", "achadinhosliviaemaiquel@gmail.com"].includes(raw);
  }
  return CRECHE_TEST_USERNAMES.includes(normalizeUsername(raw));
}

function crecheNotOpenMessage() {
  return "O acesso da creche ainda não está liberado para o público. Entre como tutor — a área da creche vem em breve.";
}

function authIdentityFromForm(kind) {
  // kind: login | signup
  const isCreche = wantedLandingRole() === "creche";
  if (isCreche) {
    const userEl = document.getElementById(kind === "signup" ? "signupEmail" : "loginEmail");
    const username = userEl ? userEl.value.trim() : "";
    const email = crecheUsernameToEmail(username);
    return { isCreche: true, username: normalizeUsername(username), email };
  }
  const emailEl = document.getElementById(kind === "signup" ? "signupEmail" : "loginEmail");
  const email = emailEl ? emailEl.value.trim() : "";
  return { isCreche: false, username: "", email };
}


let pendingRole = localStorage.getItem("creche_pending_role") || "tutor";

function chooseRole(role) {
  pendingRole = role === "creche" ? "creche" : "tutor";
  localStorage.setItem("creche_pending_role", pendingRole);
  updateAuthCopy();
  showLoginScreen();
  if (pendingRole === "creche") {
    const errEl = document.getElementById("loginError");
    if (errEl) {
      errEl.textContent = "Acesso creche em fase de teste (só contas autorizadas). O público entra como tutor.";
      errEl.classList.remove("hidden");
    }
  }
}

function updateAuthCopy() {
  const isCreche = pendingRole === "creche";
  const loginTitle = document.getElementById("loginTitle");
  const loginSub = document.getElementById("loginSub");
  const signupTitle = document.getElementById("signupTitle");
  const signupSub = document.getElementById("signupSub");
  const loginLogo = document.getElementById("loginLogo");
  const signupLogo = document.getElementById("signupLogo");
  const loginBadge = document.getElementById("loginRoleBadge");
  const signupBadge = document.getElementById("signupRoleBadge");
  const loginBtn = document.querySelector("#loginForm button[type=submit]");
  const signupBtn = document.querySelector("#signupForm button[type=submit]");
  const loginScreen = document.getElementById("loginScreen");
  const signupScreen = document.getElementById("signupScreen");
  if (loginScreen) {
    loginScreen.classList.toggle("auth-creche", isCreche);
    loginScreen.classList.toggle("auth-tutor", !isCreche);
  }
  if (signupScreen) {
    signupScreen.classList.toggle("auth-creche", isCreche);
    signupScreen.classList.toggle("auth-tutor", !isCreche);
  }
  if (loginLogo) loginLogo.textContent = isCreche ? "🏠" : "🐾";
  if (signupLogo) signupLogo.textContent = isCreche ? "🏠" : "🐾";
  if (loginBadge) {
    loginBadge.textContent = isCreche ? "Conta creche" : "Conta tutor";
    loginBadge.className = "auth-role-badge " + (isCreche ? "creche" : "tutor");
  }
  if (signupBadge) {
    signupBadge.textContent = isCreche ? "Nova conta creche" : "Nova conta tutor";
    signupBadge.className = "auth-role-badge " + (isCreche ? "creche" : "tutor");
  }
  if (loginTitle) loginTitle.textContent = isCreche ? "Entrar como creche" : "Entrar como tutor";
  if (loginSub) loginSub.textContent = isCreche
    ? "Use um usuário de teste (não é e-mail). Conta de tutor não entra aqui."
    : "Só contas de tutor. Conta de creche não entra por aqui.";
  if (signupTitle) signupTitle.textContent = isCreche ? "Criar conta da creche" : "Criar conta de tutor";
  if (signupSub) signupSub.textContent = isCreche
    ? "Escolha um usuário novo (ex.: livia ou cleo). Não use e-mail — evita conflito com conta de tutor."
    : "Use o e-mail da família. Esta conta fica travada no acesso de tutor.";
  if (loginBtn) loginBtn.textContent = isCreche ? "Entrar na creche" : "Entrar como tutor";
  if (signupBtn) signupBtn.textContent = isCreche ? "Criar conta da creche" : "Criar conta de tutor";

  // Campos: creche = usuário; tutor = e-mail
  [
    ["loginEmail", "loginEmailLabel", "login"],
    ["signupEmail", "signupEmailLabel", "signup"]
  ].forEach(([inputId, labelId]) => {
    const input = document.getElementById(inputId);
    const label = document.getElementById(labelId);
    if (!input) return;
    if (isCreche) {
      input.type = "text";
      input.name = inputId === "loginEmail" ? "creche_user" : "creche_signup_user";
      input.autocomplete = "username";
      input.placeholder = "ex.: livia";
      input.removeAttribute("autocapitalize");
      input.spellcheck = false;
      if (label) {
        const textNode = label.childNodes[0];
        if (textNode && textNode.nodeType === 3) textNode.textContent = "Usuário";
        else {
          // label wraps input — set via data
        }
      }
      // Rewrite label text keeping input child
      if (label) {
        const inp = label.querySelector("input");
        label.textContent = "";
        label.appendChild(document.createTextNode("Usuário"));
        if (inp) label.appendChild(inp);
      }
    } else {
      input.type = "email";
      input.name = inputId === "loginEmail" ? "email" : "signup_email";
      input.autocomplete = inputId === "loginEmail" ? "username" : "off";
      input.placeholder = "seu@email.com";
      if (label) {
        const inp = label.querySelector("input");
        label.textContent = "";
        label.appendChild(document.createTextNode("E-mail"));
        if (inp) label.appendChild(inp);
      }
    }
  });
}

function updateBrandForRole() {
  const role = (data.profile && data.profile.account_role) || pendingRole || "tutor";
  const eye = document.getElementById("brandEyebrow");
  const title = document.getElementById("brandTitle");
  const hero = document.getElementById("homeHeroLabel");
  if (eye) eye.textContent = "CÃOTROLE";
  if (role === "creche") {
    if (title) title.textContent = (data.profile && data.profile.name && data.profile.name.trim()) || "Minha creche";
    if (hero) hero.textContent = "Hoje na creche";
  } else {
    if (title) title.textContent = (data.profile && data.profile.name && data.profile.name.trim()) || "Meu pet";
    if (hero) hero.textContent = "Em aberto este mês";
  }
  applyRoleLayout();
}

function showLandingScreen() {
  authView = "landing";
  document.getElementById("landingScreen").classList.remove("hidden");
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("signupScreen").classList.add("hidden");
  document.getElementById("appShell").classList.add("hidden");
  if (currentPath() !== "/" && currentPath() !== "") {
    history.pushState({ authView: "landing" }, "", "/");
  }
}

let authView = "landing"; // "landing" | "login" | "signup"

function pathIsSignup() {
  return /\/cadastro\/?$/.test(location.pathname);
}
function setAuthRoute(view, opts) {
  opts = opts || {};
  authView = view;
  const want = view === "signup" ? "/cadastro" : "/";
  const cur = (location.pathname.replace(/\/$/, "") || "/");
  if (cur !== want) {
    history[opts.replace ? "replaceState" : "pushState"]({ authView: view }, "", want);
  }
}
function clearSignupFields() {
  const email = document.getElementById("signupEmail");
  const pw = document.getElementById("signupPassword");
  const pw2 = document.getElementById("signupPasswordConfirm");
  const err = document.getElementById("signupError");
  if (err) err.classList.add("hidden");
  if (email) email.value = "";
  if (pw) pw.value = "";
  if (pw2) pw2.value = "";
  [email, pw, pw2].forEach(function (el) {
    if (!el) return;
    el.setAttribute("readonly", "readonly");
    setTimeout(function () { el.removeAttribute("readonly"); }, 50);
  });
}
function clearLoginFields() {
  const email = document.getElementById("loginEmail");
  const pw = document.getElementById("loginPassword");
  if (email) email.value = "";
  if (pw) pw.value = "";
}

function showApp(show) {
  const landing = document.getElementById("landingScreen");
  const login = document.getElementById("loginScreen");
  const signup = document.getElementById("signupScreen");
  const shell = document.getElementById("appShell");
  if (show) {
    if (landing) landing.classList.add("hidden");
    login.classList.add("hidden");
    signup.classList.add("hidden");
    shell.classList.remove("hidden");
    updateBrandForRole();
    return;
  }
  shell.classList.add("hidden");
  if (authView === "signup") {
    if (landing) landing.classList.add("hidden");
    login.classList.add("hidden");
    signup.classList.remove("hidden");
    updateAuthCopy();
  } else if (authView === "login") {
    if (landing) landing.classList.add("hidden");
    signup.classList.add("hidden");
    login.classList.remove("hidden");
    updateAuthCopy();
  } else {
    // landing default when logged out
    if (landing) landing.classList.remove("hidden");
    login.classList.add("hidden");
    signup.classList.add("hidden");
  }
}
async function initAuth() {
  if (pathIsSignup()) { authView = "signup"; clearSignupFields(); }
  else if (currentPath() === "/cadastro") { authView = "signup"; }
  else { authView = "landing"; }
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    showApp(true);
    const sc = screenFromPath() || "home";
    go(sc, { replace: true, skipRoute: false });
    loadAll();
  } else {
    showApp(false);
  }
  sb.auth.onAuthStateChange(async (_event, session) => {
    if (session && session.user) {
      const check = await assertAccountRoleOrSignOut(session.user);
      if (!check.ok) {
        showApp(false);
        showLoginScreen();
        const errEl = document.getElementById("loginError");
        if (errEl && check.message) {
          errEl.textContent = check.message;
          errEl.classList.remove("hidden");
        }
        return;
      }
      showApp(true);
      const sc = screenFromPath() || "home";
      go(sc, { replace: true });
      loadAll();
    } else {
      showApp(false);
    }
  });
  window.addEventListener("popstate", function () {
    const shellHidden = document.getElementById("appShell").classList.contains("hidden");
    if (!shellHidden) {
      const sc = screenFromPath() || "home";
      go(sc, { skipRoute: true });
      return;
    }
    authView = pathIsSignup() ? "signup" : "login";
    if (authView === "signup") {
      clearSignupFields();
      document.getElementById("loginScreen").classList.add("hidden");
      document.getElementById("signupScreen").classList.remove("hidden");
    } else {
      document.getElementById("signupScreen").classList.add("hidden");
      document.getElementById("loginScreen").classList.remove("hidden");
    }
  });
}
function showSignupScreen() {
  clearSignupFields();
  authView = "signup";
  setAuthRoute("signup");
  const landing = document.getElementById("landingScreen");
  if (landing) landing.classList.add("hidden");
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("signupScreen").classList.remove("hidden");
  document.getElementById("loginError").classList.add("hidden");
  updateAuthCopy();
}
function showLoginScreen() {
  authView = "login";
  setAuthRoute("login");
  const landing = document.getElementById("landingScreen");
  if (landing) landing.classList.add("hidden");
  document.getElementById("signupScreen").classList.add("hidden");
  document.getElementById("loginScreen").classList.remove("hidden");
  updateAuthCopy();
}

/** Papel escolhido na landing (tutor|creche). Conta existente não pode cruzar. */
function wantedLandingRole() {
  return pendingRole === "creche" ? "creche" : "tutor";
}

function roleMismatchMessage(lockedRole) {
  return lockedRole === "tutor"
    ? "Esta conta é só de tutor. Para a creche, crie uma conta nova com outro e-mail."
    : "Esta conta é só de creche. Volte e entre pelo acesso de creche, ou use outra conta de tutor.";
}

/**
 * Confere se o usuário pode entrar no fluxo atual da landing.
 * return { ok, lockedRole } — se ok=false, já fez signOut.
 */
async function assertAccountRoleOrSignOut(user) {
  const wanted = wantedLandingRole();
  if (wanted === "creche" && !canUseCrecheRole(user.email)) {
    await sb.auth.signOut();
    return { ok: false, message: crecheNotOpenMessage() };
  }
  const { data: profileRow, error } = await sb.from("creche_profile").select("account_role").eq("user_id", user.id).maybeSingle();
  if (error) {
    await sb.auth.signOut();
    return { ok: false, message: "Erro ao verificar o tipo de conta." };
  }
  if (profileRow && profileRow.account_role) {
    const locked = profileRow.account_role === "creche" ? "creche" : "tutor";
    if (locked !== wanted) {
      await sb.auth.signOut();
      return { ok: false, message: roleMismatchMessage(locked), lockedRole: locked };
    }
    pendingRole = locked;
    localStorage.setItem("creche_pending_role", pendingRole);
    return { ok: true, lockedRole: locked };
  }
  // Conta nova sem papel: será gravado no ensureUserRows / loadAll com o papel da landing
  return { ok: true, lockedRole: null };
}

async function doLogin() {
  const errEl = document.getElementById("loginError");
  errEl.classList.add("hidden");
  const id = authIdentityFromForm("login");
  const password = document.getElementById("loginPassword").value;
  if (id.isCreche) {
    if (!id.username) { errEl.textContent = "Informe o usuário da creche."; errEl.classList.remove("hidden"); return }
    if (!canUseCrecheRole(id.username)) { errEl.textContent = crecheNotOpenMessage(); errEl.classList.remove("hidden"); return }
    if (!id.email) { errEl.textContent = "Usuário inválido."; errEl.classList.remove("hidden"); return }
  } else {
    if (!id.email || !password) { errEl.textContent = "Preencha e-mail e senha."; errEl.classList.remove("hidden"); return }
  }
  if (!password) { errEl.textContent = "Informe a senha."; errEl.classList.remove("hidden"); return }
  const { data: authData, error } = await sb.auth.signInWithPassword({ email: id.email, password });
  if (error) {
    errEl.textContent = id.isCreche
      ? "Não consegui entrar: usuário ou senha incorretos."
      : "Não consegui entrar: e-mail ou senha incorretos.";
    errEl.classList.remove("hidden");
    return;
  }
  const user = authData && authData.user;
  if (!user) { errEl.textContent = "Não consegui entrar. Tenta de novo."; errEl.classList.remove("hidden"); return }
  const check = await assertAccountRoleOrSignOut(user);
  if (!check.ok) {
    errEl.textContent = check.message;
    errEl.classList.remove("hidden");
    showLoginScreen();
    return;
  }
}
document.getElementById("loginForm").addEventListener("submit", function (e) { e.preventDefault(); doLogin(); });
async function doSignup() {
  const errEl = document.getElementById("signupError");
  errEl.classList.add("hidden");
  const id = authIdentityFromForm("signup");
  const password = document.getElementById("signupPassword").value;
  const confirmPw = document.getElementById("signupPasswordConfirm").value;
  if (id.isCreche) {
    if (!id.username) { errEl.textContent = "Escolha um usuário para a creche."; errEl.classList.remove("hidden"); return }
    if (!canUseCrecheRole(id.username)) { errEl.textContent = crecheNotOpenMessage(); errEl.classList.remove("hidden"); return }
    if (!id.email) { errEl.textContent = "Usuário inválido (use letras/números)."; errEl.classList.remove("hidden"); return }
  } else {
    if (!id.email || !password) { errEl.textContent = "Preencha e-mail e senha."; errEl.classList.remove("hidden"); return }
  }
  if (password.length < 6) { errEl.textContent = "A senha precisa ter pelo menos 6 caracteres."; errEl.classList.remove("hidden"); return }
  if (password !== confirmPw) { errEl.textContent = "As senhas não são iguais. Confira e tenta de novo."; errEl.classList.remove("hidden"); return }
  const wantedRole = wantedLandingRole();
  localStorage.setItem("creche_pending_role", wantedRole);
  pendingRole = wantedRole;
  const { data: signData, error } = await sb.auth.signUp({ email: id.email, password });
  if (error) {
    let msg = error.message || "";
    if (/already registered|already been registered|User already registered/i.test(msg)) {
      msg = id.isCreche
        ? "Esse usuário já existe. Escolha outro (ex.: cleo, admin) ou entre com ele."
        : "Este e-mail já tem conta. Entre como tutor ou use outro e-mail.";
    }
    errEl.textContent = "Não consegui criar a conta: " + msg;
    errEl.classList.remove("hidden");
    return;
  }
  const user = signData && signData.user;
  if (user) {
    try {
      await ensureUserRows(user);
      const patch = { account_role: wantedRole };
      if (id.isCreche && id.username) patch.name = id.username;
      await sb.from("creche_profile").update(patch).eq("user_id", user.id);
    } catch (e) { /* primeiro login grava */ }
  }
  await sb.auth.signOut();
  clearSignupFields();
  clearLoginFields();
  showLoginScreen();
  const loginErrEl = document.getElementById("loginError");
  loginErrEl.textContent = wantedRole === "creche"
    ? ("Conta creche criada! Entre com o usuário \"" + id.username + "\" e a senha.")
    : "Conta de tutor criada! Entre com este e-mail no acesso tutor.";
  loginErrEl.classList.remove("hidden");
}
document.getElementById("signupForm").addEventListener("submit", function (e) { e.preventDefault(); doSignup(); });
async function doLogout() {
  await sb.auth.signOut();
  resetLocalData(null);
  clearLoginFields();
  clearSignupFields();
  setAuthRoute("login", { replace: true });
  renderAll();
}

initAuth();
