// Aplikasi siswa: pilih mapel -> ujian -> hasil -> pembahasan
const app = $("#app");
const LS_SESSION = "cat_pai_session";
const LS_HISTORY = "cat_pai_history";

let S = null;      // sesi ujian aktif {attemptId, subjectId, name, cls, answers, flags, order, endTime}
let exam = null;   // {subject, questions} dari server
let cur = 0;
let timerId = null;

const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* abaikan */ } };
const lsDel = k => { try { localStorage.removeItem(k); } catch { /* abaikan */ } };
const saveSession = () => lsSet(LS_SESSION, S);

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

// ===================== BERANDA =====================
async function showHome() {
  clearInterval(timerId);
  if (!configured) { app.innerHTML = header() + notConfiguredHTML(); return; }
  app.innerHTML = header() + `<p class="muted center">Memuat daftar ujian…</p>`;

  const { data: subjects, error } = await sb.from("subjects")
    .select("id,name,description,duration_minutes").eq("is_active", true).order("name");
  if (error) { app.innerHTML = header() + `<div class="alert err">${esc(errMsg(error))}</div>`; return; }

  const saved = lsGet(LS_SESSION, null);
  const history = lsGet(LS_HISTORY, []);
  let chosen = subjects.length === 1 ? subjects[0].id : null;

  app.innerHTML = header() + `
    ${saved ? `<div class="card" style="border-color:var(--warn)">
        <b>Ujian belum selesai</b>
        <p class="small">${esc(saved.name)} (${esc(saved.cls)}) — ${esc(saved.subjectName || "")}</p>
        <div class="row"><button class="primary" id="resume">Lanjutkan ujian</button>
        <button id="discard" class="danger sm">Batalkan</button></div></div>` : ""}
    <div class="card">
      <h2>Mulai Ujian</h2>
      <label for="nm">Nama lengkap</label>
      <input type="text" id="nm" autocomplete="off" placeholder="Nama sesuai absen">
      <label for="kl">Kelas</label>
      <input type="text" id="kl" autocomplete="off" placeholder="Contoh: 9A">
      <label>Pilih mata pelajaran</label>
      <div id="subjs">${subjects.length ? subjects.map(s => `
        <button class="subj ${s.id === chosen ? "sel" : ""}" data-id="${s.id}">
          <b>${esc(s.name)}</b>
          <span class="muted small">${s.duration_minutes} menit${s.description ? " · " + esc(s.description) : ""}</span>
        </button>`).join("")
        : `<div class="alert info">Belum ada ujian yang diaktifkan. Hubungi pengawas.</div>`}</div>
      <div id="msg"></div>
      <button class="primary" id="start" style="margin-top:12px" ${subjects.length ? "" : "disabled"}>Mulai Ujian</button>
    </div>
    ${history.length ? `<div class="card"><h3>Riwayat di perangkat ini</h3>
      ${history.map((h, i) => `<div class="row between" style="padding:6px 0;border-top:1px solid var(--line)">
        <div><b>${esc(h.subjectName)}</b><div class="small muted">${esc(h.name)} · ${esc(h.date)}</div></div>
        <div class="row"><b>${h.score}</b><button class="sm" data-rv="${i}">Lihat hasil</button></div></div>`).join("")}
    </div>` : ""}`;

  $("#subjs").addEventListener("click", e => {
    const b = e.target.closest(".subj"); if (!b) return;
    chosen = b.dataset.id;
    $$(".subj").forEach(x => x.classList.toggle("sel", x === b));
  });
  $("#start").onclick = async () => {
    const name = $("#nm").value.trim(), cls = $("#kl").value.trim();
    const msg = $("#msg");
    if (!name || !cls) { msg.innerHTML = `<div class="alert err">Nama dan kelas wajib diisi.</div>`; return; }
    if (!chosen) { msg.innerHTML = `<div class="alert err">Pilih mata pelajaran dulu.</div>`; return; }
    $("#start").disabled = true;
    try { await startExam(chosen, name, cls); }
    catch (e) { msg.innerHTML = `<div class="alert err">${esc(errMsg(e))}</div>`; $("#start").disabled = false; }
  };
  if (saved) {
    $("#resume").onclick = async () => {
      S = saved;
      try { await loadExam(S.subjectId); cur = 0; renderExam(); }
      catch (e) { alert(errMsg(e) + "\nSesi dibatalkan."); lsDel(LS_SESSION); S = null; showHome(); }
    };
    $("#discard").onclick = () => { if (confirm("Batalkan ujian yang belum selesai?")) { lsDel(LS_SESSION); showHome(); } };
  }
  $$("[data-rv]").forEach(b => b.onclick = () => showReview(history[b.dataset.rv].attemptId));
}

// ===================== MULAI & MUAT UJIAN =====================
async function loadExam(subjectId) {
  const { data, error } = await sb.rpc("get_exam", { p_subject: subjectId });
  if (error) throw error;
  exam = data;
}

async function startExam(subjectId, name, cls) {
  const { data: attemptId, error } = await sb.rpc("start_attempt", { p_subject: subjectId, p_name: name, p_class: cls });
  if (error) throw error;
  await loadExam(subjectId);
  if (!exam.questions.length) throw new Error("Mapel ini belum memiliki soal.");
  let order = exam.questions.map(q => q.id);
  if (exam.subject.shuffle_questions) order = seededShuffle(order, attemptId);
  S = {
    attemptId, subjectId, name, cls, subjectName: exam.subject.name,
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
    const { data, error } = await sb.rpc("submit_attempt", { p_attempt: S.attemptId, p_answers: S.answers });
    if (error) throw error;
    const hist = lsGet(LS_HISTORY, []);
    hist.unshift({ attemptId: S.attemptId, subjectName: S.subjectName, name: S.name, score: data.score,
      date: new Date().toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) });
    lsSet(LS_HISTORY, hist.slice(0, 20));
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
  const { data, error } = await sb.rpc("get_review", { p_attempt: attemptId });
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
