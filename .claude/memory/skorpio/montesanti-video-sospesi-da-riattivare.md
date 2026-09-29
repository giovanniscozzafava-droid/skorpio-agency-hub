---
title: DA FARE dopo il deploy del muxer: riattivare i video Montesanti
tags: [monitor, montesanti, da-fare]
importance: alta
updated: 2026-09-29
---
Programmazione di Montesanti fino a giugno 2026: la fascia "Giornaliera" (lun-ven 09-18) con 7 video: motivazionale, Longevità, frattaglia 1, "Ogni anno, migliaia di donne…", "Ma a chi ha Diabete tipo 2…", "Visite diabetologiche", "visite_endocrinologiche_1920x1080". La fascia è intatta in `monitor_fasce`.

Stato al 29/09/2026 in `monitor_contenuti` (progetto Supabase skorpio):
- attivi: motivazionale, Longevità (drive_url riscritto dal vecchio `?id=` a `fileId=…&teamId=fd62…` di Giovanni, che è il proprietario su Drive).
- sospesi per il bug del muxer sui video muti (vedi `monitor-tv-dove-vive-il-codice`): i 4 video muti (drive_file_id 1U4i-Qnliivn2vJXVoXX7uKsClGP-jna5, 1amZC11aN9b9gWbX95lhLb-PLNtq7bodD, 1k8SCln6xyvbICQSa39J-J6OJX0qrojiV, 1BGlNBH28P4Cf8X1FQKWm2NoBFXaKGKRo). Da rimettere `attivo=true` appena `muxer.mjs` corretto (PR #36 di skorpiov3) è copiato su stream.fuyue.it e il servizio è riavviato.
- frattaglia 1: drive_url riscritto nel formato corretto ma lasciato spento. È un .MOV da iPhone, probabilmente HEVC: con `-c:v copy` la LG potrebbe non decodificarlo. Va controllato il codec (ffprobe sul VPS) prima di riattivarlo.
- Longevità (1): Drive di Alessandro scollegato (409), non era nella fascia già a giugno.

Provato e scartato: passare Montesanti al player normale (`device_profile_override='modern'`). Su quella LG NetCast i video restano in pausa e la radio non parte. Resta `legacy`.
