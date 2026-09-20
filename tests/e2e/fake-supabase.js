/* Supabase FALSO em memória — só para desenvolvimento/testes de UI (npm run dev:fake). Nunca vai para produção:
 * o dev-server o serve no lugar de /vendor/supabase-*.js quando FAKE_SUPABASE=1.
 * Emula o suficiente do PostgREST + dos triggers/RLS da migration para exercitar as telas.
 * Contas semeadas (senha "senha1234"): tutor@teste.com (tutor, pet Arya, vinculada) e dono@creche.caotrole.app (creche). */
(function () {
  const A = "00000000-0000-4000-8000-0000000000a1", B = "00000000-0000-4000-8000-0000000000b1";
  const CR = "00000000-0000-4000-8000-0000000000c1", PET = "00000000-0000-4000-8000-0000000000d1", PET2 = "00000000-0000-4000-8000-0000000000d2";
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = iso(new Date());
  const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
  const seed = () => ({
    users: [{ id: A, email: "tutor@teste.com" }, { id: B, email: "dono@creche.caotrole.app" }],
    app_schema: [{ version: 1 }],
    creche_profile: [{ user_id: A, account_role: "tutor", name: "", owner1_name: "Lívia", owner1_contact: "(51) 99894-0123", owner2_name: "", owner2_contact: "", pix_keys: [] },
      { user_id: B, account_role: "creche", name: "", pix_keys: [] }],
    creche_app_message: [], creche_custom_messages: [], client_errors: [],
    creches: [{ id: CR, name: "Creche Teste", invite_code: "ABCD1234", price_day: 40, price_over: 60, price_weekend_day: 0, price_weekend_over: 70, phone: "51998940123", pix_keys: [{ id: "k1", type: "Telefone", key: "(51) 99894-0123" }], photo_path: null }],
    creche_members: [{ creche_id: CR, user_id: B, role: "owner" }],
    tutor_links: [{ id: "l1", creche_id: CR, tutor_user_id: A }],
    pets: [{ id: PET, tutor_user_id: A, creche_id: CR, name: "Arya", breed: "SRD", birth_date: null, photo_path: null, weekdays: [0, 1, 2, 3, 4, 5, 6], overnight_weekday: false, overnight_weekend: true, tutor_name: "Lívia", tutor_phone: "51998940123", notes: "Alergia a frango", active: true, created_at: "2026-09-01T00:00:00Z" },
      { id: PET2, tutor_user_id: null, creche_id: CR, name: "Thor", breed: "", birth_date: null, photo_path: null, weekdays: [], overnight_weekday: false, overnight_weekend: false, tutor_name: "Maria", tutor_phone: "", notes: "", active: true, created_at: "2026-09-02T00:00:00Z" }],
    creche_records: [{ user_id: A, date: ago(3), status: "was" }, { user_id: A, date: ago(2), status: "over" }],
    creche_payments: [{ id: 1, user_id: A, date: ago(20), value: 40, note: "antigo", paid_through: ago(10), attachment_path: null, status: "confirmado" }],
    day_checkins: [], attendance: []
  });
  let db;
  try { db = JSON.parse(sessionStorage.getItem("fake.db")) || seed(); } catch (e) { db = seed(); }
  const save = () => { try { sessionStorage.setItem("fake.db", JSON.stringify(db)); } catch (e) { /* ignorar */ } };
  let session = null;
  try { const u = sessionStorage.getItem("fake.user"); if (u) session = { user: db.users.find(x => x.id === u) }; } catch (e) { /* ignorar */ }
  const listeners = [];
  const emit = (ev, s) => listeners.forEach(cb => cb(ev, s));
  const me = () => session && session.user;
  const role = () => { const p = me() && db.creche_profile.find(x => x.user_id === me().id); return p && p.account_role; };
  const myCreche = () => { const m = me() && db.creche_members.find(x => x.user_id === me().id); return m && m.creche_id; };
  const linked = () => { const l = me() && db.tutor_links.find(x => x.tutor_user_id === me().id); return l && l.creche_id; };
  const rnd = () => crypto.randomUUID();

  function visible(t, r) {                       // RLS simplificada
    if (t === "app_schema") return true;
    const u = me(); if (!u) return false;
    if (role() === "creche") {
      const c = myCreche();
      if (["pets", "attendance", "day_checkins"].includes(t)) return r.creche_id === c;
      if (t === "creches") return r.id === c;
      if (t === "creche_members") return r.creche_id === c;
      if (t === "tutor_links") return r.creche_id === c;
      if (t === "creche_payments") return db.tutor_links.some(l => l.creche_id === c && l.tutor_user_id === r.user_id);
      if (t === "app_schema") return true;
      return r.user_id === u.id;
    }
    if (t === "pets") return r.tutor_user_id === u.id;
    if (t === "attendance") return db.pets.some(p => p.id === r.pet_id && p.tutor_user_id === u.id);
    if (t === "creches") return r.id === linked();
    if (t === "tutor_links") return r.tutor_user_id === u.id;
    if (t === "app_schema") return true;
    return r.user_id === u.id;
  }

  class Q {
    constructor(t) { this.t = t; this.op = "select"; this.f = []; this.ord = []; this.ret = false; this.one = null; this.rg = null; this.lim = null; }
    select() { this.ret = true; return this; }
    insert(p) { this.op = "insert"; this.p = p; return this; }
    update(p) { this.op = "update"; this.p = p; return this; }
    upsert(p, o) { this.op = "upsert"; this.p = p; this.conf = ((o && o.onConflict) || "").split(","); return this; }
    delete() { this.op = "delete"; return this; }
    eq(c, v) { this.f.push(r => r[c] === v); return this; }
    in(c, a) { this.f.push(r => a.includes(r[c])); return this; }
    is(c, v) { this.f.push(r => (r[c] == null) === (v === null)); return this; }
    gte(c, v) { this.f.push(r => r[c] >= v); return this; }
    order(c, o) { this.ord.push([c, !(o && o.ascending === false)]); return this; }
    range(a, b) { this.rg = [a, b]; return this; }
    limit(n) { this.lim = n; return this; }
    maybeSingle() { this.one = "maybe"; return this; }
    single() { this.one = "single"; return this; }
    then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
    fin(rows) {
      let out = rows;
      if (this.one) {
        if (out.length > 1 || (this.one === "single" && !out.length)) return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };
        out = out[0] || null;
      }
      return { data: out, error: null };
    }
    trig(row, old) {                              // triggers da migration
      const t = this.t, u = me();
      if (t === "pets" && row.tutor_user_id) row.creche_id = linked() || null;
      if (t === "day_checkins") { row.creche_id = linked() || null; if (!old) { row.seen_at = null; } if (old && old.status !== row.status) row.seen_at = null; row.updated_at = new Date().toISOString(); }
      if (t === "attendance") { if (row.status === "presente" && (!old || old.status !== "presente")) { row.arrived_at = new Date().toISOString(); row.left_at = null; } if (row.status === "saiu" && (!old || old.status !== "saiu")) row.left_at = new Date().toISOString(); }
      if (t === "creche_payments" && !old) { row.status = "enviado"; }
      return row;
    }
    run() {
      const u = me(); if (!u && this.t !== "app_schema") return { data: null, error: { message: "JWT expired", code: "401" } };
      const all = db[this.t] || (db[this.t] = []);
      const match = r => visible(this.t, r) && this.f.every(fn => fn(r));
      if (this.op === "select") {
        let rows = all.filter(match).map(r => ({ ...r }));
        this.ord.forEach(([c, asc]) => rows.sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1)));
        if (this.rg) rows = rows.slice(this.rg[0], this.rg[1] + 1);
        if (this.lim != null) rows = rows.slice(0, this.lim);
        return this.fin(rows);
      }
      if (this.op === "insert" || this.op === "upsert") {
        const out = [];
        for (const raw of [].concat(this.p)) {
          let row = { ...raw };
          const ex = this.op === "upsert" ? all.find(r => this.conf.every(c => r[c] === row[c])) : null;
          if (ex) { Object.assign(ex, this.trig({ ...ex, ...row }, ex)); out.push({ ...ex }); continue; }
          if (this.t === "creche_payments" && row.id == null) row.id = (all.reduce((m, r) => Math.max(m, r.id || 0), 0)) + 1;
          if (this.t === "creche_custom_messages" && row.id == null) row.id = (all.reduce((m, r) => Math.max(m, r.id || 0), 0)) + 1;
          if (["pets", "attendance", "day_checkins"].includes(this.t) && !row.id) row.id = rnd();
          if (this.t === "pets") row = { breed: "", birth_date: null, photo_path: null, weekdays: [], overnight_weekday: false, overnight_weekend: false, tutor_name: "", tutor_phone: "", notes: "", active: true, created_at: new Date().toISOString(), ...row };
          if (this.t === "creche_profile") { row = { account_role: "tutor", pix_keys: [], ...row }; }
          if (this.t === "client_errors") { all.push(row); continue; }
          row = this.trig(row, null); all.push(row); out.push({ ...row });
        }
        save(); return this.fin(this.ret ? out : []);
      }
      if (this.op === "update") {
        const rows = all.filter(match); const out = [];
        rows.forEach(r => {
          const isOther = this.t === "day_checkins" && role() === "creche";
          if (isOther) { r.seen_at = new Date().toISOString(); out.push({ ...r }); return; }
          if (this.t === "creche_payments" && role() === "creche") { r.status = this.p.status; r.confirmed_by = me().id; out.push({ ...r }); return; }
          Object.assign(r, this.trig({ ...r, ...this.p }, { ...r })); out.push({ ...r });
        });
        save(); return this.fin(this.ret ? out : []);
      }
      if (this.op === "delete") {
        const rows = all.filter(match);
        db[this.t] = all.filter(r => !rows.includes(r));
        if (this.t === "pets") { const ids = rows.map(r => r.id); db.day_checkins = db.day_checkins.filter(c => !ids.includes(c.pet_id)); db.attendance = db.attendance.filter(c => !ids.includes(c.pet_id)); }
        save(); return this.fin([]);
      }
    }
  }

  const client = {
    from: t => new Q(t),
    rpc: async (fn, args) => {
      const u = me();
      if (fn === "join_creche") {
        const c = db.creches.find(x => x.invite_code === String(args.p_code).toUpperCase().trim());
        if (!c) return { data: null, error: { message: "codigo_invalido" } };
        db.tutor_links = db.tutor_links.filter(l => l.tutor_user_id !== u.id); db.tutor_links.push({ id: rnd(), creche_id: c.id, tutor_user_id: u.id });
        db.pets.filter(p => p.tutor_user_id === u.id).forEach(p => { p.creche_id = c.id; }); save(); return { data: c.id, error: null };
      }
      if (fn === "leave_creche") { db.tutor_links = db.tutor_links.filter(l => l.tutor_user_id !== u.id); db.pets.filter(p => p.tutor_user_id === u.id).forEach(p => { p.creche_id = null; }); save(); return { data: null, error: null }; }
      if (fn === "delete_my_account") { db.users = db.users.filter(x => x.id !== u.id); ["creche_profile", "creche_records", "creche_payments", "day_checkins"].forEach(t => { db[t] = db[t].filter(r => r.user_id !== u.id); }); db.pets = db.pets.filter(p => p.tutor_user_id !== u.id); save(); return { data: null, error: null }; }
      return { data: null, error: { message: "rpc desconhecida: " + fn } };
    },
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: cb => { listeners.push(cb); setTimeout(() => cb("INITIAL_SESSION", session), 0); return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithPassword: async ({ email, password }) => {
        const u = db.users.find(x => x.email === String(email).toLowerCase());
        if (!u || password !== "senha1234") return { data: {}, error: { message: "Invalid login credentials", status: 400 } };
        session = { user: u }; sessionStorage.setItem("fake.user", u.id); emit("SIGNED_IN", session); return { data: { user: u, session }, error: null };
      },
      signUp: async ({ email }) => {
        const e = String(email).toLowerCase();
        if (db.users.some(x => x.email === e)) return { data: {}, error: { message: "User already registered", status: 422 } };
        if (e.endsWith("@creche.caotrole.app")) return { data: {}, error: { message: "Database error saving new user", status: 500 } };
        const u = { id: rnd(), email: e }; db.users.push(u); db.creche_profile.push({ user_id: u.id, account_role: "tutor", name: "", pix_keys: [] }); save();
        session = { user: u }; sessionStorage.setItem("fake.user", u.id); emit("SIGNED_IN", session); return { data: { user: u, session }, error: null };
      },
      signOut: async () => { session = null; sessionStorage.removeItem("fake.user"); emit("SIGNED_OUT", null); return { error: null }; },
      resetPasswordForEmail: async () => ({ error: null }),
      updateUser: async () => ({ data: { user: me() }, error: null })
    },
    storage: { from: () => ({
      createSignedUrl: async () => ({ data: { signedUrl: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='40' height='40' fill='%23f8dce7'/></svg>" }, error: null }),
      upload: async p => ({ data: { path: p }, error: null }), remove: async () => ({ data: [], error: null }), list: async () => ({ data: [], error: null })
    }) },
    channel: () => { const ch = { on() { return ch; }, subscribe() { return ch; } }; return ch; },
    removeChannel: () => {}
  };
  window.__fake = { db: () => db, reset() { sessionStorage.clear(); location.href = "/"; } };
  window.supabase = { createClient: () => client };
})();
