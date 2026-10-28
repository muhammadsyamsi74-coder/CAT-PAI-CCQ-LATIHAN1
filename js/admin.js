// Panel admin: mapel, soal, hasil
const app = $("#app");
let tab = "subjects";
let subjectsCache = [];
let selSubject = null; // mapel terpilih di tab Soal / Hasil

const head = (right = "") => `<div class="row between" style="margin-bottom:12px">
  <div class="brand" style="margin:0"><div class="logo">☪</div><div><h1>${esc(CONFIG.APP_NAME)} — Admin</h1></div></div>${right}</div>`;

// ===================== LOGIN =====================
async function init() {
  if (!configured) { app.innerHTML = head() + notConfiguredHTML(); return; }
  const { data } = await sb.auth.getSession();
  data.session ? showAdmin() : showLogin();
}

function showLogin(msg = "") {
  app.innerHTML = head() + `<div class="card" style="max-width:420px;margin:24px auto">
    <h2>Masuk Admin</h2>
    <form id="lf">
      <label for="em">Email</label><input type="email" id="em" required autocomplete="username">
      <label for="pw">Kata sandi</label><input type="password" id="pw" required autocomplete="current-password">
      ${msg ? `<div class="alert err">${esc(msg)}</div>` : ""}
      <button class="primary" style="margin-top:14px;width:100%">Masuk</button>
    </form></div>`;
  $("#lf").onsubmit = async e => {
    e.preventDefault();
    const submit = $("#lf button"); submit.disabled = true; submit.textContent = "Memeriksa…";
    const { error } = await sb.auth.signInWithPassword({ email: $("#em").value.trim(), password: $("#pw").value });
    if (error) {
      let msg = error.message || "Login gagal.";
      if (/invalid login credentials/i.test(msg)) msg = "Email atau kata sandi salah. Pastikan akun sudah dibuat pada Authentication → Users.";
      else if (/email not confirmed/i.test(msg)) msg = "Email belum dikonfirmasi. Aktifkan Auto Confirm untuk user ini di Supabase Authentication → Users.";
      else if (/network|fetch/i.test(msg)) msg = "Tidak dapat terhubung ke Supabase. Periksa koneksi dan URL/key proyek.";
      return showLogin(msg);
    }
    showAdmin();
  };
}

async function showAdmin() {
  // pastikan akun ini terdaftar sebagai admin
  const { data: ok, error } = await sb.rpc("is_admin");
  if (error || !ok) {
    await sb.auth.signOut();
    return showLogin(error
      ? `Login berhasil tetapi pemeriksaan admin gagal: ${error.message}`
      : "Login berhasil, tetapi email belum terdaftar di tabel admin_emails. Tambahkan email ini di Supabase SQL Editor.");
  }
  app.innerHTML = head(`<button id="out" class="sm">Keluar</button>`) + `
    <div class="tabs">
      <button data-t="subjects">Mata Pelajaran</button>
      <button data-t="questions">Soal</button>
      <button data-t="results">Hasil Siswa</button>
    </div><div id="pane"></div>`;
  $("#out").onclick = async () => { await sb.auth.signOut(); showLogin(); };
  $(".tabs").onclick = e => { const b = e.target.closest("[data-t]"); if (b) go(b.dataset.t); };
  go(tab);
}

function go(t) {
  tab = t;
  $$(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.t === t));
  ({ subjects: paneSubjects, questions: paneQuestions, results: paneResults })[t]();
}

async function loadSubjects() {
  const { data, error } = await sb.from("subjects").select("*").order("created_at");
  if (error) { toast(errMsg(error)); return []; }
  subjectsCache = data;
  if (!selSubject || !data.find(s => s.id === selSubject)) selSubject = data[0]?.id ?? null;
  return data;
}

function subjectPicker(list) {
  return `<select id="sp" style="max-width:360px">${list.map(s =>
    `<option value="${s.id}" ${s.id === selSubject ? "selected" : ""}>${esc(s.name)}${s.is_active ? " (aktif)" : ""}</option>`).join("")}</select>`;
}

function localDateTimeValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function scheduleStatus(subject) {
  if (!subject.is_active) return "Nonaktif";
  const now = Date.now();
  const start = subject.scheduled_start ? new Date(subject.scheduled_start).getTime() : null;
  const end = subject.scheduled_end ? new Date(subject.scheduled_end).getTime() : null;
  if (start && now < start) return "Terjadwal";
  if (end && now >= end) return "Jadwal berakhir";
  return "Diujikan";
}

// ===================== TAB MAPEL =====================
async function paneSubjects() {
  const list = await loadSubjects();
  $("#pane").innerHTML = `
    <div class="card"><div class="row between"><h2 style="margin:0">Mata Pelajaran</h2>
      <button class="primary" id="add">+ Tambah Mapel</button></div>
      <p class="small muted">Aktifkan mapel yang sedang diujikan. Hanya mapel aktif yang tampil di halaman siswa.</p>
      <div class="tbl"><table><thead><tr><th>Nama</th><th>Durasi</th><th>Jadwal</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
      ${list.map(s => `<tr>
        <td><b>${esc(s.name)}</b><div class="small muted">${esc(s.description || "")}</div></td>
        <td>${s.duration_minutes} mnt</td>
        <td class="small">${s.scheduled_start ? new Date(s.scheduled_start).toLocaleString("id-ID") : "Langsung"}
          ${s.scheduled_end ? `<br>s.d. ${new Date(s.scheduled_end).toLocaleString("id-ID")}` : ""}</td>
        <td><label class="switch"><input type="checkbox" data-act="${s.id}" ${s.is_active ? "checked" : ""}>
          <span class="pill ${scheduleStatus(s) === "Diujikan" ? "on" : ""}">${scheduleStatus(s)}</span></label></td>
        <td class="row"><button class="sm" data-q="${s.id}">Soal</button>
          <button class="sm" data-ed="${s.id}">Edit</button>
          <button class="sm danger" data-del="${s.id}">Hapus</button></td></tr>`).join("")
        || `<tr><td colspan="5" class="muted">Belum ada mapel.</td></tr>`}
      </tbody></table></div></div>`;
  $("#add").onclick = () => subjectForm();
  $("#pane").onclick = async e => {
    const t = e.target;
    if (t.dataset.ed) subjectForm(list.find(s => s.id === t.dataset.ed));
    if (t.dataset.q) { selSubject = t.dataset.q; go("questions"); }
    if (t.dataset.del && confirm("Hapus mapel beserta SEMUA soal dan hasil siswanya?")) {
      const { error } = await sb.from("subjects").delete().eq("id", t.dataset.del);
      error ? toast(errMsg(error)) : paneSubjects();
    }
  };
  $("#pane").onchange = async e => {
    if (!e.target.dataset.act) return;
    const { error } = await sb.from("subjects").update({ is_active: e.target.checked }).eq("id", e.target.dataset.act);
    if (error) toast(errMsg(error));
    paneSubjects();
  };
}

function subjectForm(s = {}) {
  $("#pane").innerHTML = `<div class="card" style="max-width:600px"><h2>${s.id ? "Edit" : "Tambah"} Mapel</h2>
    <form id="sf">
      <label>Nama mapel</label><input type="text" id="n" required value="${esc(s.name || "")}" placeholder="Contoh: PAI Kelas 9 - Bab 3">
      <label>Keterangan (opsional)</label><input type="text" id="d" value="${esc(s.description || "")}">
      <label>Durasi (menit)</label><input type="number" id="m" min="1" required value="${s.duration_minutes || 60}">
      <div class="row"><div class="grow"><label for="schedule-start">Mulai diujikan (opsional)</label>
        <input type="datetime-local" id="schedule-start" value="${localDateTimeValue(s.scheduled_start)}"></div>
        <div class="grow"><label for="schedule-end">Berakhir diujikan (opsional)</label>
        <input type="datetime-local" id="schedule-end" value="${localDateTimeValue(s.scheduled_end)}"></div></div>
      <p class="small muted">Waktu mengikuti zona waktu lokal perangkat ini. Kosongkan mulai untuk langsung aktif; kosongkan berakhir agar tidak berakhir otomatis.</p>
      <label class="check"><input type="checkbox" id="sh" ${s.shuffle_questions ? "checked" : ""}> Acak urutan soal tiap siswa</label>
      <label class="check"><input type="checkbox" id="ac" ${s.is_active ? "checked" : ""}> Aktifkan mapel dan gunakan jadwal di atas</label>
      <div class="row" style="margin-top:14px"><button class="primary">Simpan</button>
      <button type="button" id="cc">Batal</button></div></form></div>`;
  $("#cc").onclick = paneSubjects;
  $("#sf").onsubmit = async e => {
    e.preventDefault();
    const startValue = $("#schedule-start").value;
    const endValue = $("#schedule-end").value;
    if (startValue && endValue && new Date(endValue) <= new Date(startValue))
      return toast("Waktu berakhir harus setelah waktu mulai.");
    const row = { name: $("#n").value.trim(), description: $("#d").value.trim() || null,
      duration_minutes: +$("#m").value, shuffle_questions: $("#sh").checked,
      is_active: $("#ac").checked,
      scheduled_start: startValue ? new Date(startValue).toISOString() : null,
      scheduled_end: endValue ? new Date(endValue).toISOString() : null };
    const { error } = s.id ? await sb.from("subjects").update(row).eq("id", s.id) : await sb.from("subjects").insert(row);
    error ? toast(errMsg(error)) : (toast("Tersimpan"), paneSubjects());
  };
}

