-- Aturan masa aktif mapel: rentang waktu harus lengkap, atau tanpa batas.
-- Dapat dijalankan sendiri pada database yang sudah memiliki tabel public.subjects.

alter table public.subjects
  add column if not exists scheduled_start timestamptz,
  add column if not exists scheduled_end timestamptz;

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
