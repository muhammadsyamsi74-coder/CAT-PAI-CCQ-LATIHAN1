-- Jalankan satu kali di Supabase Dashboard > SQL Editor setelah aplikasi lama berjalan.
-- Membuat login peserta, mengikat attempt ke peserta, serta membatasi akses nilai.

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  class_name text not null,
  is_team boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.participants (name, class_name, is_team) values
  ('Putri Dania Oktaviana', '7.5', false),
  ('Zaila Elvina Khairani', '7.7', false),
  ('Dila Ayu Zakiyah', '9.11', false),
  ('TIM CCA SMPN8', 'SMPN 8', true)
on conflict (name) do update set class_name = excluded.class_name, is_team = excluded.is_team;

create table if not exists public.student_sessions (
  token uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now()
);

alter table public.attempts add column if not exists participant_id uuid references public.participants(id) on delete set null;
update public.attempts a set participant_id = p.id
from public.participants p
where a.participant_id is null
  and replace(lower(btrim(a.student_name)), ' ', '') = replace(lower(p.name), ' ', '');

alter table public.participants enable row level security;
alter table public.student_sessions enable row level security;
-- Tidak ada policy publik: data peserta/sesi hanya diakses fungsi SECURITY DEFINER.

create or replace function public.student_login(p_name text, p_password text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p participants; new_token uuid;
begin
  if p_password is distinct from '1234' then raise exception 'login_gagal'; end if;
  select * into p from participants where lower(name) = lower(btrim(coalesce(p_name, '')));
  if not found then raise exception 'login_gagal'; end if;
  insert into student_sessions (participant_id) values (p.id) returning token into new_token;
  return jsonb_build_object('session_token', new_token, 'participant_id', p.id,
    'name', p.name, 'class_name', p.class_name, 'is_team', p.is_team);
end $$;

create or replace function public.get_student_scores(p_session uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p participants; result jsonb;
begin
  select pt.* into p from student_sessions ss join participants pt on pt.id = ss.participant_id
    where ss.token = p_session and ss.expires_at > now();
  if not found then raise exception 'sesi_tidak_berlaku'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'attempt_id', a.id, 'subject_name', s.name, 'score', a.score,
    'finished_at', a.finished_at, 'is_team', pt.is_team
  ) order by a.finished_at desc), '[]'::jsonb) into result
  from attempts a join participants pt on pt.id = a.participant_id
  join subjects s on s.id = a.subject_id
  where a.finished_at is not null and (pt.id = p.id or pt.is_team);
  return result;
end $$;

-- Ganti RPC lama yang menerima nama/kelas bebas dari browser.
drop function if exists public.start_attempt(uuid, text, text);
create or replace function public.start_attempt(p_subject uuid, p_session uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare p participants; new_id uuid;
begin
  select pt.* into p from student_sessions ss join participants pt on pt.id = ss.participant_id
    where ss.token = p_session and ss.expires_at > now();
  if not found then raise exception 'sesi_tidak_berlaku'; end if;
  if not exists (select 1 from subjects where id = p_subject and is_active) then
    raise exception 'mapel_tidak_aktif';
  end if;
  insert into attempts (subject_id, participant_id, student_name, class_name)
  values (p_subject, p.id, p.name, p.class_name) returning id into new_id;
  return new_id;
end $$;

drop function if exists public.submit_attempt(uuid, jsonb);
create or replace function public.submit_attempt(p_attempt uuid, p_answers jsonb, p_session uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a attempts; p participants; q questions; earned numeric := 0; total numeric := 0;
        ok int := 0; n int := 0; sc numeric;
begin
  select pt.* into p from student_sessions ss join participants pt on pt.id = ss.participant_id
    where ss.token = p_session and ss.expires_at > now();
  if not found then raise exception 'sesi_tidak_berlaku'; end if;
  select * into a from attempts where id = p_attempt and participant_id = p.id;
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
    score = sc, correct_count = ok, total_questions = n where id = a.id;
  return jsonb_build_object('attempt_id', a.id, 'score', sc, 'correct', ok, 'total', n);
end $$;

drop function if exists public.get_review(uuid);
create or replace function public.get_review(p_attempt uuid, p_session uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a attempts; s subjects; p participants; items jsonb;
begin
  select pt.* into p from student_sessions ss join participants pt on pt.id = ss.participant_id
    where ss.token = p_session and ss.expires_at > now();
  if not found then raise exception 'sesi_tidak_berlaku'; end if;
  select * into a from attempts where id = p_attempt and participant_id = p.id and finished_at is not null;
  if not found then raise exception 'hasil_tidak_dapat_diakses'; end if;
  select * into s from subjects where id = a.subject_id;
  if not s.show_review then raise exception 'pembahasan_dimatikan'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'type', q.type, 'body', q.body, 'options', q.options,
    'answer', q.answer, 'explanation', q.explanation, 'points', q.points,
    'student_answer', a.answers ->> q.id::text,
    'is_correct', check_answer(q.type, q.answer, a.answers ->> q.id::text)
  ) order by q.position, q.created_at), '[]'::jsonb) into items
  from questions q where q.subject_id = a.subject_id;
  return jsonb_build_object(
    'attempt', jsonb_build_object('id', a.id, 'student_name', a.student_name,
      'class_name', a.class_name, 'score', a.score, 'correct', a.correct_count,
      'total', a.total_questions, 'subject_name', s.name), 'questions', items);
end $$;

revoke all on function public.student_login(text, text) from public;
revoke all on function public.get_student_scores(uuid) from public;
revoke all on function public.start_attempt(uuid, uuid) from public;
revoke all on function public.submit_attempt(uuid, jsonb, uuid) from public;
revoke all on function public.get_review(uuid, uuid) from public;
grant execute on function public.student_login(text, text) to anon, authenticated;
grant execute on function public.get_student_scores(uuid) to anon, authenticated;
grant execute on function public.start_attempt(uuid, uuid) to anon, authenticated;
grant execute on function public.submit_attempt(uuid, jsonb, uuid) to anon, authenticated;
grant execute on function public.get_review(uuid, uuid) to anon, authenticated;

-- Catatan admin: daftarkan email login yang benar dengan query terpisah di README.