// ===================== TAB SOAL =====================
async function paneQuestions() {
  const list = await loadSubjects();
  if (!list.length) { $("#pane").innerHTML = `<div class="card">Tambahkan mata pelajaran dulu.</div>`; return; }
  const { data: qs, error } = await sb.from("questions").select("*")
    .eq("subject_id", selSubject).order("position").order("created_at");
  if (error) { toast(errMsg(error)); return; }

  $("#pane").innerHTML = `<div class="card">
    <div class="row between"><div class="row">${subjectPicker(list)}<span class="muted small">${qs.length} soal</span></div>
      <div class="row"><button id="download-template" type="button">Unduh template Excel</button>
      <button id="import-trigger" type="button">Impor Excel</button>
      <input id="import-file" type="file" accept=".xlsx,.xls,.csv" hidden>
      <button class="primary" id="add">+ Tambah Soal</button></div></div>
    <p class="small muted">Kolom: Tipe, Teks Soal, Opsi A–E, Kunci Jawaban, Pembahasan, Bobot, Urutan.</p></div>
    ${qs.map((q, i) => `<div class="card"><div class="qrow"><div class="num">${i + 1}</div><div class="main">
      <div class="small muted">${q.type === "pg" ? "Pilihan ganda · kunci " + esc(q.answer) : "Jawaban singkat · kunci: " + esc(q.answer)} · ${q.points} poin</div>
      <div class="qbody" style="margin:6px 0">${rich(q.body)}</div>
      ${q.type === "pg" ? (q.options || []).map((o, k) => `<div class="small" ${LETTERS[k] === q.answer ? 'style="color:var(--ok);font-weight:700"' : ""}>${LETTERS[k]}. ${richInline(o)}</div>`).join("") : ""}
      </div><div class="row" style="flex:0 0 auto"><button class="sm" data-ed="${q.id}">Edit</button>
      <button class="sm danger" data-del="${q.id}">Hapus</button></div></div></div>`).join("")}`;
  $("#sp").onchange = e => { selSubject = e.target.value; paneQuestions(); };
  $("#add").onclick = () => questionForm({ position: (qs.at(-1)?.position ?? 0) + 1 });
  $("#download-template").onclick = downloadQuestionTemplate;
  $("#import-trigger").onclick = () => $("#import-file").click();
  $("#import-file").onchange = e => importQuestionSpreadsheet(e.target.files[0], qs);
  $("#pane").onclick = async e => {
    const t = e.target;
    if (t.dataset.ed) questionForm(qs.find(q => q.id === t.dataset.ed));
    if (t.dataset.del && confirm("Hapus soal ini?")) {
      const { error } = await sb.from("questions").delete().eq("id", t.dataset.del);
      error ? toast(errMsg(error)) : paneQuestions();
    }
  };
}

