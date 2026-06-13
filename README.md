# K STREAM

K STREAM adalah website streaming statis dengan katalog Supabase, player modern, rating pengguna, komentar, history tontonan, dan panel admin tersembunyi.

## Fitur

- Homepage gelap sesuai referensi: hero, pencarian, kategori genre, lanjut menonton, dan kartu koleksi
- Player Abyssplayer, MP4, MPEG-DASH, HLS, dan YouTube
- Rating pengguna 1-5, komentar, history, serta resume posisi video
- Panel admin untuk CRUD judul dan episode
- Fallback lokal saat tabel atau izin Supabase belum siap
- PWA melalui `manifest.json` dan `sw.js`

## Menjalankan lokal

Jalankan server dari folder proyek:

```powershell
php -S localhost:8080
```

Buka `http://localhost:8080`.

## Konfigurasi Supabase

URL dan publishable/anon key berada di:

```text
js/config.js
```

Jangan pernah menaruh `service_role` key di file frontend.

### Setup database

1. Buka Supabase SQL Editor.
2. Jalankan seluruh isi `database/setup.sql`.
3. Buka Authentication > Providers.
4. Aktifkan **Anonymous Sign-Ins**.

Anonymous session digunakan untuk rating, komentar, dan operasi cloud setelah login admin demo.

## Perilaku fallback

- Katalog utama dibaca dari tabel `drakor`.
- Rating dibaca dari `drakor_ratings` dan view `drakor_rating_summary`.
- Komentar dibaca dari `drakor_comments`.
- Jika rating atau komentar belum tersedia, data disimpan di browser.
- Jika admin belum dapat menulis ke Supabase, perubahan disimpan sebagai draft lokal dan tetap muncul di homepage serta player pada perangkat yang sama.

## Skema episode

Kolom `episodes` pada tabel `drakor` berisi array JSON:

```json
[
  {
    "epsName": "Episode 01",
    "videoUrl": "https://example.com/video.mp4",
    "linkStatus": "Active"
  }
]
```
Test web
```https://fauu-11.github.io/drakor-ku/index.html```

## Catatan keamanan

Login admin adalah gerbang demo di browser dan dapat dilihat dari source code. Untuk deployment publik, gunakan Supabase Auth dengan role admin atau backend/Edge Function yang memverifikasi akses sebelum CRUD katalog.
