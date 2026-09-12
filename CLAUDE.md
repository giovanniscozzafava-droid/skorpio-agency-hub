# skorpio-agency-hub

Repository di **Fuyue Digital Agency**. Contiene Skorpio (l'app di gestione dell'agenzia, React + Vite + Supabase) e i progetti editoriali dell'agenzia, primo fra tutti [MyStarterPack](mystarterpack/README.md).

## Prima di iniziare: leggi la memoria di progetto

Questo repository ha una memoria condivisa, servita dal server MCP **codebase-memory** (registrato in `.mcp.json`, nessuna dipendenza da installare).

1. **A ogni inizio sessione** chiama `memory_brief`: in una schermata hai lo stato dei progetti, dove vivono le chiavi, le decisioni già prese.
2. **Prima di chiedere qualcosa all'utente** chiama `memory_search`: la risposta potrebbe essere già stata data in una sessione precedente.
3. **Quando scopri un fatto duraturo** chiama `memory_write`: decisioni e loro motivo, dove vive una credenziale (mai il valore), convenzioni, trappole già incontrate, stato di un progetto. Non salvare segreti, dati personali o cose vere solo oggi.

Le voci sono file markdown in `.claude/memory/<categoria>/<chiave>.md`, versionati in git: si leggono, si correggono a mano e si rivedono in una pull request come qualsiasi altro file.

## Struttura
- `src/`, `supabase/` — Skorpio, l'app dell'agenzia
- `mystarterpack/` — progetto MyStarterPack, con un proprio `CLAUDE.md`, la strategia in `docs/STRATEGY.md` e un team di agenti in `.claude/agents/`
- `.claude/mcp/codebase-memory/` — il server MCP della memoria
- `.github/workflows/` — automazioni, tra cui il ciclo giornaliero di MyStarterPack

## Regole valide ovunque
- Si sviluppa sul branch indicato, mai push diretti su `main` senza richiesta esplicita.
- I segreti stanno nelle variabili d'ambiente e nei GitHub Secrets. Mai nel repo, mai in chat.
- Prima di un commit che tocca il sito MyStarterPack: `cd mystarterpack/site && npm run build` deve passare.
