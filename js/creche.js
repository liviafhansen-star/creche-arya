"use strict";
/* ===================== CRECHE (operador) ===================== */

const C = {
  filter: "todos",
  finMonth: monthOf(todayIso()),
  pets: [],
  ciByPet: {}, atByPet: {},         // check-ins e presença DE HOJE, por pet
  petDays: [],
  petQuery: "",
  fin: null                          // cache do financeiro
};

/* ---------- dados ---------- */
async function loadCrecheData() {
  const mem = must(await sb.from("creche_members").select("creche_id,role").eq("user_id", S.user.id).limit(1).maybeSingle());
  if (!mem) throw new Error("Sua conta de creche ainda não foi configurada. Fale com o suporte.");
  S.creche = must(await sb.from("creches").select("*").eq("id", mem.creche_id).single());
  S.pricing = pricingFromCreche(S.creche);
  await Promise.all([loadCrechePets(), loadCrecheToday()]);
  startCrecheRealtime();
}
async function loadCrechePets() {
  C.pets = S.crechePets = must(await sb.from("pets").select("*").eq("creche_id", S.creche.id).order("name", { ascending: true })) || [];
}
async function loadCrecheToday() {
  const today = todayIso(), id = S.creche.id;
  const [ci, at] = (await Promise.all([
    sb.from("day_checkins").select("*").eq("creche_id", id).eq("day", today),
    sb.from("attendance").select("*").eq("creche_id", id).eq("day", today)
  ])).map(must);
  C.ciByPet = {}; (ci || []).forEach(c => { if (c.pet_id) C.ciByPet[c.pet_id] = c; });
  C.atByPet = {}; (at || []).forEach(a => { C.atByPet[a.pet_id] = a; });
  markSeen(ci || []);
}
/** "Creche viu": o tutor passa a ver ✓ quando a creche abre o board */
async function markSeen(rows) {
  const ids = rows.filter(r => !r.seen_at).map(r => r.id);
  if (!ids.length || document.visibilityState !== "visible") return;
  try {
    must(await sb.from("day_checkins").update({ seen_at: new Date().toISOString() }).in("id", ids));
    rows.forEach(r => { if (ids.includes(r.id)) r.seen_at = new Date().toISOString(); });
  } catch (e) { logError("markSeen", e); }
}
async function refreshBoard(silent) {
  if (!S.user || S.role !== "creche") return;
  if (!silent) await loadCrechePets();
  await loadCrecheToday();
  if (currentScreen === "home") renderBoard();
}
function startCrecheRealtime() {
  stopRealtime();
  const id = S.creche.id;
  const deb = debounce(() => refreshBoard(true).catch(e => logError("realtime:creche", e)), 400);
  RT.creche = sb.channel("creche-" + id)
    .on("postgres_changes", { event: "*", schema: "public", table: "day_checkins", filter: "creche_id=eq." + id }, payload => {
      const r = payload.new;
      if (r && r.day === todayIso() && payload.eventType !== "DELETE" && r.status) toast(`${r.pet_name || "Pet"}: ${r.status === "coming" ? "vem hoje ✅" : "não vai hoje ❌"}`, "info", 4500);
      deb();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "attendance", filter: "creche_id=eq." + id }, deb)
    .subscribe();
}
act("refreshBoard", () => refreshBoard(false));

/* ===================== HOJE (board) ===================== */
function defaultOvernight(pet) { return isWeekendIso(todayIso()) ? !!pet.overnight_weekend : !!pet.overnight_weekday; }

function boardItems() {
  const dow = new Date().getDay(), out = [];
  for (const p of C.pets) {
    if (p.active === false) continue;
    const ci = C.ciByPet[p.id], at = C.atByPet[p.id], state = Pure.petDayState(p, ci, at, dow);
    if (state) out.push({ pet: p, ci, at, state });
  }
  out.sort((a, b) => Pure.STATE_ORDER.indexOf(a.state) - Pure.STATE_ORDER.indexOf(b.state) || a.pet.name.localeCompare(b.pet.name, "pt-BR"));
  return out;
}

