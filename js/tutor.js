"use strict";
/* ===================== TUTOR ===================== */

const T = {
  view: (() => { const d = new Date(); d.setDate(1); return d; })(),   // mês do calendário
  payMonths: new Set(),
  profileTab: "pet",
  editingPetId: null,        // id do pet em edição | "new"
  petDays: [],
  msgTemplates: []
};
const MONTHS_ABBR = ["Jan.", "Fev.", "Mar.", "Abr.", "Mai.", "Jun.", "Jul.", "Ago.", "Set.", "Out.", "Nov.", "Dez."];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const card = (html, cls) => `<div class="card ${cls || ""}">${html}</div>`;

/* ---------- dados ---------- */
async function loadTutorData() {
  const uid = S.user.id, today = todayIso(), since = addDaysIso(today, -400);
  const [msg, recs, pays, custom, pets, link, ci, att] = (await Promise.all([
    sb.from("creche_app_message").select("text").eq("user_id", uid).maybeSingle(),
    sb.from("creche_records").select("date,status").eq("user_id", uid),
    sb.from("creche_payments").select("*").eq("user_id", uid).order("date", { ascending: true }).order("id", { ascending: true }),
    sb.from("creche_custom_messages").select("*").eq("user_id", uid).order("id", { ascending: true }),
    sb.from("pets").select("*").eq("tutor_user_id", uid).order("created_at", { ascending: true }),
    sb.from("tutor_links").select("creche_id").eq("tutor_user_id", uid).maybeSingle(),
    sb.from("day_checkins").select("*").eq("user_id", uid).eq("day", today),
    sb.from("attendance").select("day,pet_id,status,overnight,arrived_at,left_at").gte("day", since)
  ])).map(must);
  S.draft = (msg && msg.text) || "";
  S.records = {}; (recs || []).forEach(r => { S.records[r.date] = r.status; });
  S.payments = pays || [];
  S.customMessages = custom || [];
  S.pets = pets || [];
  S.link = link;
  S.creche = link ? must(await sb.from("creches").select("*").eq("id", link.creche_id).maybeSingle()) : null;
  S.pricing = pricingFromCreche(S.creche);
  S.checkins = ci || [];
  S.myAttendance = att || [];
  indexAttendance();
  let saved = null; try { saved = localStorage.getItem("arya.pet." + uid); } catch (e) { /* ignorar */ }
  S.activePetId = S.pets.some(p => p.id === saved) ? saved : (S.pets[0] && S.pets[0].id) || null;
  startTutorRealtime();
}
function indexAttendance() {
  S.attByDay = {};
  S.myAttendance.forEach(a => { (S.attByDay[a.day] = S.attByDay[a.day] || []).push(a); });
  S._charges = null;
}
async function refreshTutorToday() {
  if (!S.user || S.role !== "tutor") return;
  const today = todayIso();
  const [ci, att] = (await Promise.all([
    sb.from("day_checkins").select("*").eq("user_id", S.user.id).eq("day", today),
    sb.from("attendance").select("day,pet_id,status,overnight,arrived_at,left_at").gte("day", addDaysIso(today, -400))
  ])).map(must);
  S.checkins = ci || []; S.myAttendance = att || []; indexAttendance();
  if (["home", "calendar", "payments"].includes(currentScreen)) navigate(currentScreen, { skipRoute: true, keepScroll: true, focus: false });
}
function startTutorRealtime() {
  stopRealtime();
  const deb = debounce(() => refreshTutorToday().catch(e => logError("realtime:tutor", e)), 400);
  RT.tutor = sb.channel("tutor-" + S.user.id)
    .on("postgres_changes", { event: "*", schema: "public", table: "attendance" }, deb)
    .on("postgres_changes", { event: "*", schema: "public", table: "day_checkins", filter: "user_id=eq." + S.user.id }, deb)
    .subscribe();
}

function activePet() { return S.pets.find(p => p.id === S.activePetId) || S.pets[0] || null; }
function petById(id) { return S.pets.find(p => p.id === id); }

/* ---------- cobranças (intenção ≠ lançamento) ----------
 * Registro manual do tutor (creche_records) vence; sem registro, vale a presença confirmada pela creche. Check-in NÃO gera cobrança. */
function chargeOf(d) {
  const rec = S.records[d];
  if (rec) return priceFor(d, rec, S.pricing);
  let t = 0;
  for (const a of S.attByDay[d] || []) if (a.status !== "faltou") t += priceFor(d, a.overnight ? "over" : "was", S.pricing);
  return t;
}
function dayState(d) {
  const rec = S.records[d];
  if (rec) return { st: rec, from: "tutor" };
  const atts = S.attByDay[d] || [];
  const present = atts.filter(a => a.status !== "faltou");
  if (present.length) return { st: present.some(a => a.overnight) ? "over" : "was", from: "creche" };
  if (atts.length) return { st: "not", from: "creche" };
  return { st: "none", from: null };
}
function allCharges() {
  if (S._charges) return S._charges;
  const c = {};
  new Set([...Object.keys(S.records), ...Object.keys(S.attByDay)]).forEach(d => { c[d] = chargeOf(d); });
  return (S._charges = c);
}
const paidThrough = () => Pure.maxPaidThrough(S.payments);
const monthOwed = ym => Pure.sumCharges(allCharges(), { month: ym });
const monthPending = ym => Pure.sumCharges(allCharges(), { month: ym, after: paidThrough() || undefined });
function coverageLabel(ym) {
  const start = ym + "-01";
  let best = null;
  S.payments.forEach(p => {
    const pt = Pure.effectivePaidThrough(p);
    if (!pt || pt < start || p.status === "recusado") return;
    if (!best || pt > Pure.effectivePaidThrough(best)) best = p;
  });
  return best ? `Pago em ${formatBRDate(best.date)} · cobre até ${formatBRDate(Pure.effectivePaidThrough(best))}` : "";
}

