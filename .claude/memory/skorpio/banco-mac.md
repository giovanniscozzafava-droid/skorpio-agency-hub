---
title: Il Banco di Alberto gira sul MacBook Pro di Sant'Elia, non sul Mac dello studio
tags: [alberto, banco, infra, tailscale]
importance: normale
updated: 2026-09-30
---
Al 30/09/2026 il Banco (demone di Alberto che prende `alberto_coda`) dichiara in `banco_stato` host `MacBookPro.homenet.telecomitalia.it` (rete di casa TIM, Sant'Elia), versione 1.0.0. Il Mac dello studio è un'altra macchina: per aggiornare il Banco da lì serve un accesso remoto (Tailscale + Login remoto/SSH o Condivisione schermo attivi sul MacBook di Sant'Elia). Le sessioni cloud di Claude non raggiungono né il Mac né la tailnet. Tailnet (30/09): account `giovanniscozzafava-droid` (login GitHub); il MacBook di Sant'Elia è il nodo `macbook-pro`, collegato anche l'iPhone. Il Mac dello studio (`MBP-di-Giovanni`, macOS vecchio): l'app Tailscale non parte (estensione di sistema mai attivata), funziona la versione Homebrew (`brew install tailscale`, `sudo brew services start tailscale`, comandi in `/usr/local/opt/tailscale/bin/`). Al 30/09 sul MacBook di Sant'Elia Login remoto (SSH) e Condivisione schermo erano SPENTI: da remoto non si entra finché qualcuno sul posto non li accende (Impostazioni → Generali → Condivisione). Da annotare: dove sta sul MacBook la cartella skorpiov3 da cui il Banco importa `albertoWhatsapp.mjs` e come si riavvia.