function renderBoard() {
  $("cDateLabel").textContent = cap(new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short" }));
  const all = boardItems(), counts = Pure.boardCounts(all);
  $("cCounts").innerHTML = [
    [`${counts.total} no board`, ""], [`${counts.presente} presentes`, ""], [`${counts.saiu} saíram`, ""], [`${counts.faltou} faltas`, ""], [`${counts.naoVem} avisaram que não vêm`, ""]
  ].map(([t]) => `<span class="pill">${esc(t)}</span>`).join("");
  const fdefs = [["todos", "Todos"], ["vem", "Vêm"], ["presentes", "Presentes"], ["faltas", "Faltas"]];
  $("cFilters").innerHTML = fdefs.map(([k, l]) => `<button type="button" class="chip ${C.filter === k ? "on" : ""}" data-act="setFilter" data-f="${k}" aria-pressed="${C.filter === k}">${l} (${all.filter(Pure.FILTERS[k]).length})</button>`).join("");
  const nArr = Pure.bulkTargets(all, "presente").length, nOut = Pure.bulkTargets(all, "saiu").length;
  $("cBulk").innerHTML = `
    <button type="button" class="quick pink" data-act="bulk" data-action="presente" ${nArr ? "" : "disabled"}><span aria-hidden="true">✅</span><b>Marcar chegada</b><small>${nArr} pet(s) esperado(s)</small></button>
    <button type="button" class="quick" data-act="bulk" data-action="saiu" ${nOut ? "" : "disabled"}><span aria-hidden="true">🚪</span><b>Marcar saída</b><small>${nOut} presente(s)</small></button>`;
  const items = all.filter(Pure.FILTERS[C.filter]);
  if (!C.pets.length) { setHtml($("cBoard"), `<div class="trip"><div><b>Nenhum pet cadastrado ainda</b><small>Cadastre em Cães ou convide os tutores com o código da creche.</small></div><button type="button" class="text-btn" data-act="nav" data-screen="pets">Ir para Cães</button></div>`); return; }
  if (!items.length) { setHtml($("cBoard"), `<div class="trip"><div><b>Ninguém neste filtro</b><small>Quem está na agenda de hoje ou avisou pelo app aparece aqui.</small></div></div>`); return; }
  setHtml($("cBoard"), items.map(it => boardRow(it)).join(""));
}
act("setFilter", el => { C.filter = el.dataset.f; renderBoard(); });

function boardRow(it) {
  const { pet, ci, at, state } = it;
  let when = "";
  if (at && at.status === "presente" && at.arrived_at) when = "chegou " + formatTime(at.arrived_at);
  else if (at && at.status === "saiu") when = (at.arrived_at ? "chegou " + formatTime(at.arrived_at) + " · " : "") + "saiu " + formatTime(at.left_at);
  else if (ci && (state === "avisou_vem" || state === "avisou_nao_vem")) when = "avisou às " + formatTime(ci.updated_at);
  const chip = (st, label) => `<button type="button" class="status-chip${at && at.status === st ? " on" : ""}" data-act="setAtt" data-pet="${esc(pet.id)}" data-st="${st}" aria-pressed="${!!(at && at.status === st)}">${label}</button>`;
  return `<div class="trip creche-row"><div class="row-main">
    <b>${esc(pet.name)}</b>${pet.tutor_user_id ? ' <span class="tag">no app</span>' : ""}
    <small>${esc(pet.tutor_name || "Tutor")}${pet.tutor_phone ? " · " + esc(formatPhoneBr(pet.tutor_phone)) : ""}</small>
    <div class="state-line"><span class="state-pill st-${state}">${esc(Pure.STATE_LABEL[state])}</span>${when ? ` <small>${esc(when)}</small>` : ""}</div>
    <div class="status-row">${chip("presente", "Chegou")}${chip("saiu", "Saiu")}${chip("faltou", "Faltou")}
      ${at && at.status !== "faltou" ? `<label class="check inline"><input type="checkbox" data-change="toggleOver" data-pet="${esc(pet.id)}" ${at.overnight ? "checked" : ""}> <span>Pernoite</span></label>` : ""}</div>
    ${pet.notes ? `<small class="notes">📝 ${esc(pet.notes)}</small>` : ""}
  </div><div class="creche-row-actions"><button type="button" class="text-btn" data-act="notifyTutor" data-pet="${esc(pet.id)}">Avisar</button></div></div>`;
}

act("setAtt", async el => {
  const pet = C.pets.find(p => p.id === el.dataset.pet); if (!pet) return;
  const st = el.dataset.st, cur = C.atByPet[pet.id];
  if (cur && cur.status === st) {                    // toque de novo = desfaz
    must(await sb.from("attendance").delete().eq("id", cur.id));
    delete C.atByPet[pet.id];
  } else {
    const overnight = st === "faltou" ? false : cur ? cur.overnight : (st === "presente" ? defaultOvernight(pet) : false);
    C.atByPet[pet.id] = must(await sb.from("attendance").upsert({ creche_id: S.creche.id, pet_id: pet.id, day: todayIso(), status: st, overnight }, { onConflict: "pet_id,day" }).select().single());
  }
  renderBoard();
});
onChange("toggleOver", async el => {
  const at = C.atByPet[el.dataset.pet]; if (!at) return;
  C.atByPet[el.dataset.pet] = await updateOne("attendance", "id", at.id, { overnight: el.checked });
  renderBoard();
});
act("bulk", async el => {
  const action = el.dataset.action, targets = Pure.bulkTargets(boardItems(), action);
  if (!targets.length) return;
  const label = action === "presente" ? "chegada" : "saída";
  if (!(await confirmDialog(`Marcar ${label} de ${targets.length} pet(s)? Quem avisou que não vem, faltou ou já saiu não entra.`, { okLabel: "Marcar " + label }))) return;
  const rows = targets.map(t => ({ creche_id: S.creche.id, pet_id: t.pet.id, day: todayIso(), status: action, overnight: t.at ? t.at.overnight : (action === "presente" ? defaultOvernight(t.pet) : false) }));
  must(await sb.from("attendance").upsert(rows, { onConflict: "pet_id,day" }).select()).forEach(r => { C.atByPet[r.pet_id] = r; });
  renderBoard();
  toast(`${targets.length} pet(s) marcados.`);
});

act("notifyTutor", el => {
  const pet = C.pets.find(p => p.id === el.dataset.pet); if (!pet) return;
  const n = pet.name;
  const tpls = [`Oi! ${n} chegou bem na creche 🐶`, `Oi! Já pode vir buscar ${n} 😊`, `Oi! ${n} está ótimo(a) hoje 💛`];
  const hasPhone = onlyDigits(pet.tutor_phone).length >= 10;
  openModal("Avisar " + (pet.tutor_name || "tutor"), `
    ${hasPhone ? "" : `<p class="muted">Sem telefone cadastrado. O WhatsApp vai abrir para você escolher o contato.</p>`}
    ${tpls.map(t => `<a class="option" href="${esc(waLink(pet.tutor_phone, t))}" target="_blank" rel="noopener"><strong>${esc(t)}</strong><small>Abrir no WhatsApp</small></a>`).join("")}
    <label>Mensagem personalizada<textarea id="notifyCustom" rows="3" maxlength="500" placeholder="Escreva…"></textarea></label>
    <button type="button" class="btn pink-btn full" data-act="notifyCustomSend" data-pet="${esc(pet.id)}">📤 Enviar pelo WhatsApp</button>`);
});
act("notifyCustomSend", el => {
  const pet = C.pets.find(p => p.id === el.dataset.pet), text = getVal("notifyCustom").trim();
  if (!text) throw new Error("Escreva a mensagem.");
  const url = waLink(pet && pet.tutor_phone, text);
  if (!window.open(url, "_blank", "noopener")) location.href = url;
});

/* ===================== CÃES E FAMÍLIAS ===================== */
function inviteHtml() {
  return `<h3>🔗 Convite para tutores</h3>
    <p class="muted">O tutor cria a conta, abre <b>Perfil → Creche</b> e digita o código. A partir daí os avisos dele chegam só para esta creche.</p>
    <div class="invite-code" aria-label="Código de convite">${esc(S.creche.invite_code)}</div>
    <div class="profile-actions">
      <button type="button" class="btn secondary" data-act="copyInvite">📋 Copiar código</button>
      <button type="button" class="btn pink-btn" data-act="shareInvite">📤 Enviar convite</button>
    </div>`;
}
act("copyInvite", () => copyText(S.creche.invite_code, "Código copiado!"));
act("shareInvite", () => {
  const url = waLink("", Pure.inviteMessage(S.creche.name, S.creche.invite_code, location.origin));
  if (!window.open(url, "_blank", "noopener")) location.href = url;
});

function renderCrechePets() {
  $("cInvite").innerHTML = inviteHtml();
  const q = C.petQuery.trim().toLowerCase();
  const list = C.pets.filter(p => !q || (p.name + " " + (p.tutor_name || "")).toLowerCase().includes(q));
  const names = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  $("cPetsList").innerHTML = !C.pets.length
    ? `<div class="trip"><div><b>Adicione o primeiro pet</b><small>Use o formulário abaixo ou convide os tutores com o código.</small></div></div>`
    : list.length ? list.map(p => {
      const days = (p.weekdays || []).map(Number).sort().map(d => names[d]).join(", ") || "todos os dias";
      return `<div class="trip"><div><b>${esc(p.name)}</b> <span class="tag">${p.tutor_user_id ? "no app" : "manual"}</span>
        <small>${esc(p.tutor_name || "")}${p.tutor_phone ? " · " + esc(formatPhoneBr(p.tutor_phone)) : ""} · ${days}</small></div>
        <div class="creche-row-actions">${p.tutor_user_id ? "<small>Agenda definida pelo tutor</small>"
          : `<button type="button" class="text-btn" data-act="editPetC" data-id="${esc(p.id)}">Editar</button><button type="button" class="text-btn" data-act="deletePetC" data-id="${esc(p.id)}">Excluir</button>`}</div></div>`;
    }).join("") : `<div class="trip">Nada encontrado para “${esc(C.petQuery)}”.</div>`;
  renderPetDaysC();
}
onInput("filterPets", el => { C.petQuery = el.value; renderCrechePets(); });

function renderPetDaysC() {
  $("cPetDays").innerHTML = ["D", "S", "T", "Q", "Q", "S", "S"].map((n, i) => `<button type="button" class="${C.petDays.includes(i) ? "on" : ""}" data-act="cPetDay" data-i="${i}" aria-pressed="${C.petDays.includes(i)}" aria-label="${["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][i]}">${n}</button>`).join("");
}
act("cPetDay", el => { const i = Number(el.dataset.i); C.petDays = C.petDays.includes(i) ? C.petDays.filter(x => x !== i) : [...C.petDays, i].sort(); renderPetDaysC(); });
function fillPetForm(p) {
  setVal("cPetId", p ? p.id : ""); setVal("cPetName", p ? p.name : ""); setVal("cPetTutor", p ? p.tutor_name : "");
  setVal("cPetPhone", p && p.tutor_phone ? formatPhoneBr(p.tutor_phone) : ""); setVal("cPetNotes", p ? p.notes : "");
  C.petDays = p ? (p.weekdays || []).map(Number) : [];
  $("cPetFormTitle").textContent = p ? "Editar pet" : "Novo pet";
  renderPetDaysC();
}
act("newPet", () => { fillPetForm(null); $("cPetFormCard").scrollIntoView({ behavior: "smooth", block: "start" }); $("cPetName").focus(); });
act("resetPetForm", () => fillPetForm(null));
act("editPetC", el => { fillPetForm(C.pets.find(p => p.id === el.dataset.id)); $("cPetFormCard").scrollIntoView({ behavior: "smooth", block: "start" }); });
act("savePetForm", async () => {
  const name = getVal("cPetName").trim();
  if (!name) throw new Error("Informe o nome do pet.");
  const phone = getVal("cPetPhone").trim();
  if (phone) { const c = Pure.validateTelefone(phone); if (!c.ok) throw new Error("Telefone do tutor: " + c.msg); }
  const row = { name, tutor_name: getVal("cPetTutor").trim(), tutor_phone: onlyDigits(phone), notes: getVal("cPetNotes").trim(), weekdays: C.petDays.slice().sort() };
  const id = getVal("cPetId");
  if (id) await updateOne("pets", "id", id, row);
  else must(await sb.from("pets").insert({ ...row, creche_id: S.creche.id, tutor_user_id: null }));
  await loadCrechePets();
  fillPetForm(null); flashHint("cPetHint"); renderCrechePets();
});
act("deletePetC", async el => {
  const p = C.pets.find(x => x.id === el.dataset.id); if (!p) return;
  if (!(await confirmDialog(`Excluir ${p.name}? A presença registrada dele também será apagada.`, { danger: true, okLabel: "Excluir" }))) return;
  must(await sb.from("pets").delete().eq("id", p.id));
  await loadCrechePets(); renderCrechePets();
});

/* ===================== TUTORES ===================== */
function renderCrecheTutors() {
  if (!C.pets.length) { $("cTutorsList").innerHTML = "<div class='trip'>Nenhum tutor ainda. Cadastre pets em Cães ou convide os tutores.</div>"; return; }
  const groups = new Map();
  C.pets.forEach(p => {
    const key = p.tutor_user_id ? "u:" + p.tutor_user_id : "t:" + (p.tutor_name || "sem nome").trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, { name: p.tutor_name || "Sem nome", phone: p.tutor_phone || "", app: !!p.tutor_user_id, pets: [] });
    const g = groups.get(key); g.pets.push(p.name); if (p.tutor_phone) g.phone = p.tutor_phone;
  });
  $("cTutorsList").innerHTML = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map(g => `
    <div class="trip"><div><b>${esc(g.name)}</b> <span class="tag">${g.app ? "no app" : "manual"}</span><small>${esc(g.pets.join(", "))}</small></div>
    ${onlyDigits(g.phone).length >= 10 ? `<a class="btn secondary sm" href="${esc(waLink(g.phone, ""))}" target="_blank" rel="noopener" aria-label="WhatsApp de ${esc(g.name)}">💬 ${esc(formatPhoneBr(g.phone))}</a>` : `<span class="muted">Sem telefone</span>`}</div>`).join("");
}

