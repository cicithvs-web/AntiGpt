# AI Chat (Claude-style UI)

UI chat mobile-first bergaya Claude, dibuat dengan React + Vite.

## Menjalankan secara lokal

```bash
npm install
npm run dev
```

Buka alamat yang muncul di terminal (default `http://localhost:5173`).

## Build untuk production

```bash
npm run build
```

Hasil build ada di folder `dist/`. Untuk preview hasil build:

```bash
npm run preview
```

## Struktur

- `src/App.jsx` — komponen utama & state chat
- `src/App.css` — seluruh styling (termasuk animasi ripple, bottom sheet, textarea auto-grow)
- `src/components/` — komponen UI (input, drawer, pesan, dsb.)
- `src/hooks/` — custom hooks
- `src/services/` — integrasi API
- `src/data/` — data statis