/* ===================== INÍCIO ===================== */
function renderTutorHome() {
  const pet = activePet();
  setHtml($("tHomeBody"), onboardingHtml() + todayHtml(pet) + balanceHtml() + tripsHtml(pet));
}

function onboardingHtml() {
  const steps = [
    { done: S.pets.length > 0, label: "Cadastre seu pet", tab: "pet" },
    { done: !!S.creche, label: "Vincule à sua creche (código de convite)", tab: "creche" },
    { done: S.checkins.length > 0 || S.myAttendance.length > 0, label: "Faça o primeiro check-in do dia", tab: null }
  ];
  if (steps.every(s => s.done)) return "";
  return `<div class="card onboarding"><h3>Vamos começar</h3><ol class="steps">${steps.map((s, i) => `
    <li class="${s.done ? "done" : ""}"><span class="step-n" aria-hidden="true">${s.done ? "✓" : i + 1}</span><span>${esc(s.label)}${s.done ? '<span class="sr-only"> (feito)</span>' : ""}</span>
    ${!s.done && s.tab ? `<button type="button" class="text-btn" data-act="goProfileTab" data-tab="${s.tab}">Abrir</button>` : ""}</li>`).join("")}</ol></div>`;
}

function todayHtml(pet) {
  if (!pet) return `<div class="section-title"><h2>Hoje na creche</h2></div>` + card(`<p class="muted">Cadastre seu pet para fazer o check-in.</p><button type="button" class="btn pink-btn" data-act="goProfileTab" data-tab="pet">Cadastrar pet</button>`);
  const today = todayIso();
  const ci = S.checkins.find(c => c.pet_id === pet.id);
  const att = (S.attByDay[today] || []).find(a => a.pet_id === pet.id);
  let status, cls = "checkin-pending";
  if (att) {
    cls = att.status === "faltou" ? "checkin-no" : "checkin-ok";
    status = att.status === "presente" ? `🏠 <b>${esc(pet.name)} está na creche</b>${att.arrived_at ? " desde " + formatTime(att.arrived_at) : ""}`
      : att.status === "saiu" ? `👋 <b>${esc(pet.name)} já saiu</b>${att.left_at ? " às " + formatTime(att.left_at) : ""}`
      : `❌ A creche registrou falta de <b>${esc(pet.name)}</b> hoje`;
  } else if (ci) {
    const seen = !S.creche ? " · sem creche vinculada" : ci.seen_at ? " · creche viu ✓" : " · aguardando a creche ver";
    cls = ci.status === "coming" ? "checkin-ok" : "checkin-no";
    status = ci.status === "coming" ? `✅ Você avisou que <b>${esc(pet.name)}</b> vem hoje${seen}` : `❌ Você avisou que <b>${esc(pet.name)}</b> não vai hoje${seen}`;
  } else status = `Você ainda não avisou a creche sobre <b>${esc(pet.name)}</b>.`;
  const chips = S.pets.length > 1 ? `<div class="pet-chips" role="group" aria-label="Escolher pet">${S.pets.map(p => `<button type="button" class="chip ${p.id === pet.id ? "on" : ""}" data-act="selectPet" data-id="${esc(p.id)}" aria-pressed="${p.id === pet.id}">${esc(p.name)}</button>`).join("")}</div>` : "";
  return `<div class="section-title"><h2>Hoje na creche</h2></div>
  <div class="card ${cls}">${chips}
    <div class="today-status" role="status">${status}</div>
    ${!S.creche ? `<p class="muted">Sem creche vinculada, o aviso não chega a ninguém. <button type="button" class="text-btn" data-act="goProfileTab" data-tab="creche">Vincular agora</button></p>` : ""}
    <div class="quick-grid">
      <button type="button" class="quick ${ci && ci.status === "coming" ? "pink" : ""}" data-act="checkin" data-v="1"><span aria-hidden="true">✅</span><b>Vai hoje</b><small>Avisa a creche no app</small></button>
      <button type="button" class="quick ${ci && ci.status === "not_coming" ? "pink" : ""}" data-act="checkin" data-v="0"><span aria-hidden="true">❌</span><b>Não vai</b><small>Avisa a creche no app</small></button>
    </div>
    ${ci ? `<button type="button" class="text-btn" data-act="undoCheckin">↩ Desfazer aviso</button>` : ""}
    <button type="button" class="text-btn" data-act="nav" data-screen="messages">💬 Enviar mensagem no WhatsApp</button>
    <p class="muted fine">O check-in só avisa a creche; ele não gera cobrança. A cobrança vem da presença confirmada pela creche ou do que você marca no calendário.</p>
  </div>`;
}