/* ===================== FINANCEIRO ===================== */
async function loadFinance() {
  const since = addDaysIso(todayIso(), -400), id = S.creche.id;
  const [att, pays] = await Promise.all([
    fetchAll(() => sb.from("attendance").select("pet_id,day,status,overnight").eq("creche_id", id).gte("day", since).order("day", { ascending: true })),
    fetchAll(() => sb.from("creche_payments").select("*").order("date", { ascending: true }))   // a RLS só entrega os dos tutores vinculados
  ]);
  C.fin = { att, pays };
}
function computeFinance() {
  const { att, pays } = C.fin, today = todayIso(), lateBefore = addDaysIso(today, -7);
  const famKey = p => p.tutor_user_id ? "u:" + p.tutor_user_id : "t:" + (p.tutor_name || p.name).trim().toLowerCase();
  const fams = new Map(), byPet = new Map();
  C.pets.forEach(p => {
    const k = famKey(p);
    if (!fams.has(k)) fams.set(k, { key: k, tutorId: p.tutor_user_id || null, name: p.tutor_name || "Sem nome", pets: [], charges: {}, presentDays: new Set() });
    fams.get(k).pets.push(p.name); byPet.set(p.id, fams.get(k));
  });
  att.forEach(a => {
    if (a.status === "faltou") return;
    const f = byPet.get(a.pet_id); if (!f) return;
    f.charges[a.day] = (f.charges[a.day] || 0) + priceFor(a.day, a.overnight ? "over" : "was", S.pricing);
    f.presentDays.add(a.day);
  });
  const list = [...fams.values()].map(f => {
    const mine = f.tutorId ? pays.filter(p => p.user_id === f.tutorId) : [];
    const pt = Pure.maxPaidThrough(mine, ["confirmado"]);
    const open = Pure.sumCharges(f.charges, { after: pt || undefined });
    const openDays = Object.keys(f.charges).filter(d => f.charges[d] > 0 && (!pt || d > pt)).sort();
    return {
      ...f, pt, open,
      month: Pure.sumCharges(f.charges, { month: C.finMonth }),
      monthDays: [...f.presentDays].filter(d => d.startsWith(C.finMonth)).length,
      toConfirm: mine.filter(p => (p.status || "enviado") === "enviado").length,
      late: !!(openDays[0] && openDays[0] < lateBefore)
    };
  }).sort((a, b) => b.open - a.open || a.name.localeCompare(b.name, "pt-BR"));
  return { list, pending: pays.filter(p => (p.status || "enviado") === "enviado") };
}
async function renderFinance() {
  const [y, m] = C.finMonth.split("-").map(Number);
  $("c-finance-h").textContent = "Financeiro · " + cap(new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "numeric" }));
  fillPriceForm();
  renderPixManager("creche", "cPixCard", "Chaves PIX para receber");
  if (!C.fin) $("cFinSummary").innerHTML = card("Carregando…");
  await loadFinance();                 // sempre fresco: confirmações e presença mudam o tempo todo
  paintFinance();
}
function paintFinance() {
  const { list, pending } = computeFinance();
  const sum = (k) => list.reduce((t, f) => t + f[k], 0);
  $("cFinSummary").innerHTML = `<div class="fin-cards">
    <div class="card"><small>A receber no mês</small><b class="big">${money(sum("month"))}</b></div>
    <div class="card"><small>Em aberto (total)</small><b class="big">${money(sum("open"))}</b></div>
    <div class="card"><small>Comprovantes a confirmar</small><b class="big">${pending.length}</b></div>
    <div class="card"><small>Famílias em atraso (+7 dias)</small><b class="big">${list.filter(f => f.late).length}</b></div></div>`;
  const tutorName = uid => (list.find(f => f.tutorId === uid) || {}).name || "Tutor";
  setHtml($("cFinPending"), pending.length ? pending.map(p => `
    <div class="trip"><div><b>${esc(tutorName(p.user_id))} · ${money(p.value)}</b>
      <small>${esc(formatBRDate(p.date))} · cobre até ${esc(formatBRDate(Pure.effectivePaidThrough(p)))}${p.note ? " · " + esc(p.note) : ""}</small>
      ${p.attachment_path ? `<button type="button" class="attach-link" data-act="openAttachment" data-path="${esc(p.attachment_path)}">📎 Ver comprovante</button>` : ""}</div>
      <div class="creche-row-actions"><button type="button" class="btn pink-btn sm" data-act="payDecision" data-id="${p.id}" data-st="confirmado">Confirmar</button>
      <button type="button" class="btn secondary sm" data-act="payDecision" data-id="${p.id}" data-st="recusado">Recusar</button></div></div>`).join("")
    : "<div class='trip'>Nenhum comprovante aguardando.</div>");
  $("cFinFamilies").innerHTML = list.length ? list.map(f => `
    <div class="trip"><div><b>${esc(f.name)}</b> ${f.late ? '<span class="tag warn">atrasado</span>' : ""}${f.tutorId ? "" : ' <span class="tag">manual</span>'}
      <small>${esc(f.pets.join(", "))} · ${f.monthDays} dia(s) no mês${f.pt ? " · coberto até " + esc(formatBRDate(f.pt)) : ""}${f.toConfirm ? " · " + f.toConfirm + " a confirmar" : ""}</small></div>
      <div class="fin-amounts"><span class="amount">${money(f.month)}</span><small>em aberto ${money(f.open)}</small></div></div>`).join("")
    : "<div class='trip'>Sem famílias cadastradas.</div>";
}
act("finMonth", async el => {
  const [y, m] = C.finMonth.split("-").map(Number), d = new Date(y, m - 1 + Number(el.dataset.n), 1);
  C.finMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  await renderFinance();
});
act("payDecision", async el => {
  const id = Number(el.dataset.id), st = el.dataset.st;
  if (st === "recusado" && !(await confirmDialog("Recusar este comprovante? O tutor verá como recusado e a cobertura dele será desfeita.", { danger: true, okLabel: "Recusar" }))) return;
  const row = await updateOne("creche_payments", "id", id, { status: st });
  C.fin.pays = C.fin.pays.map(p => p.id === id ? row : p);
  paintFinance();
  toast(st === "confirmado" ? "Pagamento confirmado." : "Pagamento recusado.");
});
act("exportFinanceCsv", async () => {
  if (!C.fin) await loadFinance();
  const { list } = computeFinance();
  const rows = [["Família", "Pets", "Dias no mês", "Total do mês (R$)", "Em aberto (R$)", "Coberto até", "Situação"],
    ...list.map(f => [f.name, f.pets.join(", "), f.monthDays, f.month.toFixed(2).replace(".", ","), f.open.toFixed(2).replace(".", ","), f.pt ? formatBRDate(f.pt) : "", f.late ? "atrasado" : f.open > 0 ? "em aberto" : "em dia"])];
  download(`financeiro-${C.finMonth}.csv`, "﻿" + Pure.toCsv(rows), "text/csv;charset=utf-8");
});

