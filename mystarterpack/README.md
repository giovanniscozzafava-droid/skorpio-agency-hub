# MyStarterPack.it

**Le 5 cose per iniziare. Punto.** — Per ogni attività umana, i cinque prodotti giusti per partire (link affiliati Amazon.it) + un reel in motion graphics pubblicato ogni giorno in automatico su Instagram. Progetto autonomo di Fuyue Digital Agency.

| Cartella | Cosa c'è |
|---|---|
| `site/` | Blog Astro statico (Vercel). Pack in `src/content/packs/`, 15 categorie, ricerca, RSS, sitemap, JSON-LD, disclosure affiliazione. |
| `pipeline/` | Generazione pack (Gemini), immagini prodotto, voce (Gemini 2.5 TTS), reel 1080×1920 (Chromium + ffmpeg), pubblicazione Instagram (Graph API), orchestratore giornaliero, coda argomenti. |
| `brand/` | Brand book e loghi SVG. |
| `docs/` | `WRITER-BRIEF.md` regole editoriali · `SETUP.md` chiavi e account · `TEAM.md` ruoli, rituali, escalation. |
| `.claude/agents/` | Il team di agenti (capo redazione, scout, copywriter, video, social, SEO, brand). |
| `CLAUDE.md` | Istruzioni operative per gli agenti. |

Automazione: `.github/workflows/mystarterpack-daily.yml` (root del repo).

```bash
cd mystarterpack/site && npm ci && npm run dev          # sito in locale
cd mystarterpack/pipeline && npm ci && node render-video.mjs escursionismo --silent   # reel di prova senza API
```
