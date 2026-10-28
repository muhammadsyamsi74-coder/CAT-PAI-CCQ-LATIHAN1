# CAT PAI — Ujian Online (Pilihan Ganda & Jawaban Singkat)

Website statis (HTML/CSS/JS) yang di-host di **GitHub Pages**, dengan database **Supabase**.

- `index.html` — halaman siswa (isi nama & kelas, ujian, hasil, pembahasan)
- `admin.html` — halaman admin (mapel, soal, aktifkan ujian, hasil + unduh CSV)
- `supabase/schema.sql` — struktur database + aturan keamanan
- `supabase/contoh_soal.sql` — (opsional) contoh soal PAI dengan ayat Al-Qur'an

Kunci jawaban **tidak pernah dikirim ke browser siswa** selama ujian; penilaian dilakukan di server (Supabase).

---

## 1. Siapkan Supabase

1. Buat akun di https://supabase.com → **New project** (catat password database, boleh bebas).
2. Buka **Authentication → Users → Add user → Create new user**. Isi email & kata sandi admin
   (centang *Auto Confirm User*). Ini akun untuk login `admin.html`.
3. Buka **Authentication → Sign In / Providers** (atau *Settings*) lalu **matikan "Allow new users to sign up"**.
4. Buka **SQL Editor → New query**, salin isi `supabase/schema.sql`.
   **Ganti** `GANTI_DENGAN_EMAIL_ADMIN@contoh.com` (di bagian `admin_emails`) dengan email admin dari langkah 2, lalu **Run**.
   - Untuk beberapa admin, tambahkan baris email lagi: `insert into admin_emails values ('guru2@contoh.com');`
   - Jika user admin sudah dibuat tetapi login ditolak karena belum terdaftar, jalankan:
     `insert into public.admin_emails (email) values ('EMAIL_ADMIN_ANDA') on conflict (email) do nothing;`
5. (Opsional) jalankan `supabase/contoh_soal.sql` untuk mapel contoh.
6. Buka **Project Settings → API**, salin **Project URL** dan **anon / publishable key**.
7. Untuk fitur login peserta dan pembatasan nilai, jalankan juga `supabase/migration_student_access.sql` di SQL Editor.
   Migration ini aman dijalankan pada database aplikasi lama dan mendaftarkan empat peserta yang ditentukan.
8. Jalankan `supabase/migration_student_review.sql` agar siswa dapat membuka pembahasan dari baris nilai miliknya.
9. Jalankan `supabase/migration_subject_schedule.sql` untuk menambahkan jadwal mulai dan berakhir mata pelajaran.
   Jika migration jadwal sudah pernah dijalankan sebelumnya, jalankan juga `supabase/migration_activation_mode_required.sql`
   untuk menerapkan validasi rentang jadwal yang baru.

## 2. Isi konfigurasi

Edit `js/config.js`, isi `SUPABASE_URL` dan `SUPABASE_ANON_KEY` dari langkah 6.
(Key `anon` memang publik; yang melindungi data adalah aturan RLS di `schema.sql`.)

## 3. Coba di komputer

Jalankan server lokal di folder ini, misalnya:

```bash
npx serve .
```

lalu buka `http://localhost:3000` (siswa) dan `http://localhost:3000/admin.html` (admin).

## 4. Posting ke GitHub Pages

1. Buat repository baru di GitHub, unggah seluruh isi folder `cat-pai` (hasilnya `index.html` ada di root repo).
2. Repo → **Settings → Pages → Build and deployment**: *Deploy from a branch*, branch `main`, folder `/ (root)` → Save.
3. Tunggu ±1 menit. Alamat siswa: `https://USERNAME.github.io/NAMA-REPO/`, admin: `.../admin.html`.

## Cara pakai

**Admin:** Mata Pelajaran → tambah/edit mapel (durasi, acak soal, waktu mulai dan berakhir) → tab *Soal* → tambah soal.
Centang **Aktifkan mapel** dan atur tanggal/jam. Mapel akan otomatis terlihat dan dapat dimulai saat waktu mulai tercapai,
lalu otomatis tersembunyi/tidak dapat dimulai ketika waktu berakhir. Kosongkan mulai untuk aktif langsung, atau kosongkan
berakhir agar tidak ditutup otomatis. Saat mencentang status **Diujikan**, pilih salah satu: **tanggal/jam mulai dan batas akhir**
atau **Aktifkan dari sekarang — selamanya**. Mode jadwal memerlukan kedua waktu; database juga memvalidasi rentang tersebut.
Waktu ditafsirkan sesuai zona waktu lokal perangkat admin.
Tab *Hasil Siswa* menampilkan nilai per mapel dan bisa diunduh sebagai CSV (Excel).

**Impor soal Excel:** pada tab *Soal*, pilih mapel lalu klik **Unduh template Excel**. Isi sheet `Soal`
(satu soal per baris), simpan sebagai `.xlsx`, lalu klik **Impor Excel**. Kolom wajib: `Tipe`, `Teks Soal`,
`Kunci Jawaban`; kolom pilihan `Opsi A`–`Opsi E`, `Pembahasan`, `Bobot`, dan `Urutan` mengikuti petunjuk di sheet `Panduan`.

**Peserta:** masuk dengan nama terdaftar dan kata sandi bersama `1234`. Nilai yang ditampilkan dibatasi ke hasil
peserta tersebut dan hasil TIM CCA SMPN8. Tombol **Lihat pembahasan** tersedia pada nilai yang sudah selesai,
dan pembahasan hanya dapat dibuka untuk attempt milik akun peserta yang sedang masuk. Karena semua peserta memakai kata sandi yang sama, ini tidak dapat
mencegah peserta memilih nama orang lain; gunakan kata sandi unik per peserta bila perlu pemisahan identitas yang kuat.

**Menulis soal dengan ayat:** tempel teks Arab langsung ke kolom soal (dari Al-Qur'an digital / Word, harakat ikut).
Baris yang berisi ayat otomatis tampil besar, rata kanan, dengan font Amiri Quran. Ada pratinjau langsung di form.

**Jawaban singkat:** pisahkan beberapa jawaban benar dengan `|`. Huruf besar/kecil dan harakat diabaikan.

**Siswa:** isi nama & kelas → pilih mapel → kerjakan (ada timer, tanda ragu-ragu, navigasi nomor; jawaban tersimpan
sehingga aman bila halaman ter-refresh) → lihat nilai → *Lihat Pembahasan*.

## Catatan keamanan (sederhana)

- Admin hanya bisa login dengan akun Supabase **dan** emailnya terdaftar di `admin_emails`.
- Login peserta memakai satu kata sandi bersama untuk kemudahan; ini bukan autentikasi kuat terhadap pemalsuan nama.
- Link pembahasan memakai ID unik acak; tidak bisa ditebak.
