# Kirana Family Gallery — design
Interpretation: the "KIRANA FAMILY GALLERY" spec as an installable web app (PWA, works on iPhone),
hosted free on GitHub Pages, **no Supabase / no account**. Everything lives in IndexedDB on each
phone. Phone-to-phone sync is peer-to-peer (WebRTC via trystero; public Nostr relays only for the
encrypted handshake) inside a room derived from the family code. Last-write-wins per record
(updatedAt), tombstones for permanent deletes, images fetched on demand from whichever peer has
them. Backup files (.kfg) remain as manual fallback.

## Pitch
A private family photo album: everyone picks their profile, uploads photos, likes and
favourites each other's photos, browses a TikTok-style feed, albums and memories.

## Screens & flow
Member picker ("Siapa yang pakai HP ini?") → Feed. Bottom nav (mobile): Feed · Galeri · Album ·
Favorit · Lainnya. Sidebar (≥900px): all sections. "Lainnya" sheet: Kenangan, Arsip, Sampah,
Log, Statistik, Pengaturan, Kejutan (Surprise Me), Kunci Aplikasi.
Overlays: Viewer, Slideshow, Upload progress, Member editor, PIN lock, dialogs, sheets, toasts.
Back button: closes top overlay → selection mode → album detail → Feed → double press exits.

## Data (IndexedDB `kirana-gallery`)
- photos: id, name, desc, tags[], size, type, uploadedAt, takenAt, albumId, fav, likes, likedBy[],
  pinned, archived, deleted, deletedAt, rot, memberId, memberName, memberEmoji, viewedAt, w, h, hash
- blobs: id, blob (original), thumb (JPEG 0.82, max 500px)
- albums: id, name, coverId, createdAt · members: id, name, emoji, color, avatar, pass (sha256) · logs
- settings (Preferences): theme, accent, cols, private, pin, lockOnResume, sound, haptics, member

## Art direction
Dark default: bg #0a0a0f, surfaces #13131d/#1c1c2a, accent #7c5cff (user-pickable), light theme.
System font stack, 16–20px radii, soft shadows, 0.2s transitions, inline SVG sprite icons,
illustrated empty states in accent gradients.

## Audio
Subtle UI SFX (audio/sfx.json): tap, open, close, like, fav, success, delete, error, shutter
(upload), unlock, toggle. Slideshow music: calm, 76 bpm, seed 7. All toggleable.

## Save data
All in IndexedDB + Preferences; backup/restore .kfg (JSON with base64 images).
