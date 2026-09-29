---
title: DA FARE dopo il deploy del muxer: riattivare 4 video Montesanti
tags: [monitor, montesanti, da-fare]
importance: alta
updated: 2026-09-29
---
Il 29/09/2026 ho messo `attivo=false` su 4 video muti di Montesanti in `monitor_contenuti` (progetto Supabase skorpio), come rimedio temporaneo al bug del muxer (vedi `monitor-tv-dove-vive-il-codice`): "Ogni anno, migliaia di donne…", "Ma a chi ha Diabete tipo 2…", "Visite diabetologiche", "visite_endocrinologiche_1920x1080" (drive_file_id 1U4i-Qnliivn2vJXVoXX7uKsClGP-jna5, 1amZC11aN9b9gWbX95lhLb-PLNtq7bodD, 1k8SCln6xyvbICQSa39J-J6OJX0qrojiV, 1BGlNBH28P4Cf8X1FQKWm2NoBFXaKGKRo).

Appena `muxer.mjs` corretto (branch claude/montesanti-monitor-freezing-621vu1 di skorpiov3) è copiato su stream.fuyue.it e il servizio è riavviato, rimetterli `attivo=true`.

Provato e scartato lo stesso giorno: passare Montesanti al player normale (`device_profile_override='modern'`). Su quella LG NetCast i video restano in pausa e la radio non parte. Resta `legacy`.
