# Setup operativo — chiavi, account, connettori

Tutto ciò che serve perché il progetto giri da solo. Le voci con 👤 richiedono un'azione umana una tantum (account, verifiche, pagamenti): un agente non può farle.

## 1. Dominio e hosting
- 👤 **mystarterpack.it** è su Aruba. Puntare il DNS a Vercel: record `A` `76.76.21.21` per la root e `CNAME` `cname.vercel-dns.com` per `www`.
- 👤 **Vercel** (la creazione del progetto richiede permessi da owner del team, non concessi al connettore): nuovo progetto `mystarterpack` collegato a questo repo, *Root Directory* = `mystarterpack/site`, framework Astro (rilevato da `vercel.json`). Env: `PUBLIC_AMAZON_TAG` (vedi §2). Il sito si ricostruisce a ogni push su `main`.

## 2. Amazon Associates (affiliazione)
- 👤 Iscrizione su https://programma-affiliazione.amazon.it con il sito mystarterpack.it e il profilo Instagram. Il tag ha la forma `nome-21`.
- Impostare il tag in: Vercel env `PUBLIC_AMAZON_TAG`, GitHub *Variables* `AMAZON_TAG`. Default nel codice: `mystarterpack-21` (da sostituire con quello reale).
- Entro 180 giorni servono 3 vendite qualificate, altrimenti l'account viene chiuso: per questo i reel partono subito.
- **PA-API 5** (immagini ufficiali, prezzi, ASIN) si sblocca dopo le prime vendite: a quel punto aggiungere `AMAZON_PAAPI_KEY/SECRET` e uno script `pipeline/enrich-paapi.mjs` che riempie `asin` e `image` (previsto, non ancora scritto).

## 3. Gemini (testo, voce, immagini)
- 👤 Chiave da https://aistudio.google.com/apikey (progetto Google Cloud Fuyue, con fatturazione attiva per il TTS).
- Secret GitHub `GEMINI_API_KEY`. Modelli (sovrascrivibili via env): `GEMINI_TEXT_MODEL=gemini-2.5-pro`, `GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts` (fallback `gemini-2.5-pro-preview-tts`), `GEMINI_IMAGE_MODEL=gemini-2.5-flash-image`.
- Voci: `Kore` (default), `Puck` (categorie energiche). Altre disponibili: Aoede, Charon, Fenrir, Leda, Orus, Zephyr. Cambiare con `TTS_VOICE`.
- Costo indicativo per reel: < 0,10 € (testo + 7 clip audio + 5 immagini).

## 4. Instagram (pubblicazione automatica)
Instagram non permette di creare account via API: la creazione è manuale, poi tutto il resto è automatico.
1. 👤 Creare l'account **@mystarterpack.it** (email dedicata, es. social@mystarterpack.it), avatar `brand/logo/mark.svg` esportato in PNG 1080×1080, bio dal brand book §7. Impostarlo come **account Business** (o Creator).
2. 👤 Creare una Pagina Facebook "MyStarterPack" e collegarla all'account Instagram (Impostazioni → Account collegati).
3. 👤 Su https://developers.facebook.com creare un'app tipo *Business*, aggiungere il prodotto **Instagram Graph API**. Con *Graph API Explorer* generare un token utente con i permessi `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `business_management`; scambiarlo con un **long-lived token** (60 giorni):
   `GET https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=TOKEN`
4. Ricavare l'`IG_USER_ID`: `GET /me/accounts` → id della pagina → `GET /{page-id}?fields=instagram_business_account`.
5. Secret GitHub: `IG_USER_ID`, `IG_ACCESS_TOKEN`. Il token scade ogni 60 giorni: rinnovarlo (stessa chiamata di scambio) oppure passare l'app in *Live* con *App Review* per il permesso `instagram_content_publish` e usare un System User token senza scadenza.
6. Hosting video: l'API richiede un URL pubblico del MP4. La pipeline lo carica nel bucket Supabase `mystarterpack` (creato da sola, pubblico). Secret: `MSP_SUPABASE_URL`, `MSP_SUPABASE_SERVICE_ROLE_KEY` (si può usare il progetto Supabase di Skorpio o uno dedicato). In alternativa `VIDEO_PUBLIC_URL`.
7. Limite Meta: 25 pubblicazioni API/giorno. Noi ne facciamo 1.

