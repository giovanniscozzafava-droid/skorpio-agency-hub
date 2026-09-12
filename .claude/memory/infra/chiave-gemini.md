---
title: Dove vive la chiave Gemini e perché a volte manca
tags: [gemini, segreti, ci, voce]
importance: alta
updated: 2026-09-12
---
La chiave Gemini esiste **sul Mac di Giovanni**, nell'ambiente locale: la usano le sessioni Claude aperte da VS Code (quelle su ambiente "bridge", per esempio i video Sinopoli Arredamenti e la formazione Rosella Elia).

Le sessioni che girano nel cloud di Anthropic (ambiente "anthropic_cloud", come questa) **non la vedono**: i container sono isolati e non ereditano le variabili del Mac. Non è un problema di permessi, la variabile proprio non esiste lì.

Perché la pipeline MyStarterPack sia autonoma la chiave deve stare nei **GitHub Secrets** del repo skorpio-agency-hub, scheda Actions (non Codespaces, non Dependabot), con nome `GEMINI_API_KEY`.

Verifica fatta il 12 settembre 2026 con un workflow su branch: il segreto non risultava presente sotto nessuno di questi nomi: GEMINI_API_KEY, GOOGLE_API_KEY, GEMINI_KEY, GOOGLE_GEMINI_API_KEY, GEMINI_API, GOOGLE_GENAI_API_KEY, GEMINI_TOKEN, GOOGLE_AI_API_KEY, né tra le Variables. Se il segreto esiste, nel log compare `***`; se è assente il valore è vuoto.

Modo più rapido per installarla, senza che passi dalla chat: dal Mac, `gh secret set GEMINI_API_KEY --repo giovanniscozzafava-droid/skorpio-agency-hub --body "$GEMINI_API_KEY"`.
