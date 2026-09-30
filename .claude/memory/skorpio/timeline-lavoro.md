---
title: Timeline del lavoro: pianificatore nel DB, catena Giovanni → Alberto → calendario → Elisa vidima → ragazzi
tags: [skorpio, consegne, alberto, pianificatore, presenze, vidima]
importance: alta
updated: 2026-09-30
---
Costruita il 30/09/2026 (dettagli in `docs/timeline-lavoro.md` di skorpio-agency-hub, sorgenti in `supabase/functions/consegne` e migrazioni `20260930*`).

- **Funnel deciso da Giovanni (30/09, seconda versione)**: la sera (lun-ven 18:30, cron `consegne-chiedi-compiti`) Alberto chiede a Giovanni su WhatsApp i lavori del giorno dopo; Giovanni li scrive anche quando vuole. Alberto li mette SUBITO in calendario e Kanban (`consegne_proponi`) con `task.vidimato = false`: il ragazzo non riceve niente. Elisa riceve il messaggio e vidima (`consegne_vidima`, anche «tutti»), sposta (`consegne_sposta`) o riassegna (`consegne_riassegna`). Solo alla vidima il ragazzo riceve WhatsApp+email. Il vecchio passaggio «Da smistare» (`consegne_smista`) resta solo per i compiti già creati così.
- Chi vidima: `motore.config.consegne_smistatore` (Elisa) o un Admin. Lavoro chiesto da Elisa = diretto e già vidimato.
- `consegne_avvisa` non manda `avvisa_lavoro` per task non vidimati (GUC `consegne.da_vidimare` durante la creazione).
- **Il pianificatore è uno solo e sta in SQL** (`consegne_piazza` / `consegne_pianifica_task` / `consegne_riordina`): lo usano consegne, Alberto (RPC) e il trigger sul task. Non farne un secondo in TypeScript.
- Blocchi legati al task con `calendario.blocco_task_id`, NON `task_id` (quello è il marcatore di scadenza di `sync_task_to_calendario`).
- Task Fatto: blocchi futuri tolti, blocco in corso chiuso adesso e Completato. Archiviato: idem ma Annullato.
- Ore timbrate (`presenze` entrata/turno, anche entrata aperta) riducono le ore libere di oggi (`consegne_ore_timbrate`).
- **Trappola**: il deploy di edge function dal cloud non raggiunge skorpiov3; i sorgenti deployati il 30/09 vivono in skorpio-agency-hub finché qualcuno non li porta.
- **Trappola**: al 30/09 l'API Anthropic di Supabase aveva credito esaurito, quindi l'Alberto di riserva (alberto-api) non risponde. Il Banco sul Mac risponde ma ha il vecchio `albertoWhatsapp.mjs` senza gli strumenti del lavoro (assegna_lavoro, vidima, riassegna, sposta_consegna, giornata_di). Gate pronto: `motore.config.alberto_banco_versione_minima` (vuoto = Banco prende tutto).
- `consegne_invii` ha unicità solo per gli invii periodici.
- 30/09/2026: Stefano uscito dal team (account cancellato); KALEA non è più cliente (clienti.stato = 'Chiuso', task archiviati).
