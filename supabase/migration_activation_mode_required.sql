-- Aturan masa aktif mapel: rentang waktu harus lengkap, atau tanpa batas.
-- Jalankan satu kali jika migration_subject_schedule.sql sudah pernah dijalankan.

update public.subjects set is_active = false, scheduled_start = null, scheduled_end = null
 where (scheduled_start is null) <> (scheduled_end is null)
    or (scheduled_start is not null and scheduled_end is not null and scheduled_end <= scheduled_start);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'subjects_schedule_range_check') then
    alter table public.subjects add constraint subjects_schedule_range_check check (
      (scheduled_start is null and scheduled_end is null)
      or (scheduled_start is not null and scheduled_end is not null and scheduled_end > scheduled_start)
    );
  end if;
end $$;
