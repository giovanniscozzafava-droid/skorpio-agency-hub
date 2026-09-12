# Brief per chi scrive uno starter pack (umano o agente)

Un file = un pack = `site/src/content/packs/<slug>.md`. Lo slug è kebab-case ASCII (es. `orto-sul-balcone`).
Il file di riferimento è `site/src/content/packs/escursionismo.md`: copia la struttura esattamente.

## Regole editoriali (non negoziabili)
1. **Esattamente 5 prodotti.** Ognuno copre un'esigenza diversa (`role`): mai due prodotti per la stessa cosa.
2. **Prodotti reali e reperibili su amazon.it.** Modelli e marchi esistenti e diffusi (Salomon, Deuter, Philips, Bosch, Xiaomi, Logitech, Yamaha, Decathlon-equivalenti...). Se un modello specifico è rischioso, usa un nome generico chiaro ("Tappetino yoga antiscivolo 6 mm") con brand "Vari".
3. **Mai inventare ASIN.** Campo `asin: ""` sempre vuoto: verrà arricchito dalla pipeline. Il link si costruisce con `amazonQuery`, che deve essere una ricerca precisa che porta al prodotto (marca + modello + tipo, in italiano).
4. **Prezzi realistici** come fascia (`"25-45 €"`), mai un prezzo secco. `budgetTotal` è la somma delle fasce, arrotondata.
5. **Anti-consumismo:** il pack dice anche cosa NON comprare all'inizio (nel body e in una FAQ).
6. **Livello principiante** salvo eccezioni. Chi legge inizia da zero.
7. **Italiano naturale**, seconda persona singolare, frasi corte, zero anglicismi inutili, niente "in questo articolo...".
8. **Nessuna promessa medica o di sicurezza** non verificabile. Per salute/bambini/animali: tono prudente, rimanda a professionisti quando serve.

## Campi
- `title`: "Starter pack <Attività>: le 5 cose per <verbo> ..." (max 90 caratteri)
- `description`: 60-200 caratteri, con la keyword dell'attività, da meta description
- `emoji`: una sola emoji rappresentativa
- `level`: `principiante` | `intermedio`
- `tags`: 4-6 tag lowercase
- `products[]`: `name`, `brand`, `role` (2-4 parole, con articolo: "Le scarpe"), `why` (2-3 frasi, il vero motivo), `priceRange`, `amazonQuery`, `asin: ""`, `pros` (2-3), `cons` (0-2), `tip` (1 frase pratica)
- `video.hook`: max 15 parole, ferma lo scroll, niente clickbait falso
- `video.script`: 6 righe. Righe 1-5: "Uno: ... " fino a "Cinque: ...", una per prodotto, max 30 parole, **numeri scritti in lettere** (è un testo per voce sintetica), niente simboli né abbreviazioni. Riga 6: chiusura con budget in lettere e "Trovi i link su mystarterpack punto it. Le cinque cose per iniziare. Punto."
- `video.status: "pending"`
- `faq`: 3 domande (una è sempre "Cosa NON comprare all'inizio?")
- Body markdown (250-450 parole) con esattamente queste sezioni: `## Perché proprio questi 5`, `## Come usare il pack <alla prima ...>` (lista numerata 3-4 punti), `## Il prossimo passo`.

## Categorie valide (`category`)
sport-outdoor, fitness-corpo, casa-cucina, salute-benessere, tech-digitale, hobby-creativita, bambini-famiglia, animali, viaggi, lavoro-studio, giardino-faidate, moda-cura-persona, auto-moto-bici, musica-audio, gaming-streaming
