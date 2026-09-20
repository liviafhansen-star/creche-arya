"use strict";
/* Autenticação. O PAPEL vem do servidor (creche_profile.account_role, imutável pelo usuário);
 * o papel escolhido na landing serve só para o texto e para guiar o formulário. */

const LEGACY_CRECHE_DOMAIN = "creche.caotrole.app";   // contas antigas de creche entravam por "usuário"
let authRole = "tutor";
try { authRole = sessionStorage.getItem("arya.role") === "creche" ? "creche" : "tutor"; } catch (e) { /* ignorar */ }
let booting = true;

const AUTH_VIEWS = ["landing", "login", "signup", "forgot", "reset"];
const AUTH_PATHS = {
  landing: () => "/",
  login: r => (r === "creche" ? "/creche/entrar" : "/tutor"),
  signup: r => (r === "creche" ? "/creche/cadastro" : "/tutor/cadastro"),
  forgot: () => "/esqueci-senha",
  reset: () => "/redefinir-senha"
};
function authViewFromPath(p) {
  if (p === "/tutor" || p === "/login") return { view: "login", role: "tutor" };
  if (p === "/creche" || p === "/creche/entrar") return { view: "login", role: "creche" };
  if (p === "/tutor/cadastro" || p === "/cadastro") return { view: "signup", role: "tutor" };
  if (p === "/creche/cadastro") return { view: "signup", role: "creche" };
  if (p === "/esqueci-senha") return { view: "forgot" };
  if (p === "/redefinir-senha") return { view: "reset" };
  return null;
}
function setAuthRole(role) {
  authRole = role === "creche" ? "creche" : "tutor";
  try { sessionStorage.setItem("arya.role", authRole); } catch (e) { /* ignorar */ }
}

function hideAll() {
  AUTH_VIEWS.forEach(v => $(v + "Screen").classList.add("hidden"));
  $("appShell").classList.add("hidden");
  const boot = $("boot"); if (boot) boot.classList.add("hidden");
}

function showAuth(view, opts) {
  opts = opts || {};
  hideAll();
  $(view + "Screen").classList.remove("hidden");
  updateAuthCopy();
  const want = AUTH_PATHS[view](authRole);
  if (!opts.skipRoute && location.pathname !== want) history[opts.replace ? "replaceState" : "pushState"]({ auth: view }, "", want);
  document.title = { landing: "Cãotrole Financeiro", login: "Entrar — Cãotrole", signup: "Criar conta — Cãotrole", forgot: "Recuperar senha — Cãotrole", reset: "Nova senha — Cãotrole" }[view];
  const first = $(view + "Screen").querySelector("input:not([type=hidden])");
  if (first && view !== "landing") setTimeout(() => first.focus(), 30);
}

function updateAuthCopy() {
  const creche = authRole === "creche";
  ["loginScreen", "signupScreen"].forEach(id => {
    $(id).classList.toggle("auth-creche", creche);
    $(id).classList.toggle("auth-tutor", !creche);
  });
  $("loginLogo").textContent = creche ? "🏠" : "🐾";
  $("signupLogo").textContent = creche ? "🏠" : "🐾";
  $("loginRoleBadge").textContent = creche ? "Conta creche" : "Conta tutor";
  $("loginRoleBadge").className = "auth-role-badge " + (creche ? "creche" : "tutor");
  $("signupRoleBadge").textContent = creche ? "Conta creche (por convite)" : "Nova conta tutor";
  $("signupRoleBadge").className = "auth-role-badge " + (creche ? "creche" : "tutor");
  $("loginTitle").textContent = creche ? "Entrar como creche" : "Entrar como tutor";
  $("loginSub").textContent = creche
    ? "Use o e-mail (ou usuário) da creche. O acesso é liberado por convite."
    : "Use o e-mail da sua conta de tutor.";
  $("signupTitle").textContent = creche ? "Cadastro da creche" : "Criar conta de tutor";
  $("signupSub").textContent = creche
    ? "Só funciona com o e-mail que a equipe autorizou. Sem convite? Entre em contato para liberarmos."
    : "Use o e-mail da família. Depois é só cadastrar o pet e vincular à creche.";
  $("loginIdLabel").textContent = creche ? "E-mail ou usuário" : "E-mail";
  $("loginEmail").type = creche ? "text" : "email";
  $("loginSubmit").textContent = creche ? "Entrar na creche" : "Entrar como tutor";
  $("signupSubmit").textContent = creche ? "Criar conta da creche" : "Criar conta de tutor";
}

function showFormMsg(id, text, ok) {
  const el = $(id);
  el.textContent = text || "";
  el.classList.toggle("hidden", !text);
  el.classList.toggle("ok", !!ok);
}

act("chooseRole", el => { setAuthRole(el.dataset.role); showAuth("login"); });
act("showAuth", el => {
  ["loginError", "signupError", "forgotMsg", "resetMsg"].forEach(id => showFormMsg(id, ""));
  showAuth(el.dataset.view);
});

