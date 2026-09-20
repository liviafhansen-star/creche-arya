"use strict";
/* Peças usadas por tutor e creche: gravação segura, gerenciador de PIX, foto (recorte + upload privado). */

const RT = { tutor: null, creche: null };
function stopRealtime() {
  ["tutor", "creche"].forEach(k => { if (RT[k]) { sb.removeChannel(RT[k]); RT[k] = null; } });
}
function paintPhoto(id, path, emoji) {
  const el = $(id); if (!el) return;
  if (path) setHtml(el, imgHtml(path, "")); else el.textContent = emoji;
}

/** UPDATE que falha em voz alta: 0 linhas afetadas (RLS ou registro ausente) vira erro, não "✓ salvo". */
async function updateOne(table, col, val, values) {
  const rows = must(await sb.from(table).update(values).eq(col, val).select());
  if (!rows || !rows.length) throw new Error("Não foi possível salvar (registro não encontrado ou sem permissão).");
  return rows[0];
}

async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg || "Copiado!"); }
  catch (e) { openModal("Copie manualmente", `<input readonly value="${esc(text)}" id="copyFallback" autofocus>`); setTimeout(() => { const i = $("copyFallback"); if (i) i.select(); }, 30); }
}

/* ---------- PIX (ctx: 'tutor' guarda no perfil; 'creche' guarda em creches.pix_keys) ---------- */
const PIX_TYPES = ["CPF", "CNPJ", "Telefone", "E-mail", "Aleatória"];
const PX = { tutor: { type: "Telefone", editing: null, selected: null }, creche: { type: "Telefone", editing: null, selected: null } };
function pixKeys(ctx) {
  const arr = ctx === "creche" ? (S.creche && S.creche.pix_keys) : (S.profile && S.profile.pix_keys);
  const keys = Array.isArray(arr) ? arr.slice() : [];
  if (ctx === "tutor" && !keys.length && S.profile && S.profile.pix_key) keys.push({ id: "legacy", type: S.profile.pix_type || "Telefone", key: S.profile.pix_key });
  return keys;
}
async function savePixKeys(ctx, keys) {
  if (ctx === "creche") { const row = await updateOne("creches", "id", S.creche.id, { pix_keys: keys }); S.creche.pix_keys = row.pix_keys; }
  else { const row = await updateOne("creche_profile", "user_id", S.user.id, { pix_keys: keys }); S.profile.pix_keys = row.pix_keys; }
}
function pixPlaceholder(t) {
  return { CPF: "000.000.000-00", CNPJ: "00.000.000/0000-00", Telefone: "(51) 9 9894-0123", "E-mail": "nome@email.com", "Aleatória": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" }[t] || "";
}
function pixManagerHtml(ctx, title) {
  const st = PX[ctx], keys = pixKeys(ctx);
  if (!st.selected || !keys.some(k => k.id === st.selected)) st.selected = keys[0] ? keys[0].id : null;
  return `
    <h3>${esc(title || "Chaves PIX")}</h3>
    <label>Tipo de chave</label>
    <div class="pix-type-chips" role="group" aria-label="Tipo de chave">${PIX_TYPES.map(t => `<button type="button" class="${st.type === t ? "on" : ""}" data-act="pixType" data-ctx="${ctx}" data-t="${esc(t)}" aria-pressed="${st.type === t}">${esc(t)}</button>`).join("")}</div>
    <label for="pixIn-${ctx}">${st.editing ? "Editar chave" : "Nova chave PIX"}</label>
    <div class="input-with-btn">
      <input id="pixIn-${ctx}" data-input="pixMask" data-ctx="${ctx}" autocomplete="off" placeholder="${esc(pixPlaceholder(st.type))}">
      <button type="button" class="btn pink-btn" data-act="pixSave" data-ctx="${ctx}">${st.editing ? "Atualizar" : "Salvar"}</button>
    </div>
    <div class="section-title" style="margin:16px 0 8px"><h2 style="font-size:15px;margin:0">Chaves salvas</h2></div>
    <div class="pix-keys-list">${keys.length ? keys.map(k => `
      <button type="button" class="pix-key-card ${k.id === st.selected ? "selected" : ""}" data-act="pixSelect" data-ctx="${ctx}" data-id="${esc(k.id)}" aria-pressed="${k.id === st.selected}">
        <span class="pix-type-badge">${esc(k.type || "PIX")}</span><span class="pix-key-val">${esc(k.key || "")}</span>
      </button>`).join("") : "<small>Nenhuma chave salva ainda.</small>"}</div>
    ${keys.length ? `<div class="pix-key-actions">
      <button type="button" class="btn secondary" data-act="pixCopy" data-ctx="${ctx}">📋 Copiar</button>
      <button type="button" class="btn secondary" data-act="pixEdit" data-ctx="${ctx}">✏️ Editar</button>
      <button type="button" class="btn secondary danger-outline" data-act="pixDelete" data-ctx="${ctx}">🗑️ Excluir</button>
    </div>` : ""}`;
}
function renderPixManager(ctx, targetId, title) {
  const el = $(targetId); if (!el) return;
  el.innerHTML = pixManagerHtml(ctx, title);
  syncPixInput(ctx);
}
function pixRefresh(ctx) { if (ctx === "creche") renderPixManager("creche", "cPixCard", "Chaves PIX para receber"); else renderTutorPix(); }
function syncPixInput(ctx) {
  const el = $("pixIn-" + ctx); if (!el) return;
  const t = PX[ctx].type;
  el.placeholder = pixPlaceholder(t);
  if (t === "E-mail") { el.type = "email"; el.inputMode = "email"; el.removeAttribute("maxlength"); }
  else if (t === "Aleatória") { el.type = "text"; el.inputMode = "text"; el.maxLength = 36; }
  else { el.type = "tel"; el.inputMode = "numeric"; el.maxLength = t === "CNPJ" ? 18 : t === "Telefone" ? 16 : 14; }
}
onInput("pixMask", el => {
  const t = PX[el.dataset.ctx].type;
  if (t === "Telefone") maskPhoneInput(el);
  else if (t === "CPF") el.value = formatCpfMask(el.value);
  else if (t === "CNPJ") el.value = formatCnpjMask(el.value);
  else if (t === "E-mail") el.value = el.value.replace(/\s/g, "");
});
act("pixType", el => { PX[el.dataset.ctx].type = el.dataset.t; pixRefresh(el.dataset.ctx); const i = $("pixIn-" + el.dataset.ctx); if (i) i.focus(); });
act("pixSelect", el => { PX[el.dataset.ctx].selected = el.dataset.id; pixRefresh(el.dataset.ctx); });
act("pixSave", async el => {
  const ctx = el.dataset.ctx, st = PX[ctx];
  const raw = getVal("pixIn-" + ctx).trim();
  if (!raw) throw new Error("Digite a chave PIX.");
  const check = Pure.validatePixKey(st.type, raw);
  if (!check.ok) throw new Error(check.msg);
  let keys = pixKeys(ctx).filter(k => k.id !== "legacy" || st.editing === "legacy");
  if (keys.some(k => k.key === check.value && k.id !== st.editing)) throw new Error("Essa chave já está salva.");
  if (st.editing) { keys = keys.map(k => k.id === st.editing ? { ...k, type: st.type, key: check.value } : k); st.selected = st.editing; st.editing = null; }
  else { const id = crypto.randomUUID(); keys.push({ id, type: st.type, key: check.value }); st.selected = id; }
  await savePixKeys(ctx, keys);
  toast("Chave salva.");
  pixRefresh(ctx);
});
act("pixCopy", el => { const k = pixKeys(el.dataset.ctx).find(x => x.id === PX[el.dataset.ctx].selected); if (!k) throw new Error("Nenhuma chave selecionada."); return copyText(k.key, "Chave PIX copiada!"); });
act("pixEdit", el => {
  const ctx = el.dataset.ctx, k = pixKeys(ctx).find(x => x.id === PX[ctx].selected); if (!k) return;
  PX[ctx].editing = k.id; PX[ctx].type = k.type || "Telefone"; pixRefresh(ctx);
  const i = $("pixIn-" + ctx); if (i) { i.value = k.key || ""; i.focus(); }
});
act("pixDelete", async el => {
  const ctx = el.dataset.ctx, st = PX[ctx];
  if (!st.selected || !(await confirmDialog("Excluir esta chave PIX?", { danger: true, okLabel: "Excluir" }))) return;
  const keys = pixKeys(ctx).filter(k => k.id !== st.selected);
  st.selected = null; st.editing = null;
  await savePixKeys(ctx, keys.filter(k => k.id !== "legacy"));
  pixRefresh(ctx);
});
act("pixCopyKey", el => copyText(el.dataset.key, "Chave PIX copiada!"));

/* ---------- foto: recorte + upload privado ---------- */
let cropper = null, cropKind = null;
function photoTarget(kind) {
  if (kind === "creche") return { table: "creches", id: S.creche.id, old: S.creche.photo_path, apply: p => { S.creche.photo_path = p; } };
  const pet = petBeingEdited();
  if (!pet) throw new Error("Salve o pet primeiro; depois troque a foto.");
  return { table: "pets", id: pet.id, old: pet.photo_path, apply: p => { pet.photo_path = p; } };
}
onChange("startCrop", el => {
  const f = el.files[0]; const kind = el.dataset.kind; el.value = "";
  if (!f) return;
  const v = Pure.validateUpload(f, { types: ["image/jpeg", "image/png", "image/webp", "image/heic"], maxBytes: 10 * 1024 * 1024 });
  if (!v.ok) throw new Error(v.msg);
  photoTarget(kind);   // falha cedo (ex.: pet ainda não salvo)
  cropKind = kind;
  const reader = new FileReader();
  reader.onload = () => {
    openModal("Ajustar foto", `
      <div class="crop-wrap"><img id="cropImage" alt="Foto a recortar" src="${esc(reader.result)}"></div>
      <p class="crop-hint">Arraste para posicionar o rosto dentro do quadro.</p>
      <div class="zoom-controls">
        <button type="button" class="btn secondary" data-act="cropZoom" data-d="-0.1">➖ Afastar</button>
        <button type="button" class="btn secondary" data-act="cropZoom" data-d="0.1">➕ Aproximar</button>
      </div>
      <div class="row dlg-row">
        <button type="button" class="btn secondary" data-act="closeModal">Cancelar</button>
        <button type="button" class="btn pink-btn" data-act="confirmCrop">✓ Usar foto</button>
      </div>`, { onClose: () => { if (cropper) { cropper.destroy(); cropper = null; } } });
    const img = $("cropImage");
    const start = () => { if (cropper) cropper.destroy(); cropper = new Cropper(img, { aspectRatio: 1, viewMode: 1, background: false, autoCropArea: 1, guides: false, center: false }); };
    if (img.complete) start(); else img.onload = start;
  };
  reader.readAsDataURL(f);
});
act("cropZoom", el => { if (cropper) cropper.zoom(Number(el.dataset.d)); });
act("confirmCrop", async () => {
  if (!cropper) return;
  const tgt = photoTarget(cropKind);
  const canvas = cropper.getCroppedCanvas({ width: 500, height: 500 });
  const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.88));
  if (!blob) throw new Error("Não consegui processar a imagem.");
  const path = `${S.user.id}/${cropKind}/${crypto.randomUUID()}.jpg`;
  must(await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" }).then(r => ({ data: r.data, error: r.error })));
  try { await updateOne(tgt.table, "id", tgt.id, { photo_path: path }); }
  catch (e) { await sb.storage.from(BUCKET).remove([path]).catch(() => {}); throw e; }
  if (tgt.old && tgt.old !== path) sb.storage.from(BUCKET).remove([tgt.old]).catch(() => {});   // não deixa foto órfã
  tgt.apply(path);
  const kind = cropKind;
  closeModal();
  updateChrome();
  if (kind === "creche") paintPhoto("cPhoto", path, "🏠"); else paintPhoto("petPhoto", path, "🐶");
  toast("Foto atualizada.");
});
