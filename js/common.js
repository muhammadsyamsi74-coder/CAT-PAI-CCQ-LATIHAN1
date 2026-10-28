// Fungsi bersama untuk halaman siswa & admin
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const configured = !/GANTI/.test(CONFIG.SUPABASE_URL + CONFIG.SUPABASE_ANON_KEY);
const sb = configured
  ? window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY)
  : null;

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- Teks Arab: dideteksi otomatis, tidak perlu tag khusus ----
const AR = "\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF";
const AR_RUN = new RegExp(`[${AR}]+(?:[\\s\\u200c\\u200d]+[${AR}]+)*`, "g");
const AR_CH = new RegExp(`[${AR}]`, "g");
const LAT_CH = /[A-Za-z0-9]/g;

// Ubah teks soal jadi HTML. Baris yang dominan Arab => blok ayat besar & rata kanan.
function rich(text) {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  const out = lines.map(line => {
    if (!line.trim()) return '<div class="line">&nbsp;</div>';
    const ar = (line.match(AR_CH) || []).length;
    const lat = (line.match(LAT_CH) || []).length;
    const e = esc(line);
    if (ar > 0 && ar >= lat * 2) return `<div class="ayat" lang="ar" dir="rtl">${e}</div>`;
    return `<div class="line">${e.replace(AR_RUN, m => `<span class="arab" lang="ar" dir="rtl">${m}</span>`)}</div>`;
  });
  return `<div class="rich">${out.join("")}</div>`;
}

// Versi satu baris (untuk opsi jawaban)
function richInline(text) {
  return esc(text).replace(AR_RUN, m => `<span class="arab" lang="ar" dir="rtl">${m}</span>`);
}

function toast(msg, ms = 2500) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function errMsg(e) {
  const m = (e && (e.message || e.error_description)) || String(e);
  const map = {
    mapel_tidak_aktif: "Mapel ini tidak sedang diujikan.",
    nama_kelas_kosong: "Nama dan kelas wajib diisi.",
    belum_selesai: "Ujian belum selesai / data tidak ditemukan.",
    pembahasan_dimatikan: "Pembahasan untuk mapel ini tidak ditampilkan oleh admin."
  };
  for (const k in map) if (m.includes(k)) return map[k];
  return m;
}

function notConfiguredHTML() {
  return `<div class="card"><h2>Konfigurasi belum diisi</h2>
    <p>Buka file <code>js/config.js</code> lalu isi <code>SUPABASE_URL</code> dan
    <code>SUPABASE_ANON_KEY</code> dari Supabase (Project Settings &rarr; API).</p></div>`;
}

const LETTERS = ["A", "B", "C", "D", "E"];
