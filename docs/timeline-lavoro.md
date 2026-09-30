# Timeline del lavoro giornaliero

Ordine di Giovanni del 30/09/2026. La catena:

**Giovanni → Alberto → calendario e Kanban → Elisa vidima → Alessandro e Luca.**
La sera (lun-ven 18:30) Alberto chiede a Giovanni su WhatsApp i lavori del
giorno dopo; Giovanni risponde, o scrive quando vuole. Alberto mette subito ogni
lavoro nel Kanban e nelle ore libere del ragazzo prima della consegna, ma **da
vidimare** (`task.vidimato = false`): il ragazzo non lo vede e non riceve
niente. Elisa riceve il messaggio, e vidima, sposta o riassegna. Quando
vidima, il ragazzo riceve WhatsApp ed email con il lavoro e gli orari. Alle 8:30
ognuno riceve la lista del giorno; a fine giornata consegna.

Questa cartella contiene i sorgenti **deployati in produzione** (progetto
Supabase `skorpio`) il 30/09/2026 da una sessione cloud che non poteva
raggiungere il repo `skorpiov3`. Vanno portati lì così come sono: vedi in fondo.

## Dove sta cosa

| Pezzo | Dove |
|---|---|
| Il pianificatore (unico) | SQL: `consegne_piazza`, `consegne_pianifica_task`, `consegne_riordina` |
| Assegnare un lavoro | RPC `consegne_assegna` (Elisa: diretto e già vidimato; Giovanni per un ragazzo: `consegne_proponi`) |
| Lavoro chiesto da Giovanni | RPC `consegne_proponi` → task e blocchi veri, `vidimato = false`, messaggio a Elisa |
| Elisa vidima | RPC `consegne_vidima` (un TSK o «tutti») → messaggio al ragazzo |
| Elisa riassegna | RPC `consegne_riassegna` → blocchi rifatti nel calendario dell'altro |
| Vecchi compiti «Da smistare» | RPC `consegne_smista` |
| Spostare una consegna | RPC `consegne_sposta`, oppure dal Kanban (trigger `consegne_task_dopo`) |
| La giornata di una persona | RPC `consegne_giornata` |
| I messaggi (WhatsApp + email + chat) | edge function `consegne`, file `giornata.ts` |
| Gli strumenti di Alberto su WhatsApp | `_shared/albertoWhatsapp.mjs` |

Migrazioni: `supabase/migrations/20260930*_*.sql`, tutte applicate.

## Comandi su WhatsApp (senza modello)

Finché il Banco non ha gli strumenti nuovi e l'API di riserva è senza credito,
i comandi di lavoro li riconosce ed esegue il database (`consegne_comando`),
chiamato dal webhook prima della coda di Alberto. Tutto il resto va al Banco.

| Scrivi | Succede |
|---|---|
| `lavoro Luca: montaggio reel Roxy, 3 ore, entro venerdì 17:30` | lavoro nei buchi liberi prima della consegna |
| `lavoro Alessandro: riprese Roxy, giovedì 15-18` (o `dalle 15 alle 18`) | orario preciso; fuori orario → aggiungere `confermo` |
| `da vidimare` | l'elenco in attesa |
| `vidima TSK4040` / `vidima tutto` | il ragazzo riceve il lavoro |
| `sposta TSK4040 a lunedì 12:00` | consegna e blocchi spostati |
| `dai TSK4040 a Luca` | riassegnato |

Giorni: oggi, domani, dopodomani, lunedì…domenica, 2/10, 2 ottobre.

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
Fatto → blocchi futuri tolti, quello in corso chiuso adesso e Completato;
task archiviato → come Fatto, ma il blocco in corso è Annullato.
Finché un lavoro non è vidimato, `consegne_avvisa` non manda niente al ragazzo
(né nuovo né spostato).

Orario preciso fuori dall'orario di lavoro o sopra un impegno → `serve_conferma`,
si mette solo dopo il sì.

## I messaggi (ora di Roma)

| Quando | Cosa | Cron |
|---|---|---|
| lun-ven 8:30 | a ognuno la lista del giorno con gli orari (WhatsApp + email) | `alberto-whatsapp-giornaliero` |
| subito | lavoro nuovo o spostato → a chi lo fa | da `consegne_avvisa` |
| subito | lavoro da vidimare → a Elisa | da `consegne_avvisa` |
| subito | Elisa vidima → al ragazzo | da `consegne_vidima` |
| lun-ven 18:30 | a Giovanni: i lavori per il prossimo giorno feriale, con le ore libere dei ragazzi | `consegne-chiedi-compiti` |
| lun-ven 9:15 | promemoria a chi non ha timbrato | `consegne-promemoria-timbra` |
| lun-ven 18:00 | consegne di oggi non in Fatto → Giovanni ed Elisa | `consegne-sera` |
| 1/10/2026 8:30 | «Da oggi si timbra» a Luca e Alessandro | `consegne-timbratura-avvio` |

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
   `sposta_consegna`, `giornata_di`, `vidima`, `riassegna`. Dopo il pull e il riavvio, dichiarare
   versione `1.1.0` in `banco_stato` e mettere
   `motore.config.alberto_banco_versione_minima = '1.1.0'`.
4. Frontend: aggiungere `"persone"` all'elenco dei tab apribili da URL
   (`?tab=persone`), così il link nei messaggi apre direttamente la
   timbratura.
