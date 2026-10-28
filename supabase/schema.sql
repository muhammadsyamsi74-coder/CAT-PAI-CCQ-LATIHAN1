-- =====================================================================
--  CAT PAI - Skema database Supabase
--  Jalankan seluruh isi file ini di: Supabase > SQL Editor > New query > Run
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- TABEL ----------------------------------------------------

create table if not exists subjects (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  description      text,
  duration_minutes int  not null default 60,
  shuffle_questions boolean not null default false,
  show_review      boolean not null default true,   -- siswa boleh lihat pembahasan?
  is_active        boolean not null default false,  -- sedang diujikan?
  created_at       timestamptz not null default now()
);

create table if not exists questions (
  id          uuid primary key default gen_random_uuid(),
  subject_id  uuid not null references subjects(id) on delete cascade,
  type        text not null check (type in ('pg','isian')),
  body        text not null,
  options     jsonb,            -- pg: ["opsi A","opsi B",...]
  answer      text not null,    -- pg: huruf "A".."E" | isian: jawaban benar, pisahkan dengan |
  explanation text,
  points      int  not null default 1,
  position    int  not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists questions_subject_idx on questions(subject_id, position);

create table if not exists attempts (
  id              uuid primary key default gen_random_uuid(),
  subject_id      uuid not null references subjects(id) on delete cascade,
  student_name    text not null,
  class_name      text not null,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  answers         jsonb not null default '{}'::jsonb,
  score           numeric,
  correct_count   int,
  total_questions int
);
create index if not exists attempts_subject_idx on attempts(subject_id, finished_at);

-- Daftar email admin (hanya email di sini yang boleh mengelola data)
create table if not exists admin_emails (
  email text primary key
);

-- !!! GANTI dengan email admin yang Anda daftarkan di Authentication > Users !!!
insert into admin_emails (email) values ('GANTI_DENGAN_EMAIL_ADMIN@contoh.com')
on conflict do nothing;

-- ---------- FUNGSI BANTU --------------------------------------------

create or replace function is_admin() returns boolean
language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from admin_emails
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- Normalisasi teks jawaban singkat: huruf kecil, tanpa harakat, spasi rapi
create or replace function norm_text(t text) returns text
language sql immutable as $$
  select btrim(lower(regexp_replace(
           regexp_replace(coalesce(t, ''), '[ً-ٰٟـ]', '', 'g'),
           '\s+', ' ', 'g')));
$$;

create or replace function check_answer(p_type text, p_key text, p_ans text) returns boolean
language plpgsql immutable as $$
declare k text;
begin
  if p_ans is null or btrim(p_ans) = '' then return false; end if;
  if p_type = 'pg' then
    return upper(btrim(p_ans)) = upper(btrim(p_key));
  end if;
  foreach k in array string_to_array(p_key, '|') loop
    if norm_text(k) <> '' and norm_text(k) = norm_text(p_ans) then return true; end if;
  end loop;
  return false;
end $$;

-- ---------- RLS ------------------------------------------------------

alter table subjects     enable row level security;
alter table questions    enable row level security;
alter table attempts     enable row level security;
alter table admin_emails enable row level security;

-- Siswa (anon) hanya boleh melihat daftar mapel yang aktif
drop policy if exists subjects_public_read on subjects;
create policy subjects_public_read on subjects for select to anon, authenticated
  using (is_active or is_admin());

drop policy if exists subjects_admin on subjects;
create policy subjects_admin on subjects for all to authenticated
  using (is_admin()) with check (is_admin());

-- Soal & hasil: hanya admin. Siswa mengakses lewat fungsi RPC di bawah.
drop policy if exists questions_admin on questions;
create policy questions_admin on questions for all to authenticated
  using (is_admin()) with check (is_admin());

drop policy if exists attempts_admin on attempts;
create policy attempts_admin on attempts for all to authenticated
  using (is_admin()) with check (is_admin());

-- ---------- RPC UNTUK SISWA -----------------------------------------

-- Ambil soal ujian TANPA kunci jawaban
create or replace function get_exam(p_subject uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s subjects; qs jsonb;
begin
  select * into s from subjects where id = p_subject and is_active;
  if not found then raise exception 'mapel_tidak_aktif'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'type', q.type, 'body', q.body,
           'options', q.options, 'points', q.points
         ) order by q.position, q.created_at), '[]'::jsonb)
    into qs from questions q where q.subject_id = s.id;
  return jsonb_build_object(
    'subject', jsonb_build_object('id', s.id, 'name', s.name,
               'duration_minutes', s.duration_minutes,
               'shuffle_questions', s.shuffle_questions),
    'questions', qs);
