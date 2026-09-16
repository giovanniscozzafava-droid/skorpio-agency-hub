# MyStarterPack.it — istruzioni per il team di agenti

Progetto editoriale autonomo di **Fuyue Digital Agency**: per ogni attività umana, i **5 prodotti per iniziare** (link affiliati Amazon.it) + un **reel in motion graphics** pubblicato in automatico su Instagram.
Riporta a: **CFO/Amministratore Fuyue** (Giovanni Scozzafava). Il team opera in autonomia entro le regole di questo file; escalation solo per i casi in `docs/TEAM.md § Escalation`.

## Mappa
- `site/` — blog Astro (statico, Vercel). Pack in `site/src/content/packs/*.md`, schema in `site/src/content.config.ts`, categorie in `site/src/data/categories.json`.
- `pipeline/` — `generate-pack.mjs` (Gemini testo) → `product-image.mjs` (PNG) → `tts.mjs` (Gemini 2.5 TTS) → `render-video.mjs` (Chromium + ffmpeg, 1080×1920) → `publish-instagram.mjs` (Graph API). `daily.mjs` li orchestra; `topics.json` è la coda.
- `brand/` — `BRAND-BOOK.md` e loghi. Il brand è vincolante per ogni output (sito, reel, caption).
- `docs/` — `STRATEGY.md` (mercato, posizionamento, modello economico, SEO/AEO/GEO, piano marketing, KPI: è la bussola), `WRITER-BRIEF.md` (regole editoriali), `SETUP.md` (chiavi e account), `TEAM.md` (ruoli e rituali).
- `.claude/agents/` — i ruoli del team. La CEO (`msp-ceo`) guida strategia e KPI; il capo redazione (`msp-editor-in-chief`) coordina i contenuti; `msp-head-of-search` la visibilità; `msp-growth-marketer` la distribuzione.
- Automazione: `.github/workflows/mystarterpack-daily.yml` (root del repo) esegue `daily.mjs` ogni mattina.

## Regole non negoziabili
1. Un pack = esattamente 5 prodotti, uno per esigenza. Prodotti reali e reperibili su amazon.it. **Mai inventare ASIN**: `asin: ""` finché non arriva da PA-API o verifica manuale.
2. Ogni pagina e ogni caption dichiarano l'affiliazione (`#adv #affiliazione`, `rel="sponsored"`). Mai rimuoverla.
3. Niente promesse mediche, di sicurezza o di guadagno. Salute, bambini, animali: tono prudente, rimando a professionisti.
4. Il testo per la voce (`video.script`) non contiene cifre: numeri in lettere.
5. Prima di ogni commit: `cd site && npm run build` deve passare. Il validatore è `pipeline/lib/packs.mjs → validatePack`.
6. Non cambiare brand, dominio, tag affiliato o struttura dello schema senza escalation al CFO.
7. Segreti solo in variabili d'ambiente / GitHub Secrets. Mai nel repo.

## Comandi
```bash
cd mystarterpack/site && npm ci && npm run build            # sito
cd mystarterpack/pipeline && npm ci
node generate-pack.mjs --topic "Apicoltura" --category giardino-faidate
node render-video.mjs <slug> [--silent]                      # --silent: senza TTS (test)
node publish-instagram.mjs <slug> [--dry-run]
node daily.mjs [--no-publish]                                # ciclo completo
node doctor.mjs [--live]                                     # cosa è configurato e cosa manca (--live prova le API)
node import-voice.mjs <slug> voce.mp3                        # voce prodotta altrove: ricava i tempi e monta il reel
```
