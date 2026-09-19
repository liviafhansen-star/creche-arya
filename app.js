// ---- Conexão com o Supabase (banco de dados online) ----
const SUPABASE_URL = "https://svtlpvsfdmfdrgzhpbvz.supabase.co";
const SUPABASE_KEY = "sb_publishable_u1RNww4af2uybpEGbEicmw_Nh2cR_3R";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const BUCKET = "creche-anexos";

let currentUserId = null;

function isCrecheRole() {
  if (data.profile && data.profile.account_role === "creche") return true;
  if (rememberedAuthRole() === "creche") return true;
  return false;
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
    account_role: "",
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
  // Sem INSERT/UPSERT no login. Perfil nasce no cadastro; POST aqui causava 409.
  return;
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
    if (isCrecheAccountUser(user)) {
      data.profile.account_role = "creche";
      rememberAuthRole("creche");
      await sb.from("creche_profile").update({ account_role: "creche" }).eq("user_id", uid);
    } else if (!data.profile.account_role) {
      data.profile.account_role = wantedLandingRole();
      await sb.from("creche_profile").update({ account_role: data.profile.account_role }).eq("user_id", uid);
    }
    const lockedRole = data.profile.account_role === "creche" ? "creche" : "tutor";
    const wantedRole = isCrecheAccountUser(user) ? "creche" : wantedLandingRole();
    const restoring = !pathIsAuthLogin() && !pathIsSignup();
    if (!restoring && !isCrecheAccountUser(user) && lockedRole !== wantedRole) {
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
    rememberAuthRole(lockedRole);
    if (lockedRole === "creche") {
      ensureClientsShape();
      if (typeof getClients === "function" && !getClients().length && typeof seedDemoCrecheClients === "function") {
        seedDemoCrecheClients();
      }
    }
  try { sessionStorage.setItem("creche_auth_role", pendingRole); } catch (e) {}
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
  rememberAuthRole(role === "creche" ? "creche" : "tutor");
  updateAuthCopy();
  showLoginScreen();
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
    ? "Entre com o usuário da creche (não é e-mail). Conta de tutor não entra aqui."
    : "Só contas de tutor. Conta de creche não entra por aqui.";
  if (signupTitle) signupTitle.textContent = isCreche ? "Criar conta da creche" : "Criar conta de tutor";
  if (signupSub) signupSub.textContent = isCreche
    ? "Escolha um usuário novo. Não use e-mail — evita conflito com conta de tutor."
    : "Use o e-mail da família. Esta conta fica travada no acesso de tutor.";
  if (loginBtn) loginBtn.textContent = isCreche ? "Entrar na creche" : "Entrar como tutor";
  if (signupBtn) signupBtn.textContent = isCreche ? "Criar conta da creche" : "Criar conta de tutor";

  // Campos: creche = usuário; tutor = e-mail (não destruir o input)
  [
    ["loginEmail", "loginEmailLabelText"],
    ["signupEmail", "signupEmailLabelText"]
  ].forEach(([inputId, labelTextId]) => {
    const input = document.getElementById(inputId);
    const labelText = document.getElementById(labelTextId);
    if (!input) return;
    if (isCreche) {
      input.type = "text";
      input.inputMode = "text";
      input.name = inputId === "loginEmail" ? "creche_user" : "creche_signup_user";
      input.autocomplete = "username";
      input.placeholder = "livia_admin";
      input.removeAttribute("autocapitalize");
      input.spellcheck = false;
      if (labelText) labelText.textContent = "Usuário";
    } else {
      input.type = "email";
      input.inputMode = "email";
      input.name = inputId === "loginEmail" ? "email" : "signup_email";
      input.autocomplete = inputId === "loginEmail" ? "username" : "off";
      input.placeholder = "seu@email.com";
      if (labelText) labelText.textContent = "E-mail";
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

function authRoleFromPath() {
  const p = currentPath();
  if (p === "/creche/entrar" || p === "/creche/cadastro") return "creche";
  if (p === "/tutor" || p === "/tutor/cadastro") return "tutor";
  // /creche alone = login only when logged out; when logged in it's handled as app
  if (p === "/creche") return "creche";
  return null;
}

function pathIsSignup() {
  const p = currentPath();
  return p === "/cadastro" || p === "/tutor/cadastro" || p === "/creche/cadastro";
}

function pathIsAuthLogin() {
  const p = currentPath();
  return p === "/tutor" || p === "/creche" || p === "/creche/entrar" || p === "/login";
}

function setAuthRoute(view, opts) {
  opts = opts || {};
  authView = view;
  const role = pendingRole === "creche" ? "creche" : "tutor";
  let want = "/";
  if (view === "signup") want = role === "creche" ? "/creche/cadastro" : "/tutor/cadastro";
  else if (view === "login") want = role === "creche" ? "/creche/entrar" : "/tutor";
  else want = "/";
  const cur = currentPath();
  if (cur !== want) {
    history[opts.replace ? "replaceState" : "pushState"]({ authView: view, role: pendingRole }, "", want);
  }
}

function applyRoleFromPath() {
  const role = authRoleFromPath();
  if (role) rememberAuthRole(role);
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
function openAuthFromPath() {
  applyRoleFromPath();
  updateAuthCopy();
  if (pathIsSignup()) showSignupScreen();
  else if (pathIsAuthLogin()) showLoginScreen();
  else showLandingScreen();
}

async function initAuth() {
  applyRoleFromPath();
  if (pathIsSignup()) { authView = "signup"; clearSignupFields(); }
  else if (pathIsAuthLogin()) { authView = "login"; }
  else { authView = "landing"; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    showApp(false);
    openAuthFromPath();
  } else if (session) {
    await enterAppAfterLogin();
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
      await enterAppAfterLogin();
    } else {
      showApp(false);
      openAuthFromPath();
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
  return rememberedAuthRole() === "creche" ? "creche" : "tutor";
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
  if (isCrecheAccountUser(user)) {
    rememberAuthRole("creche");
    const uname = crecheEmailToUsername(user.email);
    if (!canUseCrecheRole(uname) && !canUseCrecheRole(user.email)) {
      await sb.auth.signOut();
      return { ok: false, message: crecheNotOpenMessage() };
    }
    return { ok: true, lockedRole: "creche" };
  }
  const wanted = wantedLandingRole();
  // No F5 / restore: se não estamos numa tela de login, confia no perfil (não desloga)
  const restoring = !pathIsAuthLogin() && !pathIsSignup();
  if (wanted === "creche" && !canUseCrecheRole(user.email) && !restoring) {
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
    if (!restoring && locked !== wanted) {
      await sb.auth.signOut();
      return { ok: false, message: roleMismatchMessage(locked), lockedRole: locked };
    }
    rememberAuthRole(locked);
    return { ok: true, lockedRole: locked };
  }
  return { ok: true, lockedRole: null };
}


/** Depois do login: sai de /tutor|/creche e abre o painel */
async function enterAppAfterLogin() {
  showApp(true);
  const creche = isCrecheRole() || rememberedAuthRole() === "creche";
  const want = creche ? "/creche/hoje" : "/inicio";
  if (currentPath() !== want) {
    history.replaceState({ screen: "home" }, "", want);
  }
  go("home", { replace: true, skipRoute: true });
  await loadAll();
  // loadAll atualiza account_role — reaplica layout creche
  applyRoleLayout();
  updateBrandForRole();
  if (isCrecheRole()) {
    if (currentPath() !== "/creche/hoje" && pathIsAuthLogin()) {
      history.replaceState({ screen: "home" }, "", "/creche/hoje");
    }
    renderCrecheToday();
  }
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
  await enterAppAfterLogin();
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
      const blank = emptyProfile(user.id);
      blank.account_role = wantedRole;
      if (id.isCreche && id.username) blank.name = id.username;
      await sb.from("creche_profile").upsert(blank, { onConflict: "user_id" });
      await sb.from("creche_app_message").upsert({ user_id: user.id, text: "" }, { onConflict: "user_id" });
    } catch (e) { console.warn("signup profile:", e); }
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
