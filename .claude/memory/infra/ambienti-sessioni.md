---
title: Due tipi di sessione: cloud isolato e bridge sul Mac
tags: [sessioni, ambienti, claude-code]
importance: alta
updated: 2026-09-12
---
Le sessioni di questo account sono di due tipi:

- **anthropic_cloud**: container effimero nel cloud, un solo ambiente disponibile ("Default"). Non vede le variabili del Mac, non può raggiungere le altre sessioni, non può creare sessioni sul Mac.
- **bridge**: girano dentro VS Code sul Mac di Giovanni, sul repo skorpiov3. Hanno accesso alle chiavi locali e ai file del computer.

Conseguenza pratica: un lavoro che richiede una chiave presente solo sul Mac va eseguito da una sessione bridge, oppure la chiave va messa nei GitHub Secrets e il lavoro spostato su GitHub Actions.
