---
title: Automazioni già configurate
tags: [ci, routine, workflow]
importance: normale
updated: 2026-09-12
---
- `.github/workflows/mystarterpack-daily.yml`: ogni mattina alle 08:00 italiane genera un pack dalla coda, voce, reel, Pin, pubblica su Instagram, fa il ping IndexNow e committa su main. Primo passo: `doctor.mjs`, così se manca un segreto il run fallisce subito con un messaggio chiaro.
- `.github/workflows/mystarterpack-check.yml`: gira a ogni push sul branch di sviluppo, verifica le chiavi e produce i reel di prova senza toccare main.
- **Routine Claude settimanale** `trig_01G4UadWwCTD7VrHJDSVkdvC`, lunedì alle 07:00 italiane: apre una sessione nuova che fa da CEO, rialimenta la coda argomenti, fa scrivere 6 pack, aggiorna il calendario social, scrive il report per il CFO e apre una pull request verso main.
