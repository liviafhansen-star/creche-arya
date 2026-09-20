const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../js/lib/pure.js");

test("esc neutraliza HTML e aspas", () => {
  assert.equal(P.esc(`<img src=x onerror="alert(1)">'\``), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&#96;");
  assert.equal(P.esc(null), "");
  assert.equal(P.esc(0), "0");
});

test("datas usam fuso local (sem UTC)", () => {
  // 22:30 em qualquer fuso: o dia local NÃO pode virar o dia seguinte
  const d = new Date(2026, 8, 19, 22, 30);
  assert.equal(P.todayIso(d), "2026-09-19");
  assert.equal(P.addDaysIso("2026-09-30", 1), "2026-10-01");
  assert.equal(P.monthEnd("2026-02"), "2026-02-28");
  assert.equal(P.isWeekendIso("2026-09-19"), true);   // sábado
  assert.equal(P.isWeekendIso("2026-09-21"), false);  // segunda
  assert.equal(P.formatBRDate("2026-09-19"), "19/09/26");
});

test("priceFor usa os valores da creche e trata fim de semana", () => {
  const p = { day: 50, over: 80, weekendDay: 0, weekendOver: 90 };
  assert.equal(P.priceFor("2026-09-21", "was", p), 50);
  assert.equal(P.priceFor("2026-09-21", "over", p), 80);
  assert.equal(P.priceFor("2026-09-19", "was", p), 0);
  assert.equal(P.priceFor("2026-09-19", "over", p), 90);
  assert.equal(P.priceFor("2026-09-21", "not", p), 0);
  assert.equal(P.priceFor("2026-09-21", "none", p), 0);
  assert.equal(P.priceFor("2026-09-21", "was"), 40);            // padrão
  assert.deepEqual(P.pricingFromCreche({ price_day: "55", price_over: "70", price_weekend_day: "10", price_weekend_over: "95" }),
    { day: 55, over: 70, weekendDay: 10, weekendOver: 95 });
  assert.deepEqual(P.pricingFromCreche(null), P.DEFAULT_PRICING);
});

test("parseMoney", () => {
  assert.deepEqual(P.parseMoney("1.234,50"), { ok: true, value: 1234.5 });
  assert.deepEqual(P.parseMoney("R$ 40"), { ok: true, value: 40 });
  assert.equal(P.parseMoney("0").ok, false);
  assert.equal(P.parseMoney("-5").ok, false);
  assert.equal(P.parseMoney("abc").ok, false);
  assert.equal(P.parseMoney("").ok, false);
});

test("cobertura de pagamentos (paid_through) e conciliação", () => {
  const pays = [
    { paid_through: "2026-09-10", status: "confirmado" },
    { paid_through: "2026-09-20", status: "enviado" },
    { paid_through: "2026-12-31", status: "recusado" },
    { note: "pago até 05.09", date: "2026-09-05" }
  ];
  assert.equal(P.maxPaidThrough(pays), "2026-09-20");                    // ignora recusado
  assert.equal(P.maxPaidThrough(pays, ["confirmado"]), "2026-09-10");
  assert.equal(P.effectivePaidThrough(pays[3]), "2026-09-05");
  const charges = { "2026-09-08": 40, "2026-09-12": 40, "2026-09-15": 60, "2026-10-01": 40 };
  assert.equal(P.sumCharges(charges, { month: "2026-09" }), 140);
  assert.equal(P.sumCharges(charges, { after: "2026-09-10" }), 140);     // 12, 15 e 10/01
  assert.equal(P.dueThrough(charges, "2026-09-10", "2026-09-15"), 100);
  assert.equal(P.dueThrough(charges, null, "2026-09-30"), 140);
  assert.equal(P.monthStatus(0, 0), "vazio");
  assert.equal(P.monthStatus(100, 0), "pago");
  assert.equal(P.monthStatus(100, 40), "parcial");
  assert.equal(P.monthStatus(100, 100), "aberto");
});

test("validadores de PIX", () => {
  assert.equal(P.validateCPF("529.982.247-25").ok, true);
  assert.equal(P.validateCPF("111.111.111-11").ok, false);
  assert.equal(P.validateCPF("123").ok, false);
  assert.equal(P.validateCNPJ("11.222.333/0001-81").ok, true);
  assert.equal(P.validateCNPJ("11.222.333/0001-82").ok, false);
  assert.equal(P.validateTelefone("(51) 99894-0123").value, "(51) 99894-0123");
  assert.equal(P.validateTelefone("5133334444").value, "(51) 3333-4444");
  assert.equal(P.validateTelefone("51 89894 0123").ok, false);
  assert.equal(P.validateEmail(" A@B.com ").value, "a@b.com");
  assert.equal(P.validateEmail("a@@b.com").ok, false);
  assert.equal(P.validatePixAleatoria("123e4567-e89b-42d3-a456-426614174000").ok, true);
  assert.equal(P.validatePixAleatoria("nao-e-uuid").ok, false);
  assert.equal(P.validatePixKey("???", "x").ok, false);
});

test("senha e upload", () => {
  assert.equal(P.validatePassword("abc123").ok, false);
  assert.equal(P.validatePassword("abcdefgh").ok, false);
  assert.equal(P.validatePassword("abcdefg1").ok, true);
  assert.equal(P.validateUpload({ type: "image/jpeg", size: 1000 }).ok, true);
  assert.equal(P.validateUpload({ type: "application/x-msdownload", size: 10 }).ok, false);
  assert.equal(P.validateUpload({ type: "image/png", size: 6 * 1024 * 1024 }).ok, false);
  assert.equal(P.safeFileName("Comprovante Tia Cléo (1).JPG"), "Comprovante-Tia-Cleo-1.jpg");
  assert.equal(P.safeFileName("../../etc/passwd"), "passwd");
});

test("máscaras", () => {
  assert.equal(P.formatPhoneBr("51998940123"), "(51) 9 9894-0123");
  assert.equal(P.formatPhoneBr("5133"), "(51) 33");
  assert.equal(P.formatCpfMask("52998224725"), "529.982.247-25");
  assert.equal(P.formatCnpjMask("11222333000181"), "11.222.333/0001-81");
});

test("waLink usa o telefone do cadastro e codifica o texto", () => {
  assert.equal(P.waLink("(51) 99894-0123", "Oi & tudo?"), "https://wa.me/5551998940123?text=Oi%20%26%20tudo%3F");
  assert.equal(P.waLink("", "x"), "https://wa.me/?text=x");
  assert.equal(P.waLink("5551998940123", "x"), "https://wa.me/5551998940123?text=x");
  assert.ok(P.inviteMessage("Creche X", "ABCD1234", "https://a.b").includes("ABCD1234"));
});

test("estado único do dia por pet", () => {
  const dow = 2;
  const manual = { id: "m", weekdays: [2], tutor_user_id: null };
  const app = { id: "a", weekdays: [2, 3], tutor_user_id: "u1" };
  const appOff = { id: "b", weekdays: [1], tutor_user_id: "u2" };
  assert.equal(P.petDayState(manual, null, null, dow), "esperado");
  assert.equal(P.petDayState(manual, { status: "not_coming" }, null, dow), "avisou_nao_vem");
  assert.equal(P.petDayState(app, { status: "coming" }, null, dow), "avisou_vem");
  assert.equal(P.petDayState(app, { status: "coming" }, { status: "presente" }, dow), "presente");
  assert.equal(P.petDayState(app, null, { status: "faltou" }, dow), "faltou");
  assert.equal(P.petDayState(appOff, null, null, dow), null);                       // fora da agenda, sem aviso
  assert.equal(P.petDayState(appOff, { status: "coming" }, null, dow), "avisou_vem"); // vem fora da agenda
  assert.equal(P.petDayState({ weekdays: [], tutor_user_id: null }, null, null, dow), "esperado"); // manual sem dias = todos
  assert.equal(P.petDayState({ weekdays: [], tutor_user_id: "u" }, null, null, dow), null);
});

test("ação em massa nunca atinge quem avisou que não vem", () => {
  const items = [
    { id: 1, state: "esperado" }, { id: 2, state: "avisou_vem" }, { id: 3, state: "avisou_nao_vem" },
    { id: 4, state: "presente" }, { id: 5, state: "faltou" }, { id: 6, state: "saiu" }
  ];
  assert.deepEqual(P.bulkTargets(items, "presente").map(i => i.id), [1, 2]);
  assert.deepEqual(P.bulkTargets(items, "saiu").map(i => i.id), [4]);
  assert.deepEqual(P.bulkTargets(items, "outro"), []);
  const c = P.boardCounts(items);
  assert.deepEqual(c, { total: 6, vem: 2, presente: 1, saiu: 1, faltou: 1, naoVem: 1 });
  assert.equal(items.filter(P.FILTERS.faltas).length, 2);
  assert.equal(items.filter(P.FILTERS.presentes).length, 1);
});

test("CSV protege contra injeção de fórmula", () => {
  assert.equal(P.csvCell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
  assert.equal(P.csvCell("a;b"), '"a;b"');
  assert.equal(P.toCsv([["a", 1], ["b", "c\nd"]]), 'a;1\nb;"c\nd"');
});

test("parseMoney aceita zero só quando permitido (preços)", () => {
  assert.equal(P.parseMoney("0", { allowZero: true }).value, 0);
  assert.equal(P.parseMoney("-1", { allowZero: true }).ok, false);
  assert.equal(P.parseMoney("70,5", { allowZero: true }).value, 70.5);
});

test("coverageForValue: até onde um valor parcial cobre", () => {
  const charges = { "2026-09-01": 40, "2026-09-02": 40, "2026-09-03": 60, "2026-09-04": 0, "2026-09-05": 40 };
  assert.deepEqual(P.coverageForValue(charges, null, 100), { through: "2026-09-02", covered: 80 });
  assert.deepEqual(P.coverageForValue(charges, null, 140), { through: "2026-09-03", covered: 140 });
  assert.deepEqual(P.coverageForValue(charges, "2026-09-02", 60), { through: "2026-09-03", covered: 60 });
  assert.deepEqual(P.coverageForValue(charges, null, 10), { through: null, covered: 0 });
});