function balanceHtml() {
  const ym = monthOf(todayIso());
  const owed = monthOwed(ym), pend = monthPending(ym);
  const status = Pure.monthStatus(owed, pend);
  const label = { vazio: "Sem lançamentos", pago: "Pago", parcial: "Parcial", aberto: "Em aberto" }[status];
  const count = Object.entries(allCharges()).filter(([d, v]) => d.startsWith(ym) && v > 0).length;
  const cover = coverageLabel(ym);
  return `<div class="section-title"><h2>Conta do mês</h2><button type="button" class="text-btn" data-act="nav" data-screen="payments">Pagamentos ›</button></div>
  <div class="hero card"><div>
    <span class="muted">Em aberto este mês</span>
    <div class="big-number">${money(pend)}</div>
    <div class="hero-meta"><span class="pill">${count} ida${count === 1 ? "" : "s"} com cobrança</span>
      <span class="payment-badge ${status === "pago" ? "paid" : "unpaid"}">${label}</span></div>
    ${cover ? `<div class="hero-cover muted">${esc(cover)}</div>` : owed ? `<div class="hero-cover muted">Nenhum pagamento cobre este mês</div>` : ""}
  </div></div>`;
}

function tripsHtml(pet) {
  if (!pet) return "";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const rows = [];
  for (let i = 0; i < 21 && rows.length < 5; i++) {
    const d = new Date(today); d.setDate(today.getDate() + i);
    if (!pet.weekdays.map(Number).includes(d.getDay())) continue;
    const s = isoOf(d), ds = dayState(s);
    const label = ds.st === "none" ? "Ainda não registrado" : ds.from === "creche" ? "Confirmado pela creche" : "Registrado por você";
    rows.push(`<div class="trip"><div><b>${esc(d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" }))}</b><small>${label}</small></div><span class="amount">${ds.st === "none" ? "—" : money(chargeOf(s))}</span></div>`);
  }
  return `<div class="section-title"><h2>Próximas idas</h2><button type="button" class="text-btn" data-act="nav" data-screen="calendar">Ver calendário</button></div>
    <div class="card list">${rows.join("") || "<div class='trip'>Nenhuma ida configurada. Escolha os dias em Perfil → Pets.</div>"}</div>`;
}

act("selectPet", el => {
  S.activePetId = el.dataset.id;
  try { localStorage.setItem("arya.pet." + S.user.id, S.activePetId); } catch (e) { /* ignorar */ }
  updateChrome(); renderTutorHome();
});
act("goProfileTab", el => { T.profileTab = el.dataset.tab; navigate("profile"); });

act("checkin", async el => {
  const pet = activePet();
  if (!pet) throw new Error("Cadastre o pet antes de fazer o check-in.");
  const coming = el.dataset.v === "1";
  const row = {
    user_id: S.user.id, day: todayIso(), pet_id: pet.id, pet_name: pet.name,
    tutor_name: (S.profile.owner1_name || "").slice(0, 80), status: coming ? "coming" : "not_coming"
  };
  const saved = must(await sb.from("day_checkins").upsert(row, { onConflict: "pet_id,day" }).select().single());
  S.checkins = S.checkins.filter(c => c.pet_id !== pet.id).concat(saved);
  renderTutorHome();
  toast(S.creche ? (coming ? `Avisado: a creche sabe que ${pet.name} vem hoje.` : `Avisado: a creche sabe que ${pet.name} não vai hoje.`) : "Registrado aqui. Vincule uma creche para ela receber o aviso.", "ok", 4500,
    { label: "Desfazer", fn: () => undoCheckin() });
});
async function undoCheckin() {
  const pet = activePet(); if (!pet) return;
  const ci = S.checkins.find(c => c.pet_id === pet.id); if (!ci) return;
  must(await sb.from("day_checkins").delete().eq("id", ci.id));
  S.checkins = S.checkins.filter(c => c.id !== ci.id);
  if (currentScreen === "home") renderTutorHome();
  toast("Aviso desfeito.");
}
act("undoCheckin", () => undoCheckin());

/* ===================== CALENDÁRIO ===================== */
act("calMonth", el => { T.view.setMonth(T.view.getMonth() + Number(el.dataset.n)); renderCalendar(); });

function renderCalendar() {
  const y = T.view.getFullYear(), m = T.view.getMonth(), ym = `${y}-${pad(m + 1)}`;
  const monthName = T.view.toLocaleDateString("pt-BR", { month: "long" });
  $("calendarTitle").textContent = cap(monthName) + " " + y;
  const first = new Date(y, m, 1).getDay(), last = new Date(y, m + 1, 0).getDate();
  const pt = paidThrough();
  const payDates = new Set(S.payments.map(p => p.date && String(p.date).slice(0, 10)).filter(Boolean));
  let html = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(x => `<div class="dow" role="columnheader">${x}</div>`).join("");
  for (let i = 0; i < first; i++) html += `<div class="day empty" role="gridcell"></div>`;
  for (let d = 1; d <= last; d++) {
    const s = iso(y, m, d), { st, from } = dayState(s), charge = chargeOf(s);
    const billable = (st === "was" || st === "over") && charge > 0;
    const isPaid = billable && pt && s <= pt, isOpen = billable && !isPaid;
    let cl = st === "not" ? "not" : st === "over" ? "over" : st === "was" ? "was" : "";
    if (isPaid) cl += " paid-day"; else if (isOpen) cl += " open-day";
    if (from === "creche") cl += " conf";
    const isPayReg = payDates.has(s);
    if (isPayReg) cl += " pay-reg";
    let label = st === "was" ? "FOI" : st === "over" ? "PERNOITE" : st === "not" ? "NÃO FOI" : isPayReg ? "PAGOU" : "—";
    if (isOpen) label += " (em aberto)";
    const aria = `${d} de ${monthName}: ${{ was: "foi", over: "foi com pernoite", not: "não foi", none: "sem registro" }[st]}${from === "creche" ? ", confirmado pela creche" : ""}${isPaid ? ", pago" : isOpen ? ", em aberto" : ""}${isPayReg ? ", pagamento registrado" : ""}`;
    html += `<button type="button" class="day ${cl.trim()}" role="gridcell" data-act="editDay" data-day="${s}" aria-label="${esc(aria)}">
      <div class="num">${d}</div>${isPaid ? '<div class="paid-badge" aria-hidden="true">💰</div>' : ""}${isPayReg ? '<div class="pay-reg-badge" aria-hidden="true">💳</div>' : ""}
      <div class="state">${esc(label)}${from === "creche" ? " 🏠" : ""}</div></button>`;
  }
  $("calGrid").innerHTML = html;
  const owed = monthOwed(ym), pend = monthPending(ym), status = Pure.monthStatus(owed, pend);
  const info = coverageLabel(ym) || (owed ? "Sem pagamento cobrindo este mês" : "");
  $("calSummary").innerHTML = `<span>Total do mês</span><strong>${money(owed)}</strong>
    <span class="payment-badge ${status === "pago" ? "paid" : "unpaid"}">${{ vazio: "Sem lançamentos", pago: "Pago", parcial: "Parcial", aberto: "Pendente" }[status]}</span>
    ${info ? `<div class="calendar-pay-info muted">${esc(info)}</div>` : ""}`;
}

