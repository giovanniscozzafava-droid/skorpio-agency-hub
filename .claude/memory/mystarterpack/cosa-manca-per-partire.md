---
title: Cosa manca perché MyStarterPack sia online e autonomo
tags: [todo, attivazione, vercel, instagram]
importance: alta
updated: 2026-09-12
---
Il codice è pronto e la build passa. Mancano azioni che richiedono una persona:

1. **GEMINI_API_KEY nei GitHub Secrets** (vedi infra/chiave-gemini). Senza, niente testi né voce in automatico.
2. **Progetto Vercel** con root `mystarterpack/site` e DNS di Aruba verso Vercel. Il connettore Vercel non ha il permesso di creare progetti nel team: va fatto a mano.
3. **Amazon Associates**: iscrizione e tag reale al posto del segnaposto `mystarterpack-21`, più gli ID di tracciamento per canale (ig, tt, yt, pin, nl).
4. **Account social** con lo stesso handle: Instagram Business collegato a una Pagina Facebook, TikTok, YouTube, Pinterest Business.
5. **App Meta e token Instagram** a lunga scadenza per la pubblicazione automatica.

Dettagli operativi in `mystarterpack/docs/SETUP.md`. Lo stato si verifica in ogni momento con `cd mystarterpack/pipeline && node doctor.mjs`.
