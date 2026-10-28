-- Opsional: contoh mapel + soal PAI untuk uji coba (jalankan SETELAH schema.sql)
with s as (
  insert into subjects (name, description, duration_minutes, is_active)
  values ('PAI - Contoh Soal', 'Mapel contoh untuk uji coba aplikasi', 30, true)
  returning id
)
insert into questions (subject_id, type, body, options, answer, explanation, position)
select s.id, v.type, v.body, v.options::jsonb, v.answer, v.explanation, v.pos from s,
(values
 ('pg',
  E'Perhatikan ayat berikut!\n\nقُلْ هُوَ اللَّهُ أَحَدٌ\n\nAyat tersebut adalah awal dari surah ....',
  '["Al-Ikhlas","Al-Falaq","An-Nas","Al-Kautsar"]', 'A',
  E'Ayat tersebut adalah QS. Al-Ikhlas ayat 1 yang artinya "Katakanlah (Muhammad), Dialah Allah, Yang Maha Esa."', 1),
 ('pg',
  E'يَا أَيُّهَا الَّذِينَ آمَنُوا كُتِبَ عَلَيْكُمُ الصِّيَامُ كَمَا كُتِبَ عَلَى الَّذِينَ مِنْ قَبْلِكُمْ لَعَلَّكُمْ تَتَّقُونَ\n\nTujuan akhir berpuasa berdasarkan ayat di atas adalah ....',
  '["Menjadi kaya","Menjadi orang yang bertakwa","Menjadi sehat","Menjadi pandai"]', 'B',
  E'QS. Al-Baqarah ayat 183 ditutup dengan lafal لَعَلَّكُمْ تَتَّقُونَ yang berarti "agar kamu bertakwa".', 2),
 ('pg',
  E'Arti dari lafal وَالْعَصْرِ pada QS. Al-Asr ayat 1 adalah ....',
  '["Demi waktu Dhuha","Demi malam","Demi masa","Demi matahari"]', 'C',
  E'وَالْعَصْرِ berarti "Demi masa". Allah bersumpah dengan masa untuk menegaskan pentingnya memanfaatkan waktu.', 3),
 ('isian',
  E'Rukun Islam yang ke-4 adalah ....',
  null, 'puasa|puasa ramadan|puasa ramadhan|shaum|shiyam',
  E'Urutan rukun Islam: syahadat, salat, zakat, puasa Ramadan, dan haji bagi yang mampu.', 4),
 ('isian',
  E'Jika nun mati atau tanwin bertemu huruf ba (ب), maka hukum bacaannya disebut ....',
  null, 'iqlab',
  E'Nun mati/tanwin bertemu ba dibaca iqlab: nun diubah menjadi bunyi mim dengan dengung.', 5)
) as v(type, body, options, answer, explanation, pos);