function downloadQuestionTemplate() {
  if (!window.XLSX) return toast("Pustaka Excel gagal dimuat. Muat ulang halaman admin.");
  const headers = ["Tipe", "Teks Soal", "Opsi A", "Opsi B", "Opsi C", "Opsi D", "Opsi E", "Kunci Jawaban", "Pembahasan", "Bobot", "Urutan"];
  const questions = XLSX.utils.aoa_to_sheet([headers]);
  questions["!cols"] = headers.map((_, i) => ({ wch: i === 1 || i === 8 ? 42 : 18 }));
  const guide = XLSX.utils.aoa_to_sheet([
    ["Panduan mengisi template soal CAT PAI"],
    ["Isi satu soal pada setiap baris di sheet Soal. Jangan ubah nama kolom."],
    ["Tipe", "Isi pg untuk pilihan ganda atau isian untuk jawaban singkat."],
    ["Pilihan ganda", "Isi minimal Opsi A dan Opsi B; Kunci Jawaban diisi huruf A, B, C, D, atau E."],
    ["Jawaban singkat", "Isi Kunci Jawaban dengan jawaban benar; beberapa variasi pisahkan dengan |. Opsi dikosongkan."],
    ["Pembahasan", "Opsional. Teks Arab dan baris baru diperbolehkan."],
    ["Bobot", "Bilangan bulat minimal 1; jika kosong akan menjadi 1."],
    ["Urutan", "Angka untuk urutan soal; jika kosong, soal diletakkan setelah soal yang sudah ada."]
  ]);
  guide["!cols"] = [{ wch: 24 }, { wch: 100 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, questions, "Soal");
  XLSX.utils.book_append_sheet(workbook, guide, "Panduan");
  XLSX.writeFile(workbook, "template_import_soal_cat_pai.xlsx");
}

async function importQuestionSpreadsheet(file, existingQuestions) {
  if (!file) return;
  if (!window.XLSX) { toast("Pustaka Excel gagal dimuat. Muat ulang halaman admin."); return; }
  if (file.size > 5 * 1024 * 1024) { toast("Ukuran file maksimal 5 MB."); return; }
  try {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = workbook.Sheets.Soal || workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
    if (!rows.length) throw new Error("Sheet Soal belum berisi data.");
    const normalized = value => String(value ?? "").trim().toLowerCase();
    const errors = [], payload = [];
    let nextPosition = (existingQuestions.at(-1)?.position ?? 0) + 1;
    rows.forEach((source, index) => {
      const row = Object.fromEntries(Object.entries(source).map(([k, v]) => [normalized(k), String(v ?? "").trim()]));
      if (!Object.values(row).some(Boolean)) return;
      const line = index + 2;
      const rawType = normalized(row["tipe"]);
      const type = ["pg", "pilihan ganda"].includes(rawType) ? "pg"
        : ["isian", "jawaban singkat"].includes(rawType) ? "isian" : "";
      const body = row["teks soal"] || "";
      const answer = row["kunci jawaban"] || "";
      const options = ["opsi a", "opsi b", "opsi c", "opsi d", "opsi e"].map(k => row[k] || "");
      while (options.length && !options.at(-1)) options.pop();
      const pointsText = row["bobot"];
      const points = pointsText ? Number(pointsText) : 1;
      const positionText = row["urutan"];
      const position = positionText ? Number(positionText) : nextPosition++;
      if (!type) errors.push(`Baris ${line}: Tipe harus pg atau isian.`);
      if (!body) errors.push(`Baris ${line}: Teks Soal wajib diisi.`);
      if (!answer) errors.push(`Baris ${line}: Kunci Jawaban wajib diisi.`);
      if (type === "pg" && (options.length < 2 || !/^[A-E]$/i.test(answer)))
        errors.push(`Baris ${line}: Pilihan ganda perlu minimal dua opsi dan kunci A–E.`);
      if (type === "pg" && /^[A-E]$/i.test(answer) && !options[answer.toUpperCase().charCodeAt(0) - 65])
        errors.push(`Baris ${line}: Opsi yang ditandai sebagai kunci belum diisi.`);
      if (!Number.isInteger(points) || points < 1) errors.push(`Baris ${line}: Bobot harus bilangan bulat minimal 1.`);
      if (!Number.isInteger(position) || position < 0) errors.push(`Baris ${line}: Urutan harus bilangan bulat 0 atau lebih.`);
      if (!type || !body || !answer || (type === "pg" && (options.length < 2 || !/^[A-E]$/i.test(answer))) ||
          !Number.isInteger(points) || points < 1 || !Number.isInteger(position) || position < 0) return;
      payload.push({ subject_id: selSubject, type, body, options: type === "pg" ? options : null,
        answer: type === "pg" ? answer.toUpperCase() : answer,
        explanation: row["pembahasan"] || null, points, position });
    });
    if (errors.length) throw new Error(errors.slice(0, 12).join("\n") + (errors.length > 12 ? `\n…dan ${errors.length - 12} kesalahan lain.` : ""));
    if (!payload.length) throw new Error("Tidak ada baris soal yang valid untuk diimpor.");
    const { error } = await sb.from("questions").insert(payload);
    if (error) throw error;
    toast(`${payload.length} soal berhasil diimpor.`); paneQuestions();
  } catch (error) {
    alert("Impor gagal: " + errMsg(error));
  } finally {
    const input = $("#import-file"); if (input) input.value = "";
  }
}

function questionForm(q = {}) {
  const isEdit = !!q.id;
  const opts = q.options || ["", "", "", ""];
  while (opts.length < 5) opts.push("");
  let type = q.type || "pg";

  $("#pane").innerHTML = `<div class="card" style="max-width:820px"><h2>${isEdit ? "Edit" : "Tambah"} Soal</h2>
    <div class="alert info small">Tempel teks Arab langsung (dari Al-Qur'an digital / Word). Baris yang berisi ayat otomatis tampil
    besar dan rata kanan. Teks Arab di tengah kalimat juga otomatis dirapikan.</div>
    <form id="qf">
      <div class="row"><div class="grow"><label>Tipe soal</label>
        <select id="ty"><option value="pg">Pilihan ganda</option><option value="isian">Jawaban singkat</option></select></div>
        <div style="width:110px"><label>Bobot</label><input type="number" id="pt" min="1" value="${q.points || 1}"></div>
        <div style="width:110px"><label>Urutan</label><input type="number" id="ps" value="${q.position ?? 0}"></div></div>
      <label>Teks soal</label><textarea id="bd" required style="min-height:130px" dir="auto">${esc(q.body || "")}</textarea>
      <div id="pgbox">
        <label>Pilihan jawaban (kosongkan E jika tidak dipakai)</label>
        ${LETTERS.map((L, i) => `<div class="row" style="margin:6px 0;flex-wrap:nowrap">
          <label class="check" style="margin:0"><input type="radio" name="key" value="${L}" ${q.answer === L ? "checked" : ""}> <b>${L}</b></label>
          <input type="text" class="op" dir="auto" value="${esc(opts[i])}" placeholder="Pilihan ${L}"></div>`).join("")}
        <div class="small muted">Pilih tombol bulat di samping huruf untuk menandai kunci jawaban.</div>
      </div>
      <div id="isbox" class="hidden"><label>Jawaban benar</label>
        <input type="text" id="ak" dir="auto" value="${esc(q.type === "isian" ? q.answer : "")}">
        <div class="small muted">Beberapa jawaban yang dianggap benar dipisahkan dengan tanda <b>|</b> (contoh: <code>puasa|puasa ramadan|shaum</code>).
        Huruf besar/kecil dan harakat Arab diabaikan.</div></div>
      <label>Pembahasan</label><textarea id="ex" dir="auto">${esc(q.explanation || "")}</textarea>
      <label>Pratinjau</label><div class="preview" id="pv"></div>
      <div class="row" style="margin-top:14px"><button class="primary">Simpan</button>
        ${isEdit ? "" : `<button type="button" id="sn">Simpan &amp; tambah lagi</button>`}
        <button type="button" id="cc">Batal</button></div>
    </form></div>`;

  const setType = () => {
    type = $("#ty").value;
    $("#pgbox").classList.toggle("hidden", type !== "pg");
    $("#isbox").classList.toggle("hidden", type !== "isian");
    preview();
  };
  const preview = () => {
    let h = rich($("#bd").value);
    if (type === "pg") h += $$(".op").map((o, i) => o.value.trim() ?
      `<div class="opt"><span class="ltr">${LETTERS[i]}</span><span class="txt">${richInline(o.value)}</span></div>` : "").join("");
    if ($("#ex").value.trim()) h += `<div class="explain"><b>Pembahasan</b>${rich($("#ex").value)}</div>`;
    $("#pv").innerHTML = h;
  };
  $("#ty").value = type; setType();
  $("#ty").onchange = setType;
  $("#qf").oninput = preview;
  $("#cc").onclick = paneQuestions;

  const save = async again => {
    const body = $("#bd").value.trim();
    let row = { subject_id: selSubject, type, body, explanation: $("#ex").value.trim() || null,
      points: Math.max(1, +$("#pt").value || 1), position: +$("#ps").value || 0 };
    if (type === "pg") {
      const o = $$(".op").map(i => i.value.trim());
      while (o.length && !o.at(-1)) o.pop();
      const key = ($("input[name=key]:checked") || {}).value;
      if (o.length < 2) return toast("Isi minimal 2 pilihan jawaban");
      if (!key || !o[LETTERS.indexOf(key)]) return toast("Tandai kunci jawaban yang pilihannya terisi");
      row.options = o; row.answer = key;
    } else {
      row.options = null; row.answer = $("#ak").value.trim();
      if (!row.answer) return toast("Isi jawaban benar");
    }
    const { error } = isEdit ? await sb.from("questions").update(row).eq("id", q.id) : await sb.from("questions").insert(row);
    if (error) return toast(errMsg(error));
    toast("Soal tersimpan");
    again ? questionForm({ type, position: row.position + 1 }) : paneQuestions();
  };
  $("#qf").onsubmit = e => { e.preventDefault(); save(false); };
  if ($("#sn")) $("#sn").onclick = () => $("#qf").reportValidity() && save(true);
}

// ===================== TAB HASIL =====================
async function paneResults() {
  const list = await loadSubjects();
  if (!list.length) { $("#pane").innerHTML = `<div class="card">Belum ada mata pelajaran.</div>`; return; }
  const { data: rows, error } = await sb.from("attempts").select("*")
    .eq("subject_id", selSubject).not("finished_at", "is", null).order("class_name").order("student_name");
  if (error) { toast(errMsg(error)); return; }
  const avg = rows.length ? (rows.reduce((a, r) => a + Number(r.score), 0) / rows.length).toFixed(1) : "-";
  const fmt = d => new Date(d).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });

  $("#pane").innerHTML = `<div class="card">
    <div class="row between"><div class="row">${subjectPicker(list)}
      <span class="muted small">${rows.length} peserta · rata-rata ${avg}</span></div>
      <button id="csv" ${rows.length ? "" : "disabled"}>Unduh CSV</button></div>
    <div class="tbl" style="margin-top:12px"><table><thead><tr><th>Nama</th><th>Kelas</th><th>Nilai</th><th>Benar</th><th>Selesai</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${esc(r.student_name)}</td><td>${esc(r.class_name)}</td><td><b>${Number(r.score)}</b></td>
      <td>${r.correct_count}/${r.total_questions}</td><td>${fmt(r.finished_at)}</td>
      <td><button class="sm danger" data-del="${r.id}">Hapus</button></td></tr>`).join("")
      || `<tr><td colspan="6" class="muted">Belum ada hasil.</td></tr>`}
    </tbody></table></div></div>`;
  $("#sp").onchange = e => { selSubject = e.target.value; paneResults(); };
  $("#pane").onclick = async e => {
    const id = e.target.dataset.del;
    if (id && confirm("Hapus hasil siswa ini? (Siswa bisa mengulang)")) {
      const { error } = await sb.from("attempts").delete().eq("id", id);
      error ? toast(errMsg(error)) : paneResults();
    }
  };
  $("#csv").onclick = () => {
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["Nama", "Kelas", "Nilai", "Benar", "Total Soal", "Selesai"].map(q).join(",")]
      .concat(rows.map(r => [r.student_name, r.class_name, r.score, r.correct_count, r.total_questions, fmt(r.finished_at)].map(q).join(",")));
    const name = (subjectsCache.find(s => s.id === selSubject)?.name || "hasil").replace(/[^\w-]+/g, "_");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `hasil_${name}.csv`; a.click();
  };
}

init();
