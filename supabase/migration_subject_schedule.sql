-- Jadwalkan waktu mulai/akhir mata pelajaran.
-- Jalankan setelah migration_student_access.sql di Supabase SQL Editor.
-- Status efektif dihitung server-side saat dibaca/dimulai: tanpa cron/job tambahan.

alter table public.subjects
  add column if not exists scheduled_start timestamptz,
  add column if not exists scheduled_end timestamptz;

-- Peserta hanya dapat melihat mapel yang diaktifkan admin dan sedang berada dalam rentang jadwal.
drop policy if exists subjects_public_read on public.subjects;
create policy subjects_public_read on public.subjects for select to anon, authenticated
  using (
    is_admin()
    or (
      is_active
      and (scheduled_start is null or now() >= scheduled_start)
      and (scheduled_end is null or now() < scheduled_end)
    )
  );

-- Ambil soal tanpa jawaban; validasi jadwal dilakukan di database agar tidak bisa dilewati browser.
create or replace function public.get_exam(p_subject uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s subjects; qs jsonb;
begin
  select * into s from subjects
   where id = p_subject and is_active
     and (scheduled_start is null or now() >= scheduled_start)
     and (scheduled_end is null or now() < scheduled_end);
  if not found then raise exception 'mapel_tidak_aktif'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'type', q.type, 'body', q.body, 'options', q.options, 'points', q.points
  ) order by q.position, q.created_at), '[]'::jsonb)
    into qs from questions q where q.subject_id = s.id;
  return jsonb_build_object(
    'subject', jsonb_build_object('id', s.id, 'name', s.name,
      'duration_minutes', s.duration_minutes, 'shuffle_questions', s.shuffle_questions),
    'questions', qs);
end $$;

-- Pertahankan pemeriksaan sesi dan identitas peserta dari migration_student_access.sql.
create or replace function public.start_attempt(p_subject uuid, p_session uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare p participants; s subjects; new_id uuid;
begin
  select pt.* into p from student_sessions ss join participants pt on pt.id = ss.participant_id
    where ss.token = p_session and ss.expires_at > now();
  if not found then raise exception 'sesi_tidak_berlaku'; end if;

  select * into s from subjects
   where id = p_subject and is_active
     and (scheduled_start is null or now() >= scheduled_start)
     and (scheduled_end is null or now() < scheduled_end);
  if not found then raise exception 'mapel_tidak_aktif'; end if;

  insert into attempts (subject_id, participant_id, student_name, class_name)
  values (s.id, p.id, p.name, p.class_name) returning id into new_id;
  return new_id;
end $$;

revoke all on function public.get_exam(uuid) from public;
revoke all on function public.start_attempt(uuid, uuid) from public;
grant execute on function public.get_exam(uuid) to anon, authenticated;
grant execute on function public.start_attempt(uuid, uuid) to anon, authenticated;