act("editDay", el => {
  const s = el.dataset.day, d = dateObj(s), atts = S.attByDay[s] || [];
  const stLabel = { presente: "presente", saiu: "saiu", faltou: "faltou" };
  const info = atts.length
    ? `<p class="info-line">🏠 A creche registrou: ${atts.map(a => `${esc((petById(a.pet_id) || {}).name || "Pet")} — ${stLabel[a.status]}${a.overnight ? " (pernoite)" : ""}${a.arrived_at ? " às " + formatTime(a.arrived_at) : ""}`).join("; ")}</p>`
    : "";
  const opt = (st, icon, name, price) => `<button type="button" class="option" data-act="setDay" data-day="${s}" data-st="${st}"><strong>${icon} ${name}</strong><small>${price}</small></button>`;
  const wk = isWeekendIso(s);
  openModal("Registrar " + d.toLocaleDateString("pt-BR"), `${info}
    ${opt("was", "🟢", "Foi", wk && S.pricing.weekendDay === 0 ? "Sem cobrança (fim de semana sem pernoite)" : money(priceFor(s, "was", S.pricing)))}
    ${opt("over", "🛏️", "Foi + pernoite", money(priceFor(s, "over", S.pricing)))}
    ${opt("not", "🔴", "Não foi", "R$ 0,00")}
    ${opt("none", "⚪", "Limpar meu registro", atts.length ? "Volta ao que a creche confirmou" : "Sem cobrança")}`);
});
act("setDay", async el => {
  const s = el.dataset.day, r = el.dataset.st;
  if (r === "none") { must(await sb.from("creche_records").delete().eq("user_id", S.user.id).eq("date", s)); delete S.records[s]; }
  else { must(await sb.from("creche_records").upsert({ user_id: S.user.id, date: s, status: r }, { onConflict: "user_id,date" })); S.records[s] = r; }
  S._charges = null;
  closeModal();
  renderCalendar();
});

/* ===================== PAGAMENTOS ===================== */
const PAY_STATUS = { enviado: "Enviado à creche", confirmado: "Confirmado", recusado: "Recusado" };

function renderTutorPix() {
  const el = $("tPixCard"); if (!el) return;
  if (S.creche) {
    const keys = Array.isArray(S.creche.pix_keys) ? S.creche.pix_keys : [];
    el.innerHTML = `<h3>💸 PIX de ${esc(S.creche.name || "sua creche")}</h3>` + (keys.length
      ? `<div class="pix-keys-list">${keys.map(k => `<div class="pix-key-card"><span class="pix-type-badge">${esc(k.type || "PIX")}</span><span class="pix-key-val">${esc(k.key)}</span><button type="button" class="btn secondary" data-act="pixCopyKey" data-key="${esc(k.key)}">📋 Copiar</button></div>`).join("")}</div>`
      : `<p class="muted">A creche ainda não cadastrou uma chave PIX. Peça a chave a ela.</p>`);
  } else renderPixManager("tutor", "tPixCard", "💸 Chaves PIX (para pagar a creche)");
}

