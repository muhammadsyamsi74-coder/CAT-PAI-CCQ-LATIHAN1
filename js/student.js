// Aplikasi siswa: pilih mapel -> ujian -> hasil -> pembahasan
const app = $("#app");
const LS_SESSION = "cat_pai_session";
const LS_STUDENT = "cat_pai_student";

let S = null;      // sesi ujian aktif {attemptId, subjectId, name, cls, answers, flags, order, endTime}
let exam = null;   // {subject, questions} dari server
let cur = 0;
let timerId = null;
let homeRefreshId = null;

const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* abaikan */ } };
const lsDel = k => { try { localStorage.removeItem(k); } catch { /* abaikan */ } };
const saveSession = () => lsSet(LS_SESSION, S);
let STUDENT = lsGet(LS_STUDENT, null);
lsDel("cat_pai_history");

function header(sub) {
  return `<div class="brand"><div class="logo">☪</div>
    <div><h1>${esc(CONFIG.APP_NAME)}</h1><div class="muted small">${esc(sub || CONFIG.SCHOOL_NAME)}</div></div></div>`;
}

// pengacak deterministik agar urutan soal sama saat halaman dimuat ulang
function seededShuffle(arr, seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  const rnd = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const r = arr.slice();
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

// ===================== LOGIN PESERTA & BERANDA =====================
function showStudentLogin(msg = "") {
  app.innerHTML = header() + `<div class="card" style="max-width:440px;margin:24px auto">
    <h2>Masuk sebagai peserta</h2><p class="muted small">Pilih nama yang terdaftar dan masukkan kata sandi peserta.</p>
    <form id="student-login"><label for="student-name">Nama peserta</label>
      <select id="student-name" required>
        <option value="">Pilih nama</option><option>Putri Dania Oktaviana</option>
        <option>Zaila Elvina Khairani</option><option>Dila Ayu Zakiyah</option><option>TIM CCA SMPN8</option>
      </select>
      <label for="student-password">Kata sandi</label><input id="student-password" type="password" inputmode="numeric" required autocomplete="current-password">
      ${msg ? `<div class="alert err">${esc(msg)}</div>` : ""}
      <button class="primary" style="margin-top:14px;width:100%">Masuk</button></form></div>`;
  $("#student-login").onsubmit = async e => {
    e.preventDefault();
    const { data, error } = await sb.rpc("student_login", {
      p_name: $("#student-name").value, p_password: $("#student-password").value
    });
    if (error) {
      const needsMigration = /student_login|schema cache|function .* does not exist/i.test(error.message || "");
      return showStudentLogin(needsMigration
        ? "Database peserta belum disiapkan. Jalankan supabase/migration_student_access.sql di Supabase SQL Editor."
        : "Nama atau kata sandi tidak sesuai.");
    }
    STUDENT = data; lsSet(LS_STUDENT, STUDENT); showHome();
  };
}

async function showHome() {
  clearInterval(timerId);
  clearInterval(homeRefreshId);
  if (!configured) { app.innerHTML = header() + notConfiguredHTML(); return; }
  if (!STUDENT?.session_token) { showStudentLogin(); return; }
  app.innerHTML = header() + `<p class="muted center">Memuat daftar ujian…</p>`;

  const [{ data: subjects, error }, { data: scores, error: scoreError }] = await Promise.all([
    sb.from("subjects").select("id,name,description,duration_minutes").eq("is_active", true).order("name"),
    sb.rpc("get_student_scores", { p_session: STUDENT.session_token })
  ]);
  if (scoreError) {
    STUDENT = null; lsDel(LS_STUDENT); showStudentLogin("Sesi peserta tidak berlaku. Silakan masuk kembali."); return;
  }
  if (error) { app.innerHTML = header() + `<div class="alert err">${esc(errMsg(error))}</div>`; return; }

  const saved = lsGet(LS_SESSION, null);
  if (saved && !saved.studentId) lsDel(LS_SESSION);
  const canResume = saved && saved.studentId === STUDENT.participant_id;
  let chosen = subjects.length === 1 ? subjects[0].id : null;
  app.innerHTML = header() + `
    <div class="row between"><p class="small muted">Peserta: <b>${esc(STUDENT.name)}</b> · Kelas ${esc(STUDENT.class_name)}</p>
      <button class="sm" id="student-logout">Keluar</button></div>
    ${canResume ? `<div class="card" style="border-color:var(--warn)"><b>Ujian belum selesai</b>
      <p class="small">${esc(saved.name)} (${esc(saved.cls)}) — ${esc(saved.subjectName || "")}</p>
      <div class="row"><button class="primary" id="resume">Lanjutkan ujian</button>
      <button id="discard" class="danger sm">Batalkan</button></div></div>` : ""}
    <div class="card"><h2>Mulai Ujian</h2>
      <p>Nama: <b>${esc(STUDENT.name)}</b> · Kelas: <b>${esc(STUDENT.class_name)}</b></p>
      <label>Pilih mata pelajaran</label>
      <div id="subjs">${subjects.length ? subjects.map(s => `<button class="subj ${s.id === chosen ? "sel" : ""}" data-id="${s.id}">
        <b>${esc(s.name)}</b><span class="muted small">${s.duration_minutes} menit${s.description ? " · " + esc(s.description) : ""}</span></button>`).join("")
        : `<div class="alert info">Belum ada ujian yang diaktifkan. Hubungi pengawas.</div>`}</div>
      <div id="msg"></div><button class="primary" id="start" style="margin-top:12px" ${subjects.length ? "" : "disabled"}>Mulai Ujian</button>
    </div><div class="card"><h3>Nilai peserta</h3>${renderStudentScores(scores || [])}</div>`;

  $("#student-logout").onclick = () => {
    if (canResume && !confirm("Keluar? Ujian yang belum selesai tidak dapat dilanjutkan dari akun lain.")) return;
    STUDENT = null; lsDel(LS_STUDENT); lsDel(LS_SESSION); showStudentLogin();
  };
  $("#subjs").addEventListener("click", e => {
    const b = e.target.closest(".subj"); if (!b) return;
    chosen = b.dataset.id; $$(".subj").forEach(x => x.classList.toggle("sel", x === b));
  });
  $("#start").onclick = async () => {
    const msg = $("#msg");
    if (!chosen) { msg.innerHTML = `<div class="alert err">Pilih mata pelajaran dulu.</div>`; return; }
    $("#start").disabled = true;
    try { await startExam(chosen); }
    catch (e) { msg.innerHTML = `<div class="alert err">${esc(errMsg(e))}</div>`; $("#start").disabled = false; }
  };
  if (canResume) {
    $("#resume").onclick = async () => {
      S = saved;
      try { await loadExam(S.subjectId); cur = 0; renderExam(); }
      catch (e) { alert(errMsg(e) + "\nSesi dibatalkan."); lsDel(LS_SESSION); S = null; showHome(); }
    };
    $("#discard").onclick = () => { if (confirm("Batalkan ujian yang belum selesai?")) { lsDel(LS_SESSION); showHome(); } };
  }
  app.querySelectorAll("[data-score-review]").forEach(b => b.onclick = () => showReview(b.dataset.scoreReview));
  homeRefreshId = setInterval(() => { if (!S) showHome(); }, 60000);
}

function renderStudentScores(rows) {
  if (!rows.length) return `<p class="muted">Belum ada nilai tersimpan.</p>`;
  const fmt = d => new Date(d).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
  return `<div class="tbl"><table><thead><tr><th>Peserta</th><th>Mapel</th><th>Nilai</th><th>Selesai</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${esc(r.is_team ? "TIM CCA SMPN8" : STUDENT.name)}</td><td>${esc(r.subject_name)}</td>
      <td><b>${Number(r.score)}</b></td><td>${fmt(r.finished_at)}</td><td>${!r.is_team || STUDENT.is_team
        ? `<button class="sm" data-score-review="${esc(r.attempt_id)}">Lihat pembahasan</button>` : ""}</td></tr>`).join("")}
    </tbody></table></div>`;
}
// ===================== MULAI & MUAT UJIAN =====================
async function loadExam(subjectId) {
  const { data, error } = await sb.rpc("get_exam", { p_subject: subjectId });
  if (error) throw error;
  exam = data;
}

async function startExam(subjectId) {
  clearInterval(homeRefreshId);
  const { data: attemptId, error } = await sb.rpc("start_attempt", {
    p_subject: subjectId, p_session: STUDENT.session_token
  });
  if (error) throw error;
  await loadExam(subjectId);
  if (!exam.questions.length) throw new Error("Mapel ini belum memiliki soal.");
  let order = exam.questions.map(q => q.id);
  if (exam.subject.shuffle_questions) order = seededShuffle(order, attemptId);
  S = {
    attemptId, subjectId, studentId: STUDENT.participant_id, name: STUDENT.name,
    cls: STUDENT.class_name, subjectName: exam.subject.name,
    answers: {}, flags: {}, order,
    endTime: Date.now() + exam.subject.duration_minutes * 60000
  };
  saveSession();
  cur = 0;
  renderExam();
}

// ===================== TAMPILAN UJIAN =====================
const qById = id => exam.questions.find(q => q.id === id);

function renderExam() {
  app.innerHTML = `
    <div class="exam-top"><div class="exam-bar">
      <div><b>${esc(exam.subject.name)}</b><div class="small muted">${esc(S.name)} · ${esc(S.cls)}</div></div>
      <div class="timer" id="timer">--:--</div>
    </div></div>
    <div class="card" id="qcard"></div>
    <div class="card"><div class="row between"><b>Navigasi soal</b>
      <span class="small muted" id="stat"></span></div>
      <div class="nav-grid" id="grid" style="margin-top:10px"></div></div>
    <div class="center"><button class="primary" id="finish">Selesai &amp; Kirim Jawaban</button></div>`;
  $("#finish").onclick = () => finishExam(false);
  $("#grid").onclick = e => { const b = e.target.closest("button"); if (b) { cur = +b.dataset.i; drawQuestion(); } };
  tick(); clearInterval(timerId); timerId = setInterval(tick, 1000);
  drawQuestion();
}

function tick() {
  const left = Math.max(0, Math.round((S.endTime - Date.now()) / 1000));
  const t = $("#timer"); if (!t) return;
  const m = Math.floor(left / 60), s = left % 60;
  t.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  t.classList.toggle("low", left <= 300);
  if (left <= 0) { clearInterval(timerId); finishExam(true); }
}

function drawQuestion() {
  const id = S.order[cur], q = qById(id), total = S.order.length;
  const ans = S.answers[id] ?? "";
  let input;
  if (q.type === "pg") {
    input = (q.options || []).map((o, i) => `
      <button class="opt ${ans === LETTERS[i] ? "sel" : ""}" data-l="${LETTERS[i]}">
        <span class="ltr">${LETTERS[i]}</span><span class="txt">${richInline(o)}</span></button>`).join("");
  } else {
    input = `<label for="isi">Jawaban singkat</label>
      <input type="text" id="isi" dir="auto" autocomplete="off" value="${esc(ans)}" placeholder="Ketik jawaban Anda">`;
  }
  $("#qcard").innerHTML = `
    <div class="row between"><span class="qno">Soal ${cur + 1} dari ${total}</span>
      <label class="check" style="margin:0"><input type="checkbox" id="flag" ${S.flags[id] ? "checked" : ""}> Ragu-ragu</label></div>
    <div class="qbody">${rich(q.body)}</div>
    <div id="inp">${input}</div>
    <div class="row between" style="margin-top:18px">
      <button id="prev" ${cur === 0 ? "disabled" : ""}>← Sebelumnya</button>
      <button id="next" class="primary" ${cur === total - 1 ? "disabled" : ""}>Berikutnya →</button>
    </div>`;
  $("#prev").onclick = () => { cur--; drawQuestion(); };
  $("#next").onclick = () => { cur++; drawQuestion(); };
  $("#flag").onchange = e => { S.flags[id] = e.target.checked; saveSession(); drawGrid(); };
  if (q.type === "pg") {
    $("#inp").onclick = e => {
      const b = e.target.closest(".opt"); if (!b) return;
      S.answers[id] = b.dataset.l; saveSession();
      $$(".opt", $("#inp")).forEach(x => x.classList.toggle("sel", x === b));
      drawGrid();
    };
  } else {
    $("#isi").oninput = e => { S.answers[id] = e.target.value; saveSession(); drawGrid(); };
  }
  drawGrid();
  window.scrollTo({ top: 0 });
}

function isAnswered(id) { return String(S.answers[id] ?? "").trim() !== ""; }

function drawGrid() {
  $("#grid").innerHTML = S.order.map((id, i) =>
    `<button data-i="${i}" class="${S.flags[id] ? "flag" : isAnswered(id) ? "done" : ""} ${i === cur ? "now" : ""}">${i + 1}</button>`).join("");
  const n = S.order.filter(isAnswered).length;
  $("#stat").textContent = `Terjawab ${n} / ${S.order.length}`;
}

// ===================== KIRIM JAWABAN =====================
async function finishExam(auto) {
  if (!auto) {
    const blank = S.order.filter(id => !isAnswered(id)).length;
    const flagged = S.order.filter(id => S.flags[id]).length;
    let m = "Kirim jawaban sekarang?";
    if (blank) m += `\n• ${blank} soal belum dijawab`;
    if (flagged) m += `\n• ${flagged} soal masih ditandai ragu-ragu`;
    if (!confirm(m)) return;
  } else {
    alert("Waktu habis. Jawaban Anda akan dikirim otomatis.");
  }
  clearInterval(timerId);
  const btn = $("#finish"); if (btn) { btn.disabled = true; btn.textContent = "Mengirim…"; }
  try {
    const { data, error } = await sb.rpc("submit_attempt", {
      p_attempt: S.attemptId, p_answers: S.answers, p_session: STUDENT.session_token
    });
    if (error) throw error;
    lsDel(LS_SESSION);
    showResult(data, exam.subject.name);
    S = null;
  } catch (e) {
    alert("Gagal mengirim: " + errMsg(e) + "\nPeriksa koneksi lalu coba lagi. Jawaban Anda tetap tersimpan.");
    if (btn) { btn.disabled = false; btn.textContent = "Selesai & Kirim Jawaban"; }
  }
}

function showResult(r, subjectName) {
  window.scrollTo({ top: 0 });
  app.innerHTML = header() + `
    <div class="card center">
      <div class="muted">${esc(subjectName)}</div>
      <h2>Ujian selesai, jazakumullahu khairan!</h2>
      <div class="score">${Number(r.score)}</div>
      <p class="muted">Benar ${r.correct} dari ${r.total} soal</p>
      <div class="row" style="justify-content:center">
        <button class="primary" id="rv">Lihat Pembahasan</button>
        <button id="home">Kembali ke Beranda</button></div>
    </div>`;
  $("#rv").onclick = () => showReview(r.attempt_id);
  $("#home").onclick = showHome;
}

// ===================== PEMBAHASAN =====================
async function showReview(attemptId) {
  app.innerHTML = header() + `<p class="center muted">Memuat pembahasan…</p>`;
  const { data, error } = await sb.rpc("get_review", {
    p_attempt: attemptId, p_session: STUDENT.session_token
  });
  if (error) {
    app.innerHTML = header() + `<div class="alert err">${esc(errMsg(error))}</div><button id="home">Kembali</button>`;
    $("#home").onclick = showHome; return;
  }
  const a = data.attempt, qs = data.questions;
  let filter = "all";

  const draw = () => {
    const list = qs.map((q, i) => ({ q, i })).filter(({ q }) =>
      filter === "all" || (filter === "ok" ? q.is_correct : !q.is_correct));
    $("#rvlist").innerHTML = list.map(({ q, i }) => reviewCard(q, i)).join("") || `<p class="muted center">Tidak ada soal.</p>`;
  };

  app.innerHTML = header("Pembahasan") + `
    <div class="card"><div class="row between">
      <div><b>${esc(a.subject_name)}</b><div class="small muted">${esc(a.student_name)} · ${esc(a.class_name)}</div></div>
      <div class="center"><div class="score" style="font-size:2.4rem">${Number(a.score)}</div>
        <div class="small muted">${a.correct}/${a.total} benar</div></div></div>
      <div class="row" style="margin-top:12px">
        <button class="sm primary" data-f="all">Semua</button>
        <button class="sm" data-f="ok">Benar</button>
        <button class="sm" data-f="bad">Salah/Kosong</button>
        <button class="sm" id="home" style="margin-left:auto">← Beranda</button></div></div>
    <div id="rvlist"></div>`;
  $("#home").onclick = showHome;
  $$("[data-f]").forEach(b => b.onclick = () => {
    filter = b.dataset.f;
    $$("[data-f]").forEach(x => x.classList.toggle("primary", x === b));
    draw();
  });
  draw();
}

function reviewCard(q, i) {
  let body;
  if (q.type === "pg") {
    body = (q.options || []).map((o, k) => {
      const L = LETTERS[k], isKey = L === q.answer.toUpperCase(), isMine = L === q.student_answer;
      const cls = isKey ? "key" : isMine ? "wrong" : "";
      const tag = isKey ? ' <span class="badge ok">Kunci</span>' : isMine ? ' <span class="badge bad">Jawabanmu</span>' : "";
      return `<div class="opt ${cls}"><span class="ltr">${L}</span><span class="txt">${richInline(o)}${tag}</span></div>`;
    }).join("");
    if (!q.student_answer) body += `<p class="small muted">Kamu tidak menjawab soal ini.</p>`;
  } else {
    const keys = q.answer.split("|").map(s => s.trim()).filter(Boolean);
    body = `<div class="ans-line">Jawabanmu: <b>${q.student_answer ? richInline(q.student_answer) : "<i>(kosong)</i>"}</b></div>
            <div class="ans-line">Jawaban benar: <b>${keys.map(richInline).join(" / ")}</b></div>`;
  }
  return `<div class="card rv ${q.is_correct ? "ok" : "bad"}">
    <div class="row between"><span class="qno">Soal ${i + 1}</span>
      <span class="badge ${q.is_correct ? "ok" : "bad"}">${q.is_correct ? "Benar" : "Salah"}</span></div>
    <div class="qbody">${rich(q.body)}</div>${body}
    <div class="explain"><b>Pembahasan</b>${q.explanation ? rich(q.explanation) : '<span class="muted">Belum ada pembahasan.</span>'}</div>
  </div>`;
}

// Cegah tertutup tidak sengaja saat ujian
window.addEventListener("beforeunload", e => { if (S && exam) { e.preventDefault(); e.returnValue = ""; } });

showHome();