end $$;

create or replace function start_attempt(p_subject uuid, p_name text, p_class text) returns uuid
language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if btrim(coalesce(p_name,'')) = '' or btrim(coalesce(p_class,'')) = '' then
    raise exception 'nama_kelas_kosong';
  end if;
  if not exists (select 1 from subjects where id = p_subject and is_active) then
    raise exception 'mapel_tidak_aktif';
  end if;
  insert into attempts (subject_id, student_name, class_name)
  values (p_subject, left(btrim(p_name), 100), left(btrim(p_class), 30))
  returning id into new_id;
  return new_id;
end $$;

-- Kirim jawaban & nilai otomatis. p_answers = {"<id soal>": "A" | "teks"}
create or replace function submit_attempt(p_attempt uuid, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a attempts; q questions; earned numeric := 0; total numeric := 0;
        ok int := 0; n int := 0; sc numeric;
begin
  select * into a from attempts where id = p_attempt;
  if not found then raise exception 'attempt_tidak_ada'; end if;
  if a.finished_at is not null then
    return jsonb_build_object('attempt_id', a.id, 'score', a.score,
             'correct', a.correct_count, 'total', a.total_questions);
  end if;
  for q in select * from questions where subject_id = a.subject_id loop
    n := n + 1; total := total + q.points;
    if check_answer(q.type, q.answer, p_answers ->> q.id::text) then
      ok := ok + 1; earned := earned + q.points;
    end if;
  end loop;
  sc := case when total = 0 then 0 else round(earned / total * 100, 2) end;
  update attempts set answers = coalesce(p_answers, '{}'::jsonb), finished_at = now(),
         score = sc, correct_count = ok, total_questions = n
   where id = a.id;
  return jsonb_build_object('attempt_id', a.id, 'score', sc, 'correct', ok, 'total', n);
end $$;

-- Pembahasan: hanya untuk attempt yang sudah selesai & mapel mengizinkan
create or replace function get_review(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a attempts; s subjects; items jsonb;
begin
  select * into a from attempts where id = p_attempt and finished_at is not null;
  if not found then raise exception 'belum_selesai'; end if;
  select * into s from subjects where id = a.subject_id;
  if not s.show_review then raise exception 'pembahasan_dimatikan'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'type', q.type, 'body', q.body, 'options', q.options,
           'answer', q.answer, 'explanation', q.explanation, 'points', q.points,
           'student_answer', a.answers ->> q.id::text,
           'is_correct', check_answer(q.type, q.answer, a.answers ->> q.id::text)
         ) order by q.position, q.created_at), '[]'::jsonb)
    into items from questions q where q.subject_id = a.subject_id;
  return jsonb_build_object(
    'attempt', jsonb_build_object('id', a.id, 'student_name', a.student_name,
               'class_name', a.class_name, 'score', a.score,
               'correct', a.correct_count, 'total', a.total_questions,
               'subject_name', s.name),
    'questions', items);
end $$;

grant execute on function get_exam(uuid)                 to anon, authenticated;
grant execute on function start_attempt(uuid,text,text)  to anon, authenticated;
grant execute on function submit_attempt(uuid,jsonb)     to anon, authenticated;
grant execute on function get_review(uuid)               to anon, authenticated;