function renderPayments() {
  renderTutorPix();
  const year = new Date().getFullYear(), pt = paidThrough(), charges = allCharges();
  // chips de mês
  $("payMonthChips").innerHTML = MONTHS_ABBR.map((label, i) => {
    const ym = `${year}-${pad(i + 1)}`, pend = monthPending(ym);
    return `<button type="button" class="month-chip ${pend > 0 ? "has-pending" : ""} ${T.payMonths.has(ym) ? "selected" : ""}" data-act="togglePayMonth" data-ym="${ym}" aria-pressed="${T.payMonths.has(ym)}"><b>${label}</b>${pend > 0 ? `<small>${money(pend)}</small>` : ""}</button>`;
  }).join("");
  $("payMonthsLabel").textContent = T.payMonths.size === 0 ? "Todos os meses" : `${T.payMonths.size} ${T.payMonths.size === 1 ? "mês" : "meses"}`;
  let total = 0, pending = 0;
  Object.entries(charges).forEach(([d, v]) => {
    if (T.payMonths.size && !T.payMonths.has(d.slice(0, 7))) return;
    total += v; if (!pt || d > pt) pending += v;
  });
  $("payTotal").textContent = money(pending);
  $("payState").textContent = total === 0 ? "Sem lançamentos" : pending === 0 ? "Pago" : "Pendente";
  // período
  const pf = getVal("periodFrom"), pto = getVal("periodTo");
  const per = Pure.sumCharges(charges, { from: pf || undefined, to: pto || undefined }), perPend = Pure.sumCharges(charges, { from: pf || undefined, to: pto || undefined, after: pt || undefined });
  $("periodTotal").textContent = money(perPend);
  $("periodState").textContent = per === 0 ? "Sem lançamentos" : perPend === 0 ? "Pago" : "Pendente";
  $("periodState").className = "payment-badge " + (per > 0 && perPend === 0 ? "paid" : "unpaid");
  // atalhos "pagar mês"
  const open = MONTHS_ABBR.map((l, i) => ({ l, ym: `${year}-${pad(i + 1)}`, p: monthPending(`${year}-${pad(i + 1)}`) })).filter(x => x.p > 0);
  $("payQuick").innerHTML = open.length ? `<p class="muted">Pagar rápido:</p><div class="chips">${open.map(x => `<button type="button" class="chip" data-act="payMonth" data-ym="${x.ym}">${x.l} · ${money(x.p)}</button>`).join("")}</div>` : "";
  if (!getVal("payDate")) setVal("payDate", todayIso());
  recalcPay();
  // histórico
  const linked = !!S.creche;
  $("payHistory").innerHTML = S.payments.length ? S.payments.slice().reverse().map(p => {
    const st = p.status || "enviado", locked = st === "confirmado";
    const thru = Pure.effectivePaidThrough(p);
    return `<div class="payment-row"><div><b>${esc(formatBRDate(p.date))}</b><small>${esc(p.note || "Sem nota")}</small>${thru ? `<small>Cobre até ${esc(formatBRDate(thru))}</small>` : ""}
      ${linked ? `<span class="payment-badge ${st === "confirmado" ? "paid" : st === "recusado" ? "refused" : "pending"}">${PAY_STATUS[st]}</span>` : ""}
      ${p.attachment_path ? `<span class="attach-row"><button type="button" class="attach-link" data-act="openAttachment" data-path="${esc(p.attachment_path)}">📎 Ver comprovante</button>${locked ? "" : `<button type="button" class="attach-remove" data-act="removeAttachment" data-id="${p.id}" aria-label="Remover comprovante">🗑️</button>`}</span>` : ""}
      </div><div class="payment-row-right"><b>${money(p.value)}</b>${locked ? "" : `<button type="button" class="attach-remove" data-act="deletePayment" data-id="${p.id}" aria-label="Excluir pagamento">🗑️</button>`}</div></div>`;
  }).join("") : "<small>Nenhum pagamento registrado.</small>";
}
act("togglePayMonth", el => { const ym = el.dataset.ym; T.payMonths.has(ym) ? T.payMonths.delete(ym) : T.payMonths.add(ym); renderPayments(); });
act("clearPayMonths", () => { T.payMonths.clear(); renderPayments(); });
onChange("renderPayments", () => renderPayments());
act("openAttachment", el => openAttachment(el.dataset.path));

function recalcPay() {
  const hint = $("payHint"); if (!hint) return;
  const v = Pure.parseMoney(getVal("payValue")), through = getVal("payThrough");
  if (!through) { hint.textContent = ""; return; }
  const due = Pure.dueThrough(allCharges(), paidThrough(), through);
  if (!v.ok) { hint.textContent = `Devido até ${formatBRDate(through)}: ${money(due)}.`; return; }
  const diff = Math.round((v.value - due) * 100) / 100;
  hint.textContent = `Devido até ${formatBRDate(through)}: ${money(due)}. ` + (diff < 0 ? `Faltam ${money(-diff)} (pagamento parcial).` : diff > 0 ? `Sobram ${money(diff)} (crédito).` : "Confere ✓");
}
onInput("recalcPay", () => recalcPay());
onChange("recalcPay", () => recalcPay());
act("payMonth", el => {
  const ym = el.dataset.ym, end = Pure.monthEnd(ym);
  setVal("payThrough", end);
  setVal("payValue", String(Pure.dueThrough(allCharges(), paidThrough(), end)).replace(".", ","));
  recalcPay();
  $("payForm").scrollIntoView({ behavior: "smooth", block: "start" });
});
act("pickPayFile", () => $("payFile").click());
function payFileChanged() {
  const f = $("payFile").files[0];
  if (f) { const v = Pure.validateUpload(f); if (!v.ok) { $("payFile").value = ""; toast(v.msg, "err"); } }
  const ff = $("payFile").files[0];
  $("payFileName").textContent = ff ? ff.name : "Nenhum arquivo escolhido";
  $("payFileClear").classList.toggle("hidden", !ff);
}
onChange("payFileChanged", () => payFileChanged());
act("clearPayFile", () => { $("payFile").value = ""; payFileChanged(); });

let choiceResolve = null, choiceVals = [];
function choiceDialog(title, message, choices) {
  return new Promise(resolve => {
    let done = false;
    const fin = v => { if (done) return; done = true; choiceResolve = null; resolve(v); };
    choiceResolve = fin; choiceVals = choices.map(c => c.value);
    openModal(title, `<p>${esc(message)}</p><div class="col-btns">${choices.map((c, i) => `<button type="button" class="btn ${c.cls || "secondary"}" data-act="choicePick" data-i="${i}">${esc(c.label)}</button>`).join("")}</div>`, { onClose: () => fin(null) });
  });
}
act("choicePick", el => { const r = choiceResolve, v = choiceVals[Number(el.dataset.i)]; if (r) r(v); closeModal(); });

