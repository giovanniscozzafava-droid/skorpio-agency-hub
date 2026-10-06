---
title: Alberto su WhatsApp: perché perdeva messaggi e come è fatto ora
tags: [alberto, whatsapp, supabase, kapso]
importance: alta
updated: 2026-10-06
---
Database wkhusguhmkxzzavpsqwz. Dettagli in docs/alberto-whatsapp.md.

**Cause dei messaggi persi (verificate il 2/10/2026):**
- Kapso manda i numeri senza «+» (393…), la rubrica team_whatsapp li ha con «+393…»: confronto sempre per sole cifre.
- Il cervello non risponde: Banco Sant'Elia crasha con «claude uscito con 1», Banco studio non è avviato, l'API Anthropic è senza credito. Finché nessuno dei tre gira, le frasi libere restano in coda.
- Le uscite fallite sono HTTP 402 di Kapso (credito/carta rifiutata) quando serve il template fuori dalle 24 ore.
- **comandi_alberto = false per Luca e Alessandro** in team_whatsapp: i loro messaggi non entrano mai in coda né nel ripescaggio (es. «sono malato» di Luca il 6/10 è rimasto «ricevuto»). Abilitarli è una decisione di Giovanni, non fatta.

**Come funziona ora:** webhook (v10) → alberto_coda con retry ogni 60 s per 30 min; cron `alberto-ritardi` (jobid 56, ogni minuto, edge `consegne` v21) ripesca gli orfani, manda l'ack dopo 1 min e dopo 30 min avvisa Giovanni (WhatsApp, poi email). Le regole italiane per «X deve fare Y entro Z» sono in SQL (consegne_ordine_libero); una frase con due ordini va al cervello.

**Trappole:** nessuna rete dal container verso supabase.co: le edge function si deployano solo col tool MCP, passando tutti i file inline in una sola chiamata (index + giornata + claude + _shared/chiamante + _shared/emailProvider); i riavvii del container uccidono i subagent di deploy. DDL multipli o DROP POLICY vanno in timeout: una istruzione per volta. `src/` di questo repo è una copia ferma ad aprile: il frontend vero sta in skorpiov3.
