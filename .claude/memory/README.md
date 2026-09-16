# Memoria di progetto

Ogni file qui è un fatto che le sessioni future devono sapere senza doverlo riscoprire. Li serve il server MCP `codebase-memory` (`.claude/mcp/codebase-memory/server.mjs`, registrato in `.mcp.json`).

## Formato
`<categoria>/<chiave>.md`, con un blocco di metadati in testa:

```md
---
title: Titolo leggibile
tags: [uno, due]
importance: alta | normale | bassa
updated: 2026-09-12
---
Il fatto, in markdown. Scrivi perché, non solo cosa.
```

`importance: alta` significa che la voce compare nel riepilogo di apertura (`memory_brief`).

## Strumenti
`memory_brief` riepilogo iniziale · `memory_search` ricerca · `memory_read` testo completo · `memory_write` crea o aggiorna · `memory_delete` rimuove.

## Cosa non va qui
Valori di chiavi e password, dati personali, stati temporanei ("il build sta girando"), o cose che si leggono già chiaramente nel codice.

Si modificano anche a mano: sono file di testo normali, e le modifiche si rivedono in pull request come il resto.
