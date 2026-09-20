"use strict";
/* Rotas do app logado e barra de navegação. Tutor e creche têm telas, rotas e textos próprios. */

const SCREENS = {
  tutor: {
    home:     { el: "t-home",     path: "/tutor/inicio",     label: "Início",     icon: "🏠", title: "Início",         render: () => renderTutorHome() },
    calendar: { el: "t-calendar", path: "/tutor/calendario", label: "Calendário", icon: "📅", title: "Calendário",     render: () => renderCalendar() },
    messages: { el: "t-messages", path: "/tutor/mensagens",  label: "Mensagens",  icon: "💬", title: "Mensagens",      render: () => renderMessages() },
    payments: { el: "t-payments", path: "/tutor/pagamentos", label: "Pagamentos", icon: "💰", title: "Pagamentos",     render: () => renderPayments() },
    profile:  { el: "t-profile",  path: "/tutor/perfil",     label: "Perfil",     icon: "👤", title: "Perfil",         render: () => renderTutorProfile() }
  },
  creche: {
    home:    { el: "c-home",    path: "/creche/hoje",       label: "Hoje",       icon: "🏠", title: "Hoje",           render: () => renderBoard() },
    pets:    { el: "c-pets",    path: "/creche/caes",       label: "Cães",       icon: "🐶", title: "Cães e famílias", render: () => renderCrechePets() },
    tutors:  { el: "c-tutors",  path: "/creche/tutores",    label: "Tutores",    icon: "👥", title: "Tutores",        render: () => renderCrecheTutors() },
    finance: { el: "c-finance", path: "/creche/financeiro", label: "Financeiro", icon: "💰", title: "Financeiro",     render: () => renderFinance() },
    profile: { el: "c-profile", path: "/creche/perfil",     label: "Perfil",     icon: "👤", title: "Perfil",         render: () => renderCrecheProfile() }
  }
};
const NAV_ORDER = ["home", "calendar", "messages", "payments", "profile"];
const CRECHE_NAV_ORDER = ["home", "pets", "tutors", "finance", "profile"];
/** rotas antigas continuam funcionando */
const LEGACY_PATHS = {
  "/inicio": "home", "/calendario": "calendar", "/mensagens": "messages", "/pagamentos": "payments", "/perfil": "profile",
  "/familias": "pets", "/creche/inicio": "home", "/creche/mensagens": "home", "/creche/calendario": "home"
};
let currentScreen = null;

function navOrder(role) { return (role || S.role) === "creche" ? CRECHE_NAV_ORDER : NAV_ORDER; }

/** path → chave de tela válida para o papel (ou null) */
function screenFromPath(path, role) {
  const r = role || S.role || authRole;
  const p = (path || "").replace(/\/$/, "") || "/";
  const table = SCREENS[r];
  for (const k of Object.keys(table)) if (table[k].path === p) return k;
  if (LEGACY_PATHS[p] && table[LEGACY_PATHS[p]]) return LEGACY_PATHS[p];
  return null;
}

function renderNav() {
  const role = S.role || authRole;
  const table = SCREENS[role];
  $("appNav").classList.toggle("nav-creche", role === "creche");
  $("appNav").innerHTML = navOrder(role).map(k =>
    `<button type="button" data-act="nav" data-screen="${k}" data-nav="${k}"><span class="nav-ico" aria-hidden="true">${table[k].icon}</span><span>${esc(table[k].label)}</span></button>`
  ).join("");
}

function navigate(key, opts) {
  opts = opts || {};
  const table = SCREENS[S.role || authRole];
  const s = table[key] || table.home;
  key = table[key] ? key : "home";
  document.querySelectorAll("main .screen").forEach(x => x.classList.remove("active"));
  $(s.el).classList.add("active");
  document.querySelectorAll("#appNav button").forEach(b => {
    const on = b.dataset.nav === key;
    b.classList.toggle("active", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  if (!opts.skipRoute && location.pathname !== s.path) history[opts.replace ? "replaceState" : "pushState"]({ screen: key }, "", s.path);
  document.title = s.title + " — Cãotrole";
  currentScreen = key;
  try { Promise.resolve(s.render()).catch(err => notifyError("render:" + key, err)); } catch (err) { notifyError("render:" + key, err); }
  if (!opts.keepScroll) scrollTo(0, 0);
  if (opts.focus !== false) { const h = $(s.el).querySelector("h2"); if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); } }
}
act("nav", el => navigate(el.dataset.screen));

window.addEventListener("popstate", () => {
  if (!S.user) {
    const a = authViewFromPath(location.pathname);
    if (a) { if (a.role) setAuthRole(a.role); showAuth(a.view, { skipRoute: true }); } else showAuth("landing", { skipRoute: true });
    return;
  }
  navigate(screenFromPath(location.pathname) || "home", { skipRoute: true, focus: false });
});

/** cabeçalho: nome + avatar conforme o papel (creche NUNCA mostra "Meu pet") */
function updateChrome() {
  let name, photo, emoji, title;
  if (S.role === "creche") {
    name = (S.creche && S.creche.name) || "Minha creche";
    photo = S.creche && S.creche.photo_path; emoji = "🏠"; title = "Cãotrole";
    $("brandEyebrow").textContent = "PAINEL DA CRECHE";
    $("petMenu").setAttribute("aria-label", "Abrir perfil da creche");
  } else {
    const pet = typeof activePet === "function" ? activePet() : null;
    name = (pet && pet.name) || "Perfil"; photo = pet && pet.photo_path; emoji = "🐶"; title = "Cãotrole";
    $("brandEyebrow").textContent = "PAINEL DO TUTOR";
    $("petMenu").setAttribute("aria-label", pet ? "Abrir perfil de " + pet.name : "Abrir perfil");
  }
  $("headerName").textContent = name;
  $("brandTitle").textContent = title;
  if (photo) setHtml($("headerAvatar"), imgHtml(photo, "")); else $("headerAvatar").textContent = emoji;
}