act("registerPayment", async () => {
  const date = getVal("payDate") || todayIso();
  const money_ = Pure.parseMoney(getVal("payValue"));
  if (!money_.ok) throw new Error(money_.msg);
  let through = getVal("payThrough");
  if (!through) throw new Error("Informe até que data este pagamento cobre as idas.");
  const pt = paidThrough();
  if (pt && through <= pt && !(await confirmDialog(`Você já tem pagamento cobrindo até ${formatBRDate(pt)}. Registrar este também?`))) return;
  const charges = allCharges(), due = Pure.dueThrough(charges, pt, through);
  if (money_.value < due - 0.005) {
    const cov = Pure.coverageForValue(charges, pt, money_.value);
    const choice = await choiceDialog("Valor menor que o devido",
      `Até ${formatBRDate(through)} o devido é ${money(due)}, mas o pagamento é de ${money(money_.value)}.`,
      [cov.through ? { label: `Ajustar: cobrir até ${formatBRDate(cov.through)} (${money(cov.covered)})`, value: "adjust", cls: "pink-btn" } : null,
        { label: "Registrar assim mesmo (marca tudo até a data como pago)", value: "keep" },
        { label: "Cancelar", value: null }].filter(Boolean));
    if (!choice) return;
    if (choice === "adjust") through = cov.through;
  }
  const file = $("payFile").files[0];
  let attachment = { attachment_path: null, attachment_type: null, attachment_name: null };
  if (file) {
    const v = Pure.validateUpload(file); if (!v.ok) throw new Error(v.msg);
    const path = `${S.user.id}/payments/${crypto.randomUUID()}-${Pure.safeFileName(file.name)}`;
    must(await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type }));
    attachment = { attachment_path: path, attachment_type: file.type, attachment_name: file.name.slice(0, 120) };
  }
  try {
    must(await sb.from("creche_payments").insert({ user_id: S.user.id, date, value: money_.value, note: getVal("payNote").trim().slice(0, 200), paid_through: through, ...attachment }));
  } catch (e) {
    if (attachment.attachment_path) await sb.storage.from(BUCKET).remove([attachment.attachment_path]).catch(() => {});
    throw e;
  }
  S.payments = must(await sb.from("creche_payments").select("*").eq("user_id", S.user.id).order("date", { ascending: true }).order("id", { ascending: true }));
  ["payValue", "payNote", "payThrough"].forEach(id => setVal(id, ""));
  $("payFile").value = ""; payFileChanged();
  renderPayments();
  toast(S.creche ? "Pagamento registrado. A creche vai confirmar." : "Pagamento registrado.");
});
act("removeAttachment", async el => {
  const p = S.payments.find(x => x.id === Number(el.dataset.id));
  if (!p || !p.attachment_path || !(await confirmDialog("Remover o comprovante deste pagamento?", { danger: true, okLabel: "Remover" }))) return;
  await updateOne("creche_payments", "id", p.id, { attachment_path: null, attachment_type: null, attachment_name: null });
  await sb.storage.from(BUCKET).remove([p.attachment_path]).catch(e => logError("remove-attachment", e));
  p.attachment_path = p.attachment_type = p.attachment_name = null;
  renderPayments();
});
act("deletePayment", async el => {
  const p = S.payments.find(x => x.id === Number(el.dataset.id));
  if (!p || !(await confirmDialog("Excluir este pagamento?", { danger: true, okLabel: "Excluir" }))) return;
  must(await sb.from("creche_payments").delete().eq("id", p.id));
  if (p.attachment_path) await sb.storage.from(BUCKET).remove([p.attachment_path]).catch(e => logError("remove-attachment", e));
  S.payments = S.payments.filter(x => x.id !== p.id);
  S._charges = null;
  renderPayments();
});