/* ---------- cadastro / login ---------- */
function loginEmailFrom(raw) {
  const id = String(raw || "").trim();
  if (authRole === "creche" && id && !id.includes("@")) {
    const u = id.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9._-]/g, "");
    return u ? u + "@" + LEGACY_CRECHE_DOMAIN : "";
  }
  return id;
}

onSubmit("login", async () => {
  showFormMsg("loginError", "");
  const email = loginEmailFrom(getVal("loginEmail"));
  const password = getVal("loginPassword");
  if (!email || !password) return showFormMsg("loginError", "Preencha e-mail e senha.");
  if (Pure.validateEmail(email).ok === false) return showFormMsg("loginError", "E-mail em formato inválido.");
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    return showFormMsg("loginError", error.status === 429
      ? "Muitas tentativas. Aguarde alguns minutos e tente de novo."
      : /confirm/i.test(error.message) ? "Confirme seu e-mail antes de entrar (veja sua caixa de entrada)."
      : "Não consegui entrar: e-mail ou senha incorretos.");
  }
  await enterApp(data.user, { fromLogin: true });
});

onSubmit("signup", async () => {
  showFormMsg("signupError", "");
  const emailCheck = Pure.validateEmail(getVal("signupEmail"));
  if (!emailCheck.ok) return showFormMsg("signupError", emailCheck.msg);
  const pw = getVal("signupPassword");
  const pwCheck = Pure.validatePassword(pw);
  if (!pwCheck.ok) return showFormMsg("signupError", pwCheck.msg);
  if (pw !== getVal("signupPasswordConfirm")) return showFormMsg("signupError", "As senhas não são iguais.");
  if (!$("signupConsent").checked) return showFormMsg("signupError", "Para criar a conta, aceite a política de privacidade.");
  const { data, error } = await sb.auth.signUp({ email: emailCheck.value, password: pw, options: { emailRedirectTo: location.origin + "/" } });
  if (error) {
    let msg = error.message || "";
    if (/already registered|already been registered/i.test(msg)) msg = "Este e-mail já tem conta. Entre ou recupere a senha.";
    else if (/database error|creche_not_allowed/i.test(msg)) msg = "Este e-mail não está autorizado como creche. O acesso da creche é por convite.";
    else if (error.status === 429) msg = "Muitas tentativas. Aguarde alguns minutos.";
    else if (/password/i.test(msg)) msg = "Senha fraca ou já vazada em outros sites. Escolha outra.";
    return showFormMsg("signupError", "Não consegui criar a conta: " + msg);
  }
  clearAuthFields();
  if (data.session && data.user) { await enterApp(data.user, { fromLogin: true, isNew: true }); return; }
  showAuth("login");
  showFormMsg("loginError", "Conta criada! Enviamos um e-mail de confirmação. Confirme e depois entre.", true);
});

onSubmit("forgot", async () => {
  const v = Pure.validateEmail(getVal("forgotEmail"));
  if (!v.ok) return showFormMsg("forgotMsg", v.msg);
  const { error } = await sb.auth.resetPasswordForEmail(v.value, { redirectTo: location.origin + "/redefinir-senha" });
  if (error && error.status === 429) return showFormMsg("forgotMsg", "Muitas tentativas. Aguarde alguns minutos.");
  showFormMsg("forgotMsg", "Se o e-mail existir, enviamos um link para redefinir a senha.", true);
});

onSubmit("reset", async () => {
  const pw = getVal("resetPassword");
  const c = Pure.validatePassword(pw);
  if (!c.ok) return showFormMsg("resetMsg", c.msg);
  if (pw !== getVal("resetPassword2")) return showFormMsg("resetMsg", "As senhas não são iguais.");
  const { data, error } = await sb.auth.updateUser({ password: pw });
  if (error) return showFormMsg("resetMsg", "Não consegui salvar: " + error.message);
  toast("Senha atualizada!");
  history.replaceState({}, "", "/");
  await enterApp(data.user, { fromLogin: true });
});

function clearAuthFields() {
  ["loginEmail", "loginPassword", "signupEmail", "signupPassword", "signupPasswordConfirm", "forgotEmail", "resetPassword", "resetPassword2"].forEach(id => setVal(id, ""));
  $("signupConsent").checked = false;
}

/* ---------- entrada no app ---------- */
async function loadProfile() {
  const uid = S.user.id;
  let row = must(await sb.from("creche_profile").select("*").eq("user_id", uid).maybeSingle());
  if (!row) {  // contas antigas sem perfil: o trigger de INSERT força o papel correto no servidor
    row = must(await sb.from("creche_profile").insert({ user_id: uid }).select().single());
  }
  S.profile = row;
  S.role = row.account_role === "creche" ? "creche" : "tutor";
}

