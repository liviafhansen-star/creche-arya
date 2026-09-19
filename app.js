// ---- Conexão com o Supabase (banco de dados online) ----
const SUPABASE_URL = "https://svtlpvsfdmfdrgzhpbvz.supabase.co";
const SUPABASE_KEY = "sb_publishable_u1RNww4af2uybpEGbEicmw_Nh2cR_3R";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const BUCKET = "creche-anexos";

let data = {
  profile: { name: "Arya", days: [2, 4, 6, 0], weekday_overnight: "Não", weekend_overnight: "Sim", pix_key: "", pix_type: "", photo_path: null, birth_date: null, breed: "", owner1_name: "", owner1_contact: "", owner2_name: "", owner2_contact: "" },
  records: {}, payments: [], customMessages: [],
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
async function loadAll() {
  const [{ data: profileRow }, { data: msgRow }, { data: recordRows }, { data: paymentRows }, { data: customRows }] = await Promise.all([
    sb.from("creche_profile").select("*").eq("id", 1).maybeSingle(),
    sb.from("creche_app_message").select("text").eq("id", 1).maybeSingle(),
    sb.from("creche_records").select("date,status"),
    sb.from("creche_payments").select("*").order("id", { ascending: true }),
    sb.from("creche_custom_messages").select("*").order("id", { ascending: true }),
  ]);
  if (profileRow) data.profile = profileRow;
  if (msgRow) data.message = msgRow.text;
  data.records = {}; (recordRows || []).forEach(r => data.records[r.date] = r.status);
  data.payments = paymentRows || [];
  data.customMessages = customRows || [];
  renderAll();
}

function go(id) { document.querySelectorAll(".screen").forEach(x => x.classList.remove("active")); document.getElementById(id).classList.add("active"); document.querySelectorAll(".nav button").forEach(x => x.classList.toggle("active", x.dataset.screen === id)); renderAll(); scrollTo(0, 0) }

function renderAll() { renderHome(); renderOpenMonths(); renderCalendar(); renderProfile(); renderPayments(); renderSavedMessages(); document.getElementById("messageText").value = data.message }

let openMonthsSelected = null;
const MESES_ABREV = ["Jan.", "Fev.", "Mar.", "Abr.", "Mai.", "Jun.", "Jul.", "Ago.", "Set.", "Out.", "Nov.", "Dez."];
function computeYearSummary() {
  const year = new Date().getFullYear();
  const owedByMonth = {};
  Object.entries(data.records).forEach(([s, r]) => { const ym = s.slice(0, 7); owedByMonth[ym] = (owedByMonth[ym] || 0) + priceFor(s, r) });
  const paidByMonth = {};
  data.payments.forEach(p => { const ym = (p.date || "").slice(0, 7); paidByMonth[ym] = (paidByMonth[ym] || 0) + Number(p.value || 0) });
  return Array.from({ length: 12 }, (_, i) => {
    const ym = `${year}-${pad(i + 1)}`;
    const owed = owedByMonth[ym] || 0, paid = paidByMonth[ym] || 0, pending = Math.max(0, owed - paid);
    return { ym, label: MESES_ABREV[i], owed, paid, pending, isPago: owed > 0 && paid >= owed };
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

function renderHome() {
  const now = new Date();
  let ym = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`, total = 0, count = 0;
  Object.entries(data.records).forEach(([s, r]) => { if (s.startsWith(ym)) { total += priceFor(s, r); if (r !== "none") count++ } });
  const monthPaid = data.payments.filter(p => p.date && p.date.slice(0, 7) === ym).reduce((a, p) => a + Number(p.value || 0), 0);
  const pending = Math.max(0, total - monthPaid);
  document.getElementById("monthTotal").textContent = money(pending);
  document.getElementById("monthStatus").textContent = `${count} ida${count === 1 ? "" : "s"} registrada${count === 1 ? "" : "s"}`;
  const statusEl = document.getElementById("monthPaymentStatus");
  statusEl.textContent = (total > 0 && monthPaid >= total) ? "Pago" : "Não Pago";
  statusEl.className = "payment-badge " + ((total > 0 && monthPaid >= total) ? "paid" : "unpaid");
  let el = document.getElementById("nextTrips"), dates = [];
  let today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = 0; i < 21; i++) { let d = new Date(today); d.setDate(today.getDate() + i); let s = iso(d.getFullYear(), d.getMonth(), d.getDate()); let dow = d.getDay(); if (data.profile.days.includes(dow)) dates.push({ s, d }) }
  el.innerHTML = dates.slice(0, 5).map(x => `<div class="trip"><div><b>${x.d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })}</b><small>${data.records[x.s] && data.records[x.s] !== "none" ? "Registrado" : "Ainda não registrado"}</small></div><span class="amount">${data.records[x.s] ? money(priceFor(x.s, data.records[x.s])) : "—"}</span></div>`).join("") || "<div class='trip'>Nenhuma ida configurada.</div>"
}
function maxPaidThrough() {
  return data.payments.reduce((max, p) => (p.paid_through && (!max || p.paid_through > max)) ? p.paid_through : max, null);
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
  for (let d = 1; d <= last; d++) {
    let s = iso(y, m, d), r = data.records[s] || "none", cl = r === "was" ? "was" : r === "not" ? "not" : r === "over" ? "over" : "";
    monthOwed += priceFor(s, r);
    const isPaid = (r === "was" || r === "over") && paidThrough && s <= paidThrough;
    html += `<button class="day ${cl}" onclick="editDay('${s}')"><div class="num">${d}</div>${isPaid ? '<div class="paid-badge">💰</div>' : ""}<div class="state">${r === "was" ? "FOI" : r === "not" ? "NÃO FOI" : r === "over" ? "PERNOITE" : "—"}</div></button>`;
  }
  grid.innerHTML = html;
  monthPaid = data.payments.filter(p => p.date && p.date.slice(0, 7) === ym).reduce((a, p) => a + Number(p.value || 0), 0);
  document.getElementById("calendarMonthTotal").textContent = money(monthOwed);
  const csEl = document.getElementById("calendarMonthState");
  const monthPago = monthOwed > 0 && monthPaid >= monthOwed;
  csEl.textContent = monthOwed === 0 ? "Sem lançamentos" : monthPago ? "Pago" : "Pendente";
  csEl.className = "payment-badge " + (monthPago ? "paid" : "unpaid");
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
      const { error } = await sb.from("creche_records").delete().eq("date", s);
      if (error) throw error;
      delete data.records[s];
    } else {
      const { error } = await sb.from("creche_records").upsert({ date: s, status: r }, { onConflict: "date" });
      if (error) throw error;
      data.records[s] = r;
    }
  } catch (err) {
    console.error(err);
    alert("Não consegui salvar esse dia. Confira sua internet e tenta de novo.\n(" + (err.message || err) + ")");
  }
  renderAll();
}
function prepareMessage(type) { let msg = { take: "Oii, chegamos daqui uns 5min com a Arya", pickup: "Oii, estamos indo buscar a Arya 😊", notgo: "Oii, hoje a Arya não vai para a creche." }[type]; data.message = msg; saveMessageText(msg); go("messages"); setTimeout(analyzeMessage, 50) }
function newMessage() {
  openModal("Nova mensagem", `
    <label>Nome da mensagem<input id="newMsgName" placeholder="Ex.: Chegada mais cedo"></label>
    <label>Texto<textarea id="newMsgText" rows="5" placeholder="Digite a mensagem que deseja salvar"></textarea></label>
    <button class="btn pink-btn full" onclick="saveNewMessage()">✓ Salvar mensagem</button>
  `);
}
async function saveNewMessage() {
  const name = document.getElementById("newMsgName").value.trim();
  const text = document.getElementById("newMsgText").value.trim();
  if (!name || !text) { alert("Preencha o nome e o texto da mensagem."); return }
  await sb.from("creche_custom_messages").insert({ name, text });
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
async function saveMessageText(t) { data.message = t; await sb.from("creche_app_message").upsert({ id: 1, text: t }, { onConflict: "id" }) }
function analyzeMessage() { let t = document.getElementById("messageText").value.trim(); saveMessageText(t); let low = t.toLowerCase(), status = low.includes("não vai") || low.includes("nao vai") ? "❌ Não vai" : (low.includes("cheg") || low.includes("com a arya")) ? "🐶 Levar Arya" : "❓ Não identifiquei a ação"; document.getElementById("analysis").classList.remove("hidden"); document.getElementById("analysis").innerHTML = `<b>Entendi:</b> ${status}<br><span>Tu ainda pode editar a mensagem antes de enviar.</span>` }
function sendWhatsApp() { let t = document.getElementById("messageText").value.trim(); saveMessageText(t); let text = encodeURIComponent(t); window.location.href = `https://wa.me/?text=${text}` }

function renderProfile() {
  let p = data.profile;
  document.getElementById("dogName").value = p.name;
  document.getElementById("pixKey").value = p.pix_key;
  document.getElementById("pixType").value = p.pix_type;
  document.getElementById("birthDate").value = p.birth_date || "";
  document.getElementById("breed").value = p.breed || "";
  document.getElementById("owner1Name").value = p.owner1_name || "";
  document.getElementById("owner1Contact").value = p.owner1_contact || "";
  document.getElementById("owner2Name").value = p.owner2_name || "";
  document.getElementById("owner2Contact").value = p.owner2_contact || "";
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
  await sb.from("creche_profile").update({ [col]: value }).eq("id", 1);
}
function switchProfileTab(tab) {
  document.querySelectorAll(".ptab").forEach(b => b.classList.toggle("active", b.dataset.ptab === tab));
  document.getElementById("profileArya").classList.toggle("hidden", tab !== "arya");
  document.getElementById("profileDonos").classList.toggle("hidden", tab !== "donos");
}
async function toggleDay(i) { let a = data.profile.days; data.profile.days = a.includes(i) ? a.filter(x => x !== i) : [...a, i]; await sb.from("creche_profile").update({ days: data.profile.days }).eq("id", 1); renderProfile() }
async function saveProfile() {
  let p = data.profile;
  p.name = document.getElementById("dogName").value || "Arya";
  p.pix_key = document.getElementById("pixKey").value;
  p.pix_type = document.getElementById("pixType").value;
  p.birth_date = document.getElementById("birthDate").value || null;
  p.breed = document.getElementById("breed").value;
  p.owner1_name = document.getElementById("owner1Name").value;
  p.owner1_contact = document.getElementById("owner1Contact").value;
  p.owner2_name = document.getElementById("owner2Name").value;
  p.owner2_contact = document.getElementById("owner2Contact").value;
  await sb.from("creche_profile").update({ name: p.name, pix_key: p.pix_key, pix_type: p.pix_type, birth_date: p.birth_date, breed: p.breed, owner1_name: p.owner1_name, owner1_contact: p.owner1_contact, owner2_name: p.owner2_name, owner2_contact: p.owner2_contact }).eq("id", 1);
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
    const path = `profile/${crypto.randomUUID()}.jpg`;
    await sb.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: "image/jpeg" });
    data.profile.photo_path = path;
    await sb.from("creche_profile").update({ photo_path: path }).eq("id", 1);
    cropper.destroy(); cropper = null;
    closeModal();
    renderProfile();
  }, "image/jpeg", 0.9);
}
function renderSavedMessages() {
  const el = document.getElementById("savedMessages");
  if (!el) return;
  const built = [
    { name: "Levar Arya", text: "Oii, chegamos daqui uns 5min com a Arya", action: "prepareMessage('take')", icon: "🐶" },
    { name: "Buscar Arya", text: "Oii, estamos indo buscar a Arya 😊", action: "prepareMessage('pickup')", icon: "🏠" },
    { name: "Arya não vai", text: "Oii, hoje a Arya não vai para a creche.", action: "prepareMessage('notgo')", icon: "❌" }
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
  let total = Object.entries(data.records).reduce((a, [s, r]) => (sel.size === 0 || sel.has(s.slice(0, 7))) ? a + priceFor(s, r) : a, 0);
  document.getElementById("paymentTotal").textContent = money(total);
  let paid = data.payments.reduce((a, p) => (sel.size === 0 || sel.has((p.date || "").slice(0, 7))) ? a + Number(p.value || 0) : a, 0);
  document.getElementById("paymentState").textContent = paid >= total && total > 0 ? "Pago" : total === 0 ? "Sem lançamentos" : "Pendente";

  const pf = document.getElementById("periodFrom").value, pt = document.getElementById("periodTo").value;
  let periodTotal = 0;
  Object.entries(data.records).forEach(([s, r]) => { if (s >= pf && s <= pt) periodTotal += priceFor(s, r) });
  let periodPaid = data.payments.filter(p => p.date >= pf && p.date <= pt).reduce((a, p) => a + Number(p.value), 0);
  document.getElementById("periodTotal").textContent = money(periodTotal);
  const psEl = document.getElementById("periodState");
  const periodPago = periodTotal > 0 && periodPaid >= periodTotal;
  psEl.textContent = periodTotal === 0 ? "Sem lançamentos" : periodPago ? "Pago" : "Pendente";
  psEl.className = "payment-badge " + (periodPago ? "paid" : "unpaid");

  document.getElementById("paymentHistory").innerHTML = data.payments.length ? data.payments.slice().reverse().map(p => {
    const attach = p.attachment_path ? `<span class="attach-row"><button class="attach-link" onclick="window.open('${publicUrl(p.attachment_path)}','_blank')">📎 Ver comprovante</button><button class="attach-remove" onclick="removeAttachment(${p.id})" title="Remover anexo">🗑️</button></span>` : "";
    return `<div class="payment-row"><div><b>${dateObj(p.date).toLocaleDateString("pt-BR")}</b><small>${p.note || "Sem nota"}</small>${attach}</div><div class="payment-row-right"><b>${money(p.value)}</b><button class="attach-remove" onclick="deletePaymentRow(${p.id})" title="Excluir pagamento">🗑️</button></div></div>`;
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
  let attachment_path = null, attachment_type = null, attachment_name = null;
  if (file) {
    attachment_path = `payments/${crypto.randomUUID()}-${file.name}`;
    await sb.storage.from(BUCKET).upload(attachment_path, file, { contentType: file.type });
    attachment_type = file.type; attachment_name = file.name;
  }
  await sb.from("creche_payments").insert({ date, value, note, paid_through, attachment_path, attachment_type, attachment_name });
  document.getElementById("paymentValue").value = "";
  document.getElementById("paymentNote").value = "";
  document.getElementById("paidThrough").value = "";
  if (fileInput) fileInput.value = "";
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
function copyPix() {
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

// ---- Login / acesso ----
let authView = "login"; // "login" | "signup" — survives initAuth/onAuthStateChange
function showApp(show) {
  const login = document.getElementById("loginScreen");
  const signup = document.getElementById("signupScreen");
  const shell = document.getElementById("appShell");
  if (show) {
    login.classList.add("hidden");
    signup.classList.add("hidden");
    shell.classList.remove("hidden");
    return;
  }
  shell.classList.add("hidden");
  if (authView === "signup") {
    login.classList.add("hidden");
    signup.classList.remove("hidden");
  } else {
    signup.classList.add("hidden");
    login.classList.remove("hidden");
  }
}
async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) { showApp(true); loadAll(); } else { showApp(false); }
  sb.auth.onAuthStateChange((_event, session) => {
    if (session) { showApp(true); loadAll(); } else { showApp(false); }
  });
}
function showSignupScreen() {
  authView = "signup";
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("signupScreen").classList.remove("hidden");
  document.getElementById("signupError").classList.add("hidden");
  document.getElementById("signupEmail").value = "";
  document.getElementById("signupPassword").value = "";
  document.getElementById("signupPasswordConfirm").value = "";
}
function showLoginScreen() {
  authView = "login";
  document.getElementById("signupScreen").classList.add("hidden");
  document.getElementById("loginScreen").classList.remove("hidden");
}
async function doLogin() {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errEl = document.getElementById("loginError");
  errEl.classList.add("hidden");
  if (!email || !password) { errEl.textContent = "Preencha e-mail e senha."; errEl.classList.remove("hidden"); return }
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { errEl.textContent = "Não consegui entrar: e-mail ou senha incorretos."; errEl.classList.remove("hidden") }
}
document.getElementById("loginForm").addEventListener("submit", function (e) { e.preventDefault(); doLogin(); });
async function doSignup() {
  const email = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;
  const confirmPw = document.getElementById("signupPasswordConfirm").value;
  const errEl = document.getElementById("signupError");
  errEl.classList.add("hidden");
  if (!email || !password) { errEl.textContent = "Preencha e-mail e senha."; errEl.classList.remove("hidden"); return }
  if (password.length < 6) { errEl.textContent = "A senha precisa ter pelo menos 6 caracteres."; errEl.classList.remove("hidden"); return }
  if (password !== confirmPw) { errEl.textContent = "As senhas não são iguais. Confira e tenta de novo."; errEl.classList.remove("hidden"); return }
  const { error } = await sb.auth.signUp({ email, password });
  if (error) { errEl.textContent = "Não consegui criar a conta: " + error.message; errEl.classList.remove("hidden"); return }
  await sb.auth.signOut();
  showLoginScreen();
  document.getElementById("loginEmail").value = email;
  document.getElementById("loginPassword").value = password;
  const loginErrEl = document.getElementById("loginError");
  loginErrEl.textContent = "Conta criada! Toque em \"Entrar\" para confirmar e o navegador vai oferecer para salvar a senha.";
  loginErrEl.classList.remove("hidden");
}
document.getElementById("signupForm").addEventListener("submit", function (e) { e.preventDefault(); doSignup(); });
async function doLogout() { await sb.auth.signOut() }

initAuth();