/* ===================== MENSAGENS ===================== */
function renderMessages() {
  const pet = (activePet() || {}).name || "meu pet";
  T.msgTemplates = [
    { name: "Levar " + pet, text: `Oii, chegamos daqui uns 5min com ${pet}`, icon: "🐶" },
    { name: "Buscar " + pet, text: `Oii, estamos indo buscar ${pet} 😊`, icon: "🏠" },
    { name: pet + " não vai", text: `Oii, hoje ${pet} não vai para a creche.`, icon: "❌" }
  ];
  if ($("msgText") !== document.activeElement) setVal("msgText", S.draft);
  $("msgTarget").textContent = S.creche && S.creche.phone
    ? `Vai para ${S.creche.name || "a creche"} (${formatPhoneBr(S.creche.phone)}).`
    : S.creche ? "A creche ainda não cadastrou o WhatsApp — o WhatsApp vai abrir para você escolher o contato." : "Sem creche vinculada — o WhatsApp vai abrir para você escolher o contato.";
  $("savedMessages").innerHTML = [
    ...T.msgTemplates.map((m, i) => `<div class="saved-message"><button type="button" data-act="useMessage" data-i="${i}"><span aria-hidden="true">${m.icon}</span><div><b>${esc(m.name)}</b><small>${esc(m.text)}</small></div><span aria-hidden="true">›</span></button></div>`),
    ...S.customMessages.map(m => `<div class="saved-message"><button type="button" data-act="useCustom" data-id="${m.id}"><span aria-hidden="true">💬</span><div><b>${esc(m.name)}</b><small>${esc(m.text)}</small></div><span aria-hidden="true">›</span></button><button type="button" class="delete-msg" data-act="deleteCustom" data-id="${m.id}" aria-label="Excluir mensagem ${esc(m.name)}">×</button></div>`)
  ].join("");
}
const saveDraft = debounce(async () => {
  try { must(await sb.from("creche_app_message").upsert({ user_id: S.user.id, text: S.draft }, { onConflict: "user_id" })); } catch (e) { logError("saveDraft", e); }
}, 800);
onInput("saveDraft", el => { S.draft = el.value; saveDraft(); });
act("useMessage", el => { S.draft = T.msgTemplates[Number(el.dataset.i)].text; setVal("msgText", S.draft); saveDraft(); $("msgText").focus(); });
act("useCustom", el => { const m = S.customMessages.find(x => x.id === Number(el.dataset.id)); if (m) { S.draft = m.text; setVal("msgText", S.draft); saveDraft(); $("msgText").focus(); } });
act("sendWhatsApp", () => {
  const text = getVal("msgText").trim();
  if (!text) throw new Error("Escreva a mensagem primeiro.");
  S.draft = text;
  const url = waLink(S.creche && S.creche.phone, text);
  if (!window.open(url, "_blank", "noopener")) location.href = url;
});
act("newMessage", () => openModal("Nova mensagem", `
  <label>Nome da mensagem<input id="newMsgName" maxlength="40" placeholder="Chegada mais cedo" autofocus></label>
  <label>Texto<textarea id="newMsgText" rows="5" maxlength="500" placeholder="Digite a mensagem que deseja salvar"></textarea></label>
  <button type="button" class="btn pink-btn full" data-act="saveNewMessage">✓ Salvar mensagem</button>`));
act("saveNewMessage", async () => {
  const name = getVal("newMsgName").trim(), text = getVal("newMsgText").trim();
  if (!name || !text) throw new Error("Preencha o nome e o texto da mensagem.");
  const row = must(await sb.from("creche_custom_messages").insert({ user_id: S.user.id, name, text }).select().single());
  S.customMessages.push(row);
  closeModal(); renderMessages();
});
act("deleteCustom", async el => {
  const id = Number(el.dataset.id);
  if (!(await confirmDialog("Excluir esta mensagem salva?", { danger: true, okLabel: "Excluir" }))) return;
  must(await sb.from("creche_custom_messages").delete().eq("id", id));
  S.customMessages = S.customMessages.filter(x => x.id !== id);
  renderMessages();
});

/* ===================== PERFIL ===================== */
function petBeingEdited() { return T.editingPetId && T.editingPetId !== "new" ? petById(T.editingPetId) : null; }

function renderTutorProfile() {
  if (!T.editingPetId || (T.editingPetId !== "new" && !petById(T.editingPetId))) T.editingPetId = (activePet() && activePet().id) || "new";
  document.querySelectorAll(".ptab").forEach(b => { const on = b.dataset.tab === T.profileTab; b.classList.toggle("active", on); b.setAttribute("aria-selected", String(on)); });
  ["pet", "owners", "creche", "account"].forEach(t => $("pt-" + t).classList.toggle("hidden", t !== T.profileTab));
  renderPetTab(true);
  setVal("owner1Name", S.profile.owner1_name); setVal("owner1Contact", S.profile.owner1_contact ? formatPhoneBr(S.profile.owner1_contact) : "");
  setVal("owner2Name", S.profile.owner2_name); setVal("owner2Contact", S.profile.owner2_contact ? formatPhoneBr(S.profile.owner2_contact) : "");
  renderLinkTab();
  $("tAccount").innerHTML = accountHtml();
}
act("profileTab", el => { T.profileTab = el.dataset.tab; renderTutorProfile(); });

function renderPetTab(fillFields) {
  const p = petBeingEdited();
  $("petChips").innerHTML = S.pets.map(x => `<button type="button" class="chip ${x.id === T.editingPetId ? "on" : ""}" data-act="editPet" data-id="${esc(x.id)}" aria-pressed="${x.id === T.editingPetId}">${esc(x.name)}</button>`).join("")
    + `<button type="button" class="chip ${T.editingPetId === "new" ? "on" : ""}" data-act="editPet" data-id="new">+ Novo pet</button>`;
  if (fillFields) {
    setVal("petName", p ? p.name : ""); setVal("petBreed", p ? p.breed : ""); setVal("petBirth", p ? p.birth_date : "");
    $("petOverWeek").checked = !!(p && p.overnight_weekday); $("petOverWeekend").checked = !!(p && p.overnight_weekend);
    T.petDays = p ? p.weekdays.map(Number) : [];
  }
  paintPhoto("petPhoto", p && p.photo_path, "🐶");
  $("petDeleteBtn").classList.toggle("hidden", !p);
  renderPetDays();
}
function renderPetDays() {
  $("petDays").innerHTML = ["D", "S", "T", "Q", "Q", "S", "S"].map((n, i) =>
    `<button type="button" class="${T.petDays.includes(i) ? "on" : ""}" data-act="petDay" data-i="${i}" aria-pressed="${T.petDays.includes(i)}" aria-label="${["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][i]}">${n}</button>`).join("");
}
act("petDay", el => { const i = Number(el.dataset.i); T.petDays = T.petDays.includes(i) ? T.petDays.filter(x => x !== i) : [...T.petDays, i].sort(); renderPetDays(); });
act("editPet", el => { T.editingPetId = el.dataset.id; renderPetTab(true); });