async function enterApp(user, opts) {
  opts = opts || {};
  resetState();
  S.user = user;
  try {
    await loadProfile();
    if (opts.fromLogin && S.role !== authRole) {
      toast(S.role === "creche" ? "Esta é uma conta de creche — abrimos o painel da creche." : "Esta é uma conta de tutor — abrimos o painel do tutor.", "info", 5000);
    }
    setAuthRole(S.role);
    hideAll();
    $("appShell").classList.remove("hidden");
    document.body.dataset.role = S.role;
    renderNav();
    if (S.role === "creche") await loadCrecheData(); else await loadTutorData();
    updateChrome();
    const next = takeNextPath();
    const start = (next && screenFromPath(next)) || screenFromPath(location.pathname) || "home";
    navigate(start, { replace: true });
    if (opts.isNew && S.role === "tutor") toast("Bem-vindo! Comece cadastrando seu pet em Perfil.", "info", 6000);
  } catch (err) {
    notifyError("enterApp", err, "Não consegui carregar seus dados.");
    await sb.auth.signOut().catch(() => {});
    resetState();
    showAuth("login", { replace: true });
    showFormMsg("loginError", "Não consegui carregar seus dados. Tente entrar de novo.");
  }
}

function rememberNextPath() {
  try { if (screenFromPath(location.pathname, "tutor") || screenFromPath(location.pathname, "creche")) sessionStorage.setItem("arya.next", location.pathname); } catch (e) { /* ignorar */ }
}
function takeNextPath() {
  try { const p = sessionStorage.getItem("arya.next"); sessionStorage.removeItem("arya.next"); return p; } catch (e) { return null; }
}

/* ---------- sair, exportar, excluir ---------- */
async function doLogout() {
  stopRealtime();
  await sb.auth.signOut().catch(err => logError("signOut", err));
  resetState();
  clearAuthFields();
  showAuth("login", { replace: true });
}
act("logout", () => doLogout());

function accountHtml() {
  return `
  <div class="card">
    <h3>Seus dados</h3>
    <p class="muted">Conta: <b>${esc(S.user.email || "")}</b></p>
    <div class="profile-actions">
      <button type="button" class="btn secondary" data-act="exportData">⬇ Exportar meus dados</button>
      <a class="btn secondary" href="/privacidade" target="_blank" rel="noopener">Política de privacidade</a>
    </div>
  </div>
  <div class="card">
    <h3>Encerrar conta</h3>
    <p class="muted">Apaga sua conta e todos os seus dados (pets, registros, pagamentos e arquivos). Não dá para desfazer.</p>
    <button type="button" class="btn secondary danger-outline" data-act="deleteAccount">🗑️ Excluir minha conta</button>
  </div>
  <button type="button" class="btn secondary full" data-act="logout">Sair da conta</button>`;
}

act("exportData", async () => {
  const uid = S.user.id;
  const one = async (t, col) => must(await sb.from(t).select("*").eq(col || "user_id", uid));
  const out = {
    exportado_em: new Date().toISOString(), conta: { id: uid, email: S.user.email }, papel: S.role,
    perfil: await one("creche_profile"), mensagem: await one("creche_app_message"),
    registros: await one("creche_records"), pagamentos: await one("creche_payments"),
    mensagens_salvas: await one("creche_custom_messages"), checkins: await one("day_checkins")
  };
  if (S.role === "tutor") { out.pets = await one("pets", "tutor_user_id"); out.vinculo = await one("tutor_links", "tutor_user_id"); }
  else { out.creche = S.creche; out.pets = S.crechePets || []; }
  download("meus-dados-caotrole.json", JSON.stringify(out, null, 2), "application/json");
  toast("Arquivo gerado.");
});

act("deleteAccount", () => {
  openModal("Excluir conta", `
    <p>Isso apaga <b>tudo</b> e não pode ser desfeito. Para confirmar, digite <b>EXCLUIR</b>:</p>
    <input id="delConfirm" autocomplete="off" autocapitalize="characters" aria-label="Digite EXCLUIR">
    <div class="row dlg-row">
      <button type="button" class="btn secondary" data-act="closeModal">Cancelar</button>
      <button type="button" class="btn danger" data-act="deleteAccountGo">Excluir definitivamente</button>
    </div>`);
});
act("deleteAccountGo", async () => {
  if (getVal("delConfirm").trim().toUpperCase() !== "EXCLUIR") { toast("Digite EXCLUIR para confirmar.", "err"); return; }
  const uid = S.user.id;
  const paths = new Set();
  for (const folder of [uid, uid + "/payments", uid + "/pet", uid + "/pets", uid + "/creche", uid + "/profile"]) {
    const { data } = await sb.storage.from(BUCKET).list(folder, { limit: 1000 });
    (data || []).filter(f => f.id).forEach(f => paths.add(folder + "/" + f.name));
  }
  if (S.profile && S.profile.photo_path) paths.add(S.profile.photo_path);
  S.payments.forEach(p => p.attachment_path && paths.add(p.attachment_path));
  if (paths.size) await sb.storage.from(BUCKET).remove([...paths]);
  must(await sb.rpc("delete_my_account"));
  closeModal();
  stopRealtime();
  await sb.auth.signOut().catch(() => {});
  resetState();
  showAuth("landing", { replace: true });
  toast("Conta excluída.", "ok", 5000);
});
