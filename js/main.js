"use strict";
/* Boot: banners de ambiente, "banco = app", service worker, sessão e atualização periódica. */

async function checkSchema() {
  const { data, error } = await sb.from("app_schema").select("version").order("version", { ascending: false }).limit(1);
  const have = data && data[0] ? data[0].version : 0, need = APP_CONFIG.REQUIRED_SCHEMA;
  if (error || have < need) {
    const b = $("schemaBanner");
    b.textContent = `Banco de dados desatualizado (versão ${have}, o app exige ${need}). Aplique as migrations de supabase/migrations antes de usar o app.`;
    b.classList.remove("hidden");
    return false;
  }
  return true;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (["localhost", "127.0.0.1"].includes(location.hostname)) return;   // dev: sem cache do SW atrapalhando
  navigator.serviceWorker.register("/sw.js").then(reg => {
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      if (w) w.addEventListener("statechange", () => {
        if (w.state === "installed" && navigator.serviceWorker.controller) toast("Nova versão do app disponível.", "info", 12000, { label: "Atualizar", fn: () => location.reload() });
      });
    });
  }).catch(err => logError("sw.register", err));
}

function onAuthEvent(event, session) {
  if (event === "PASSWORD_RECOVERY") { showAuth("reset", { skipRoute: true }); return; }
  if (event === "SIGNED_OUT") {
    if (S.user) { stopRealtime(); resetState(); showAuth("login", { replace: true }); }
    return;
  }
  // SIGNED_IN também dispara ao voltar para a aba / renovar token: só age se for OUTRO usuário
  if (event === "SIGNED_IN" && !booting && session && session.user && (!S.user || S.user.id !== session.user.id)) enterApp(session.user);
}

function refreshCurrent() {
  if (!S.user || document.visibilityState !== "visible") return;
  const job = S.role === "creche" ? refreshBoard(true) : refreshTutorToday();
  job.catch(e => logError("poll", e));
}

(async function boot() {
  if (ENV.shared) {
    const b = $("envBanner");
    b.textContent = "⚠ Ambiente NÃO-produção usando o banco de PRODUÇÃO. Configure ENVS.development em js/config.js.";
    b.classList.remove("hidden");
  }
  registerServiceWorker();
  try {
    if (!(await checkSchema())) { $("boot").classList.add("hidden"); return; }
    sb.auth.onAuthStateChange((event, session) => setTimeout(() => onAuthEvent(event, session), 0));
    const path = location.pathname.replace(/\/$/, "") || "/";
    const a = authViewFromPath(path);
    if (a && a.role) setAuthRole(a.role);
    const { data: { session } } = await sb.auth.getSession();
    if (path === "/redefinir-senha") showAuth("reset", { skipRoute: true });
    else if (session) await enterApp(session.user);
    else if (a) showAuth(a.view, { skipRoute: true });
    else { rememberNextPath(); const r = ["/creche"].some(x => path.startsWith(x)) ? "creche" : "tutor"; if (screenFromPath(path, r)) { setAuthRole(r); showAuth("login", { replace: true }); } else showAuth("landing", { skipRoute: true }); }
  } catch (err) {
    notifyError("boot", err, "Não consegui iniciar.");
    showAuth("landing", { skipRoute: true });
  } finally {
    booting = false;
  }
})();

document.addEventListener("visibilitychange", refreshCurrent);
setInterval(refreshCurrent, 60000);