Test manuale: `node publish-instagram.mjs escursionismo --dry-run` (solo caption), poi senza `--dry-run`.

## 5. TikTok e YouTube Shorts (fase 2)
- **TikTok**: Content Posting API richiede app approvata su developers.tiktok.com (audit ~1-2 settimane). In attesa, il connettore Higgsfield `tiktok_publish` disponibile nell'ambiente Claude può pubblicare lo stesso MP4.
- **YouTube Shorts**: YouTube Data API v3 `videos.insert` con OAuth del canale; quota 10.000 unità/giorno (1 upload = 1.600). Da aggiungere come `pipeline/publish-youtube.mjs`.

## 6. GitHub Actions
Workflow `.github/workflows/mystarterpack-daily.yml`: ogni giorno alle 08:00 (Italia) genera un pack, il reel e pubblica; committa su `main`. Secrets richiesti: `GEMINI_API_KEY`, `IG_USER_ID`, `IG_ACCESS_TOKEN`, `MSP_SUPABASE_URL`, `MSP_SUPABASE_SERVICE_ROLE_KEY`. Variabile: `AMAZON_TAG`. Senza `IG_ACCESS_TOKEN` il workflow genera e renderizza ma non pubblica (reel salvato come artifact).
Avvio manuale: *Actions → MyStarterPack → Run workflow* (opzionale: slug di un pack esistente).

## 6b. IndexNow (Bing, ChatGPT Search, Copilot)
- Generare una chiave (32 caratteri esadecimali, es. `openssl rand -hex 16`), metterla nel secret GitHub `INDEXNOW_KEY` e creare il file `site/public/<KEY>.txt` con dentro la chiave (`cd pipeline && INDEXNOW_KEY=... node indexnow.mjs --write-key`). Nessuna registrazione necessaria.

## 6c. Tag affiliato per canale (attribuzione)
- In Amazon Associates creare gli ID di tracciamento `mystarterpack-ig-21`, `-tt-21`, `-yt-21`, `-pin-21`, `-nl-21` (Gestisci ID di tracciamento). Impostarli come variabili `AMAZON_TAG_IG`, `AMAZON_TAG_TT`, `AMAZON_TAG_YT`, `AMAZON_TAG_PIN`, `AMAZON_TAG_NL` (GitHub Variables e Vercel env con prefisso `PUBLIC_`). Così i report Amazon dicono quale canale vende.

## 6d. Account social (stesso handle ovunque: mystarterpack.it o mystarterpack)
- 👤 TikTok, YouTube (canale "MyStarterPack"), Pinterest Business (con dominio verificato), Facebook Page. Avatar `brand/logo/mark.svg` in PNG 1080×1080, bio dal brand book §7. Servono per il cross-posting della sezione 7 di `docs/STRATEGY.md`.
- 👤 Amazon Influencer Program (`programma-affiliazione.amazon.it/influencers`) appena un account supera i 1.000 follower: storefront + Creator Connections.

## 7. Email, newsletter e dominio
- `ciao@`, `privacy@`, `social@mystarterpack.it` su Aruba o su Resend (connettore già disponibile in Skorpio) per le comunicazioni.
- 👤 Newsletter "Il pack della settimana": dominio `mystarterpack.it` verificato su Resend (record DNS forniti da Resend), chiave API nel secret `RESEND_API_KEY` e come env Vercel; il modulo di iscrizione del sito e l'invio settimanale usano quella chiave.

## Checklist di attivazione (in ordine)
1. Vercel project + DNS → sito online
2. Amazon Associates → tag reale
3. Gemini key → workflow genera pack e reel (senza pubblicare)
4. Instagram Business + app Meta → token → pubblicazione automatica
5. (fase 2) TikTok / YouTube
