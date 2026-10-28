-- Jalankan di Supabase SQL Editor untuk mengaktifkan tombol pembahasan pada nilai peserta.
-- Aman dijalankan setelah migration_student_access.sql.
-- Setiap peserta tetap hanya dapat membuka pembahasan attempt miliknya sendiri.

create or replace function public.get_review(p_attempt uuid, p_session uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a attempts; s subjects; p participants; items jsonb;
begin
  select pt.* into p from student_sessions ss join participants pt on pt.id = ss.participant_id
    where ss.token = p_session and ss.expires_at > now();
  if not found then raise exception 'sesi_tidak_berlaku'; end if;

  select * into a from attempts
   where id = p_attempt and participant_id = p.id and finished_at is not null;
  if not found then raise exception 'hasil_tidak_dapat_diakses'; end if;

  select * into s from subjects where id = a.subject_id;
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
      'total', a.total_questions, 'subject_name', s.name),
    'questions', items);
end $$;

revoke all on function public.get_review(uuid, uuid) from public;
grant execute on function public.get_review(uuid, uuid) to anon, authenticated;
