# Timeline del lavoro giornaliero

Ordine di Giovanni del 30/09/2026. La catena:

**Giovanni → Alberto → Elisa → Alessandro e Luca.** Giovanni dà i compiti ad
Alberto; Alberto li passa a Elisa con la verifica già fatta; Elisa li dispensa
ai ragazzi; il pianificatore riempie le loro ore libere prima della consegna;
ogni ragazzo riceve la lista del giorno con gli orari; a fine giornata
consegna.

Questa cartella contiene i sorgenti **deployati in produzione** (progetto
Supabase `skorpio`) il 30/09/2026 da una sessione cloud che non poteva
raggiungere il repo `skorpiov3`. Vanno portati lì così come sono: vedi in fondo.

## Dove sta cosa

| Pezzo | Dove |
|---|---|
| Il pianificatore (unico) | SQL: `consegne_piazza`, `consegne_pianifica_task`, `consegne_riordina` |
| Assegnare un lavoro | RPC `consegne_assegna` (smista: Elisa diretto, gli altri passano da lei) |
| Passare un compito a Elisa | RPC `consegne_proponi` → task «Da smistare» con la proposta |
| Elisa smista | RPC `consegne_smista` |
| Spostare una consegna | RPC `consegne_sposta`, oppure dal Kanban (trigger `consegne_task_dopo`) |
| La giornata di una persona | RPC `consegne_giornata` |
| I messaggi (WhatsApp + email + chat) | edge function `consegne`, file `giornata.ts` |
| Gli strumenti di Alberto su WhatsApp | `_shared/albertoWhatsapp.mjs` |

Migrazioni: `supabase/migrations/20260930*_*.sql`, tutte applicate.

## Come riempie le ore

Ore libere = `team.orari_lavoro` − impegni in calendario − assenze − ore
già timbrate oggi (`presenze` entrata/turno). Il lavoro va nei primi buchi
veri da adesso fino alla consegna meno 30 minuti (`motore.config.consegne_margine_min`),
a quarti d'ora, senza spezzoni sotto la mezz'ora. Se non entra: prova a
riordinare tutto il lavoro della persona per scadenza; se non entra neanche
così, **non crea niente**, avvisa Giovanni ed Elisa e propone la prima data
che regge o chi ha le ore.

Blocchi e task sono legati da `calendario.blocco_task_id`. Scadenza spostata →
blocchi rifatti (e avvisati anche gli altri lavori che cambiano orario). Task in
Fatto → blocchi futuri tolti.

Orario preciso fuori dall'orario di lavoro o sopra un impegno → `serve_conferma`,
si mette solo dopo il sì.

## I messaggi (ora di Roma)

| Quando | Cosa | Cron |
|---|---|---|
| lun-ven 8:30 | a ognuno la lista del giorno con gli orari (WhatsApp + email) | `alberto-whatsapp-giornaliero` |
| subito | lavoro nuovo o spostato → a chi lo fa | da `consegne_avvisa` |
| subito | compito da smistare → a Elisa | da `consegne_avvisa` |
| lun-ven 9:15 | promemoria a chi non ha timbrato | `consegne-promemoria-timbra` |
| lun-ven 18:00 | consegne di oggi non in Fatto → Giovanni ed Elisa | `consegne-sera` |
| 1/10/2026 8:30 | «Da oggi si timbra» a Luca, Alessandro, Stefano | `consegne-timbratura-avvio` |

WhatsApp: testo libero se la persona ha scritto nelle ultime 24 ore,
altrimenti il template approvato `lavoro_di_oggi`. Esito in `whatsapp_messaggi`,
riepilogo in `consegne_invii`.

## Da portare in skorpiov3

1. Copiare `supabase/functions/consegne/`, `alberto-api/`, `alberto-webhook/`
   e `_shared/albertoWhatsapp.mjs`, `albertoApi.ts`, `albertoInvio.ts`.
   `consegne` non importa più `_shared/squadra.ts`: usa `consegne/claude.ts`.
2. Copiare le migrazioni `20260930*`.
3. **Il Banco sul Mac** importa `albertoWhatsapp.mjs` da skorpiov3: finché non
   ha la nuova versione non conosce `assegna_lavoro`, `smista`,
   `sposta_consegna`, `giornata_di`. Dopo il pull e il riavvio, dichiarare
   versione `1.1.0` in `banco_stato` e mettere
   `motore.config.alberto_banco_versione_minima = '1.1.0'`.
4. Frontend: aggiungere `"persone"` all'elenco dei tab apribili da URL
   (`?tab=persone`), così il link nei messaggi apre direttamente la
   timbratura.
