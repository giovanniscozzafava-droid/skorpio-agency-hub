---
title: Monitor TV: il codice vero è in skorpiov3, non in questo repo
tags: [monitor, tv, montesanti, broadcast]
importance: alta
updated: 2026-09-29
---
Il player `/tv/:slug` in produzione (tv.fuyue.it) e le edge function Drive sono nel repo **giovanniscozzafava-droid/skorpiov3**; `src/` di skorpio-agency-hub è una copia vecchia. Progetto Supabase: `skorpio` (wkhusguhmkxzzavpsqwz).

- Montesanti (`device_profile_override='legacy'`, TV LG NetCast) usa `BroadcastPlayer`: HLS muxato da `stream.fuyue.it` (VPS), codice in `skorpiov3/scripts/broadcast-vps/muxer.mjs`, deploy via scp/systemd (vedi README lì).
- Diagnosi a distanza: `monitor.device_info` (ultimo heartbeat) e i log `function_edge_logs` di `monitor-heartbeat` (una raffica di 2-3 ping = un caricamento della pagina) e `google-drive-stream` (un download per clip dal muxer).
- Trappola 29/09/2026: nel muxer, se un video è muto, la radio (flusso infinito) teneva vivo ffmpeg per 20 minuti → segmenti senza video → TV ferma, ricaricata ogni ~50s. Corretta con `-t durata` + `-shortest` (branch claude/montesanti-monitor-freezing-621vu1 di skorpiov3).
