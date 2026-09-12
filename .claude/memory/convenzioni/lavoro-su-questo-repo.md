---
title: Convenzioni di lavoro sul repo skorpio-agency-hub
tags: [git, convenzioni, build]
importance: normale
updated: 2026-09-12
---
- Si sviluppa sul branch indicato dalla sessione, mai push diretti su main senza richiesta esplicita.
- Prima di ogni commit che tocca il sito: `cd mystarterpack/site && npm run build` deve passare.
- Il validatore editoriale dei pack è `validatePack` in `mystarterpack/pipeline/lib/packs.mjs`.
- Segreti solo in variabili d'ambiente e GitHub Secrets, mai nel repo e mai in chat.
- Il repo principale dell'agenzia è skorpio-agency-hub; le sessioni sul Mac lavorano invece su skorpiov3.