function fillPriceForm() {
  const f = v => String(v == null ? "" : v).replace(".", ",");
  setVal("cPriceDay", f(S.creche.price_day)); setVal("cPriceOver", f(S.creche.price_over));
  setVal("cPriceWeekendDay", f(S.creche.price_weekend_day)); setVal("cPriceWeekendOver", f(S.creche.price_weekend_over));
}
act("saveCrechePrices", async () => {
  const get = (id, label) => { const r = Pure.parseMoney(getVal(id), { allowZero: true }); if (!r.ok) throw new Error(label + ": " + r.msg); return r.value; };
  const row = await updateOne("creches", "id", S.creche.id, {
    price_day: get("cPriceDay", "Diária"), price_over: get("cPriceOver", "Pernoite"),
    price_weekend_day: get("cPriceWeekendDay", "Fim de semana sem pernoite"), price_weekend_over: get("cPriceWeekendOver", "Fim de semana com pernoite")
  });
  Object.assign(S.creche, row); S.pricing = pricingFromCreche(S.creche);
  flashHint("cPricesHint"); paintFinance();
});

/* ===================== PERFIL DA CRECHE ===================== */
function renderCrecheProfile() {
  setVal("cName", S.creche.name); setVal("cPhone", S.creche.phone ? formatPhoneBr(S.creche.phone) : "");
  paintPhoto("cPhoto", S.creche.photo_path, "🏠");
  $("cInvite2").innerHTML = inviteHtml();
  $("cAccount").innerHTML = accountHtml();
}
act("saveCrecheProfile", async () => {
  const name = getVal("cName").trim();
  if (!name) throw new Error("Informe o nome da creche.");
  const phone = getVal("cPhone").trim();
  if (phone) { const c = Pure.validateTelefone(phone); if (!c.ok) throw new Error("WhatsApp: " + c.msg); }
  Object.assign(S.creche, await updateOne("creches", "id", S.creche.id, { name, phone: onlyDigits(phone) }));
  updateChrome(); flashHint("cProfileHint");
});
