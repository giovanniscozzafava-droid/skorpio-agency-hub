# Secondo Banco di Alberto sul Mac dello studio

Da incollare nel Claude Code del Mac dello studio, aperto su **skorpiov3**.

---

Devi far girare su questo Mac un secondo Banco di Alberto, uguale a quello che gira sul MacBook di Sant'Elia ma aggiornato. Quello di Sant'Elia NON va toccato: resta acceso come riserva.

1. Trova in skorpiov3 il demone del Banco: è il processo che scrive il battito in `banco_stato`, prende i messaggi con `alberto_coda_prendi` e importa `supabase/functions/_shared/albertoWhatsapp.mjs`. Guarda anche come è avviato (launchd, script) e da quali variabili/Portachiavi legge le chiavi.
2. Sostituisci `supabase/functions/_shared/albertoWhatsapp.mjs` con quello del repo `giovanniscozzafava-droid/skorpio-agency-hub`, branch `claude/timeline-lavoro-giornaliero`, stesso percorso (`git fetch`/`gh api` o `curl` raw con le mie credenziali). Contiene gli strumenti nuovi: `assegna_lavoro`, `vidima`, `riassegna`, `sposta_consegna`, `giornata_di`, `smista`.
3. Rendi l'identità del Banco configurabile con una variabile `BANCO_ID` (predefinito `banco`, così Sant'Elia resta uguale). Con `BANCO_ID=banco-studio`:
   - il battito fa upsert in `banco_stato` con `id = 'banco-studio'`, `host` = nome di questo Mac, `versione = '1.1.0'`;
   - la coda si prende con `alberto_coda_prendi(p_da => 'banco-studio', …)`;
   - la chiusura/risposta controlla `preso_da = 'banco-studio'` (dove oggi c'è `'banco'`).
   Il database dà la coda al Banco con versione ≥ `motore.config.alberto_banco_versione_minima` (1.1.0); Sant'Elia (1.0.0) risponde solo se questo è spento.
4. Avvialo su questo Mac come servizio permanente (come su Sant'Elia), con `BANCO_ID=banco-studio`. Le chiavi vanno nel Portachiavi, mai in chat né nel repo: se mancano, dimmi quale e come inserirla.
5. Verifica: `select id, host, versione, ultimo_battito from banco_stato;` deve mostrare `banco-studio`, `1.1.0`, battito di pochi secondi fa. Poi scrivo ad Alberto su WhatsApp «che lavoro ha Luca domani?» e deve rispondere usando `giornata_di`.
6. Fai commit e push su un branch di skorpiov3 (non su main), così Sant'Elia potrà aggiornarsi con un pull.
