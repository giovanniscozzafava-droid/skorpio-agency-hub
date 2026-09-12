# Il team MyStarterPack

Un team di agenti (definiti in `.claude/agents/`) che lavora in autonomia e riporta al **CFO/Amministratore di Fuyue Digital Agency**.

```
CFO / Amministratore Fuyue (Giovanni)
└── msp-editor-in-chief  · capo redazione, coordina e approva
    ├── msp-seo-analyst      · cosa scrivere (domanda di ricerca, coda argomenti)
    ├── msp-product-scout    · quali 5 prodotti (reali, reperibili, prezzi)
    ├── msp-copywriter       · il pack (frontmatter, body, script voce, FAQ)
    ├── msp-video-producer   · immagini, voce Gemini 2.5, reel motion graphics
    ├── msp-social-publisher · Instagram (poi TikTok/Shorts), caption, stato
    └── msp-brand-guardian   · coerenza con il brand book
```

## Rituali
- **Ogni giorno (automatico, 08:00)**: il workflow GitHub esegue `pipeline/daily.mjs`: nuovo pack dalla coda → immagini → voce → reel → Instagram → commit. Nessun umano coinvolto.
- **Ogni settimana (Routine Claude `trig_01G4UadWwCTD7VrHJDSVkdvC`, lunedì 07:00 Italia, attiva)**: il capo redazione apre una sessione sul repo, controlla gli ultimi 7 run, revisiona i pack generati, rialimenta `topics.json` (≥ 60 argomenti), lancia i ruoli in parallelo per 5-10 pack "manuali" di qualità superiore, verifica la build e pusha su `main`. Scrive `docs/reports/YYYY-WW.md` per il CFO.
- **Ogni mese**: SEO analyst controlla sitemap, dati strutturati, pack più visitati (Vercel Analytics) e propone aggiornamenti dei prezzi sui 20 pack più letti.

## Autonomia e limiti
Il team decide da solo: argomenti, prodotti, testi, video, orari di pubblicazione, correzioni alla pipeline, coda editoriale.

## Escalation al CFO (unici casi)
1. Token o chiavi scadute/mancanti (Instagram, Gemini, Amazon): il team non può crearle.
2. Cambio di brand, dominio, tag affiliato, modello economico o piattaforme.
3. Segnalazioni legali/reclami (prodotto pericoloso, richiesta di rimozione, contestazione AGCOM).
4. Spesa API prevista oltre 30 €/mese o modifica al workflow che aumenta la frequenza di pubblicazione.
5. Metriche: dopo 60 giorni, se il CTR verso Amazon è sotto l'1% o le vendite qualificate sono 0, proporre al CFO un cambio di strategia (formato, nicchie, piattaforme).

## KPI (da riportare nel report settimanale)
Pack pubblicati · reel pubblicati · errori pipeline · visualizzazioni reel medie · click verso Amazon (Vercel Analytics, eventi `outbound`) · vendite qualificate (dashboard Associates, letta dal CFO).
