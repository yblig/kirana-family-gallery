# Kirana Family Gallery

Galeri foto keluarga — web app (bisa dipasang di iPhone & Android), **gratis, tanpa server, tanpa akun**.

**Buka:** https://yblig.github.io/kirana-family-gallery/

## Pasang di iPhone
1. Buka link di **Safari** (bukan Chrome / browser dalam WhatsApp).
2. Ketuk tombol **Bagikan** (kotak dengan panah ke atas).
3. Pilih **Add to Home Screen / Tambah ke Layar Utama** → **Tambah**.

Android (Chrome): menu ⋮ → **Instal aplikasi**.

## Sinkron antar HP keluarga
- Setiap keluarga punya **kode keluarga** (contoh `AB12-CD34`), lihat di *Lainnya → Sinkron*.
- Ketuk **Kirim link ke keluarga** lalu kirim ke Bapak/Mama lewat WhatsApp. Saat mereka membuka link itu, HP-nya otomatis bergabung.
- Foto, album, profil, suka/favorit, dan log otomatis terkirim **langsung antar HP** (peer-to-peer WebRTC, terenkripsi dengan kode keluarga) **saat HP sama-sama membuka aplikasi**. Paling cepat di Wi-Fi yang sama.
- Setiap HP menyimpan salinan lengkap di perangkatnya sendiri, jadi tetap bisa dibuka tanpa internet.
- Cadangan manual tetap ada: *Pengaturan → Ekspor / Kirim ke HP lain / Impor cadangan (.kfg)*.

> Catatan: aplikasi web di iPhone tidak bisa berjalan di latar belakang, jadi sinkron terjadi ketika aplikasi dibuka. Untuk menyimpan foto ke app **Foto** iPhone: ketuk **Simpan** → **Simpan Gambar**.

## Fitur
Foto **dan video** (sampai 1 GB per video, putar otomatis di feed, kontrol video di penampil, ikut sinkron & slideshow), feed ala TikTok (layar penuh, tidak terpotong), galeri 2/3/4/6 kolom, cari/sort/filter tanggal & anggota, pilih banyak + aksi massal, album + cover, favorit + slideshow bermusik, kenangan (hari ini tahun lalu, dll.), arsip, sampah (otomatis 30 hari) + urungkan, statistik + leaderboard, log aktivitas per anggota, penampil foto (swipe, zoom cubit/ketuk 2x, putar, bagikan, salin, unduh, ekspor metadata), profil anggota (emoji, warna, foto, password), PIN aplikasi, mode privat, scan duplikat, tema gelap/terang + warna aksen bebas, pintasan keyboard.

## Pengembangan
```bash
npm install
npm run dev     # server lokal
npm run build   # hasil di dist/
```
Setiap push ke `main` otomatis di-deploy ke GitHub Pages (`.github/workflows/pages.yml`).
