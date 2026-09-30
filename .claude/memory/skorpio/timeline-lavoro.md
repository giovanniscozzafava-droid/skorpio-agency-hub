---
title: Timeline del lavoro: pianificatore nel DB, catena Giovanni → Alberto → Elisa → ragazzi
tags: [skorpio, consegne, alberto, pianificatore, presenze]
importance: alta
updated: 2026-09-30
---
Costruita il 30/09/2026 (dettagli in `docs/timeline-lavoro.md` di skorpio-agency-hub, sorgenti in `supabase/functions/consegne` e migrazioni `20260930*`).

- **Catena decisa da Giovanni**: Giovanni dà i compiti ad Alberto, Alberto li passa a Elisa ("Da smistare"), Elisa li dispensa ad Alessandro e Luca. `consegne_assegna` lo impone: chi non è Elisa (config `motore.config.consegne_smistatore`) e chiede lavoro per altri crea un task «Da smistare» per lei, con la verifica già fatta.
- **Il pianificatore è uno solo e sta in SQL** (`consegne_piazza` / `consegne_pianifica_task` / `consegne_riordina`): lo usano consegne (anche i progetti), Alberto (RPC) e il trigger sul task. Non farne un secondo in TypeScript.
- Blocchi legati al task con `calendario.blocco_task_id`, NON `task_id` (quello è il marcatore di scadenza di `sync_task_to_calendario`: toccarlo sposta la scadenza).
- **Trappola**: il deploy di edge function dal cloud non raggiunge skorpiov3; i sorgenti deployati il 30/09 vivono in skorpio-agency-hub finché qualcuno non li porta.
- **Trappola**: al 30/09 l'API Anthropic di Supabase aveva credito esaurito, quindi l'Alberto di riserva (alberto-api) non risponde. Il Banco sul Mac risponde ma ha il vecchio `albertoWhatsapp.mjs` senza gli strumenti del lavoro. Gate pronto: `motore.config.alberto_banco_versione_minima` (vuoto = Banco prende tutto).
- `consegne_invii` ha unicità solo per gli invii periodici (settimana, rossa, giornata, sera, promemoria_timbra, timbratura_avvio).
- Stefano non ha né numero WhatsApp né email in team: non riceve niente.
