# Alberto su WhatsApp: nessun messaggio si perde

Scritto il 2/10/2026, dopo che dal 28/09 al 2/10 mattina 26 messaggi reali non
sono stati elaborati.

## Cosa era rotto (verificato sul database `wkhusguhmkxzzavpsqwz`)

1. **Il numero.** Kapso manda `393…`, `team_whatsapp` ha `+393…`: il webhook non
   riconosceva nessuno, quindi nessun messaggio entrava in `alberto_coda`.
   Corretto il 1/10 (webhook v9: confronto per sole cifre) e con un trigger su
   `whatsapp_messaggi` che completa `membro` e normalizza `numero`.
2. **Il cervello.** I due messaggi arrivati dopo la correzione (un «Ok» e la
   domanda di Elisa) sono entrati in coda; il Banco di Sant'Elia (v1.0.0) ha
   fallito 3 volte con `claude uscito con 1` (stderr vuoto) e la riga è andata in
   `errore` senza che nessuno la riprendesse. L'API di riserva è senza credito
   Anthropic.
3. **«Riprova tra un minuto».** Quando l'API falliva, `albertoApi.ts` chiudeva la
   riga come *fatta* e mandava quella frase: il messaggio si perdeva.
4. **Vincolo `preso_da`.** Ammetteva solo `banco` e `api`: un secondo Banco
   (`banco-studio`) sarebbe stato respinto dal database.
5. **Le 8 uscite fallite del 1/10** non c'entrano con Alberto: sono tutti
   `HTTP 402: Your Kapso balance doesn't cover Meta's fee` (messaggi-modello
   fuori dalla finestra di 24 ore; carta Kapso rifiutata). Le 3 più vecchie
   (27-28/09) erano errori di template, già corretti.

## Cosa succede ora a ogni messaggio in entrata

1. `alberto-webhook` lo salva (`whatsapp_messaggi`, stato **ricevuto**).
2. Se è un comando a sintassi fissa (`lavoro Luca: …`, `vidima`, `sposta`, `dai`,
   `da vidimare`, `entrata`, `uscita`, `sì 1 2 4`) lo esegue il database
   (`consegne_comando_log`) e risponde subito: stato **risposto** + `azione`.
3. Altrimenti entra in `alberto_coda`. Chi lo prende (ordine):
   **Banco aggiornato** (`banco-studio`, v≥1.1.0) → **Banco vecchio** (solo se
   nessun aggiornato è vivo) → **API** (watchdog, dopo 60 s). Quando un Banco lo
   prende il messaggio diventa **letto**; quando chiude con successo diventa
   **risposto** e `azione` contiene task, eventi e azioni creati
   (`alberto_azione_riassunto`).
4. Se il cervello fallisce, `alberto_coda_chiudi(…, false)` **rimette la riga in
   coda** con `riprova_dopo = +60 s`, per 30 minuti dal messaggio. Nessuna scusa
   mandata alla persona.
5. Il cron `alberto-ritardi` (ogni minuto, edge function `consegne`):
   - **ripesca** i messaggi dei membri abilitati mai entrati in coda
     (da `motore.config.alberto_ripesca_dal` in poi);
   - dopo **1 minuto** senza risposta scrive a chi ha scritto «Ho ricevuto il tuo
     messaggio e ci sto lavorando» (una volta ogni 10 minuti per persona);
   - dopo **30 minuti** chiude la riga in `errore` e avvisa **Giovanni**
     (WhatsApp, email se la finestra è chiusa, notifica in Skorpio) e chi ha
     scritto.

Cosa **non** si può fare senza un cervello: capire frasi libere
(«spostalo a lunedì»). Serve almeno uno fra Banco studio, Banco Sant'Elia
(riparato) o API con credito. Finché non c'è, i messaggi restano in coda, chi ha
scritto riceve la conferma dopo 1 minuto e Giovanni l'avviso dopo 30.

## Recupero dei messaggi persi

Tabella `alberto_recupero` (lotto, n, tipo, dati, stato). Le proposte nascono con
stato `proposta`: **niente viene creato** finché Giovanni non scrive:

- `sì 1 2 4` / `sì tutti` → `alberto_recupero_esegui` (prima gli impegni, poi i
  lavori, con il pianificatore di `consegne_assegna`);
- `no` / `no 3 5` → scarta.

Un impegno comunicato da altri (Sinopoli di Alessandro) entra in calendario come
*Pianificato* e resta `in_conferma`: diventa *Fatto* solo se Alessandro risponde
«sì» (`alberto_recupero_conferma`), «no» lo toglie.

## Privacy

`whatsapp_messaggi` e `alberto_coda`: Elisa e Giovanni vedono tutto, gli altri
solo i propri messaggi (RLS con `alberto_e_admin()` / `alberto_membro_corrente()`).
Rispondere a mano: solo Elisa e Giovanni (`alberto_whatsapp_rispondi`).

## Due bug dell'app, chiusi nel database

Trigger `a_task_guardie_automatiche` su `task` (BEFORE INSERT):

- **Cleanup**: se `feature_flags.auto_cleanup_task` è spento (lo è dal 27/09)
  i task creati dal sistema non si inseriscono. L'app li creava comunque da
  `checkAutoPubblica` / `faseService` / `completaTaskEAvanzaFase`.
- **Alert Quota**: un alert per mese e cliente, anche se Elisa l'ha già chiuso.
  Causa nell'app: `ClientiTab.checkQuoteInsufficienti` cerca `c.id_display` in
  una descrizione che contiene `c.nome`. Il guardiano lavora sui nomi, quindi
  vale per qualsiasi versione dell'app. (Correzione consigliata anche nel codice:
  confrontare per nome e mese e non per `id_display`.)

I tre task Cleanup già creati e ancora aperti (TSK4050, 4051, 4054) vanno
archiviati a mano.

## Pagina «WhatsApp» dentro Alberto

`src/components/AlbertoWhatsappTab.tsx` (di questo repo). **Attenzione:** `src/`
in `skorpio-agency-hub` è una copia ferma ad aprile e non è l'app in produzione
(non ha nemmeno la scheda Persone): il componente va copiato in **skorpiov3**.

```tsx
<AlbertoWhatsappTab
  isAdmin={membro.ruolo === 'Admin'}      // Elisa e Giovanni
  membro={membro.nome}                     // «Luca», «Alessandro»…
  onApriTask={(id) => apriTaskNelKanban(id)}
  onApriEvento={(id) => apriEventoNelCalendario(id)}
/>
```

Usa solo `supabase` del progetto, Tailwind e le classi shadcn (`bg-card`,
`border-border`, `text-muted-foreground`, `bg-primary`…). Nessun'altra
dipendenza.