act("savePet", async () => {
  const name = getVal("petName").trim();
  if (!name) throw new Error("Informe o nome do pet.");
  const row = {
    name, breed: getVal("petBreed").trim(), birth_date: getVal("petBirth") || null, weekdays: T.petDays.slice().sort(),
    overnight_weekday: $("petOverWeek").checked, overnight_weekend: $("petOverWeekend").checked,
    tutor_name: (S.profile.owner1_name || "").slice(0, 80), tutor_phone: onlyDigits(S.profile.owner1_contact || "").slice(0, 20)
  };
  let saved;
  if (T.editingPetId === "new") {
    saved = must(await sb.from("pets").insert({ ...row, tutor_user_id: S.user.id }).select().single());
    S.pets.push(saved);
  } else {
    saved = await updateOne("pets", "id", T.editingPetId, row);
    S.pets = S.pets.map(p => p.id === saved.id ? saved : p);
  }
  T.editingPetId = saved.id;
  if (!S.activePetId || !petById(S.activePetId)) S.activePetId = saved.id;
  updateChrome(); renderPetTab(true);
  flashHint("petHint");
});
act("deletePet", async () => {
  const p = petBeingEdited(); if (!p) return;
  if (!(await confirmDialog(`Excluir ${p.name}? Os check-ins e a presença deste pet também serão apagados.`, { danger: true, okLabel: "Excluir" }))) return;
  must(await sb.from("pets").delete().eq("id", p.id));
  if (p.photo_path) sb.storage.from(BUCKET).remove([p.photo_path]).catch(() => {});
  S.pets = S.pets.filter(x => x.id !== p.id);
  if (S.activePetId === p.id) S.activePetId = S.pets[0] ? S.pets[0].id : null;
  T.editingPetId = null;
  updateChrome(); renderTutorProfile();
  toast("Pet excluído.");
});

act("saveOwners", async () => {
  const c1 = validateOptionalPhone(getVal("owner1Contact"), "Telefone do dono 1");
  const c2 = validateOptionalPhone(getVal("owner2Contact"), "Telefone do dono 2");
  const n1 = getVal("owner1Name").trim(), n2 = getVal("owner2Name").trim();
  const row = await updateOne("creche_profile", "user_id", S.user.id, { owner1_name: n1, owner1_contact: c1, owner2_name: n2, owner2_contact: c2 });
  S.profile = row;
  // a creche fala com o tutor por aqui → sincroniza nos pets
  must(await sb.from("pets").update({ tutor_name: n1.slice(0, 80), tutor_phone: onlyDigits(c1).slice(0, 20) }).eq("tutor_user_id", S.user.id));
  S.pets.forEach(p => { p.tutor_name = n1.slice(0, 80); p.tutor_phone = onlyDigits(c1).slice(0, 20); });
  setVal("owner1Contact", c1); setVal("owner2Contact", c2);
  flashHint("ownersHint");
});
function validateOptionalPhone(raw, label) {
  const t = String(raw || "").trim();
  if (!t) return "";
  const c = Pure.validateTelefone(t);
  if (!c.ok) throw new Error(label + ": " + c.msg);
  return c.value;
}
act("clearOwners", async () => {
  if (!(await confirmDialog("Limpar os dados dos donos?", { danger: true, okLabel: "Limpar" }))) return;
  ["owner1Name", "owner1Contact", "owner2Name", "owner2Contact"].forEach(id => setVal(id, ""));
  await ACTIONS.saveOwners();
});

/* ---------- vínculo com a creche ---------- */
function renderLinkTab() {
  const el = $("linkCard");
  if (S.creche) {
    el.innerHTML = card(`<h3>🏠 ${esc(S.creche.name || "Sua creche")}</h3>
      <p class="muted">${S.creche.phone ? "WhatsApp: " + esc(formatPhoneBr(S.creche.phone)) : "A creche ainda não cadastrou o WhatsApp."}</p>
      <p>Seus check-ins chegam para esta creche, e você vê os valores e o PIX dela no app.</p>
      <button type="button" class="btn secondary danger-outline" data-act="leaveCreche">Sair desta creche</button>`);
  } else {
    el.innerHTML = card(`<h3>Vincular à creche</h3>
      <p class="muted">Peça o <b>código de convite</b> à creche (8 letras/números) e digite abaixo.</p>
      <label for="joinCode">Código de convite</label>
      <div class="input-with-btn"><input id="joinCode" maxlength="8" autocomplete="off" autocapitalize="characters" placeholder="ABCD1234"><button type="button" class="btn pink-btn" data-act="joinCreche">Vincular</button></div>`);
  }
}
act("joinCreche", async () => {
  const code = getVal("joinCode").trim();
  if (code.length < 6) throw new Error("Digite o código de convite completo.");
  const { error } = await sb.rpc("join_creche", { p_code: code });
  if (error) throw new Error(/codigo_invalido/.test(error.message) ? "Código não encontrado. Confira com a creche." : /creche_nao_pode/.test(error.message) ? "Contas de creche não podem se vincular." : error.message);
  await loadTutorData(); updateChrome(); renderTutorProfile();
  toast(`Vinculado a ${S.creche ? S.creche.name || "sua creche" : "creche"}!`);
});
act("leaveCreche", async () => {
  if (!(await confirmDialog("Sair desta creche? Ela deixará de receber seus avisos.", { danger: true, okLabel: "Sair da creche" }))) return;
  must(await sb.rpc("leave_creche"));
  await loadTutorData(); updateChrome(); renderTutorProfile();
  toast("Você saiu da creche.");
});
