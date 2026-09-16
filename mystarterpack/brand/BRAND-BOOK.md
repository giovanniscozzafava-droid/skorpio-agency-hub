# MyStarterPack — Brand Book v1.0

> **Le 5 cose per iniziare. Punto.**

## 1. Brand story

Ogni volta che qualcuno decide di iniziare qualcosa (correre, cucinare, prendere un cane, aprire un podcast) succede la stessa cosa: apre Amazon, trova 4.000 risultati, legge 30 recensioni contraddittorie e chiude la scheda. L'inizio muore nella scelta.

MyStarterPack esiste per uccidere quel momento. Per ogni attività umana diciamo **cinque cose**, non cinquanta: le cinque che coprono le esigenze reali di chi parte da zero, scelte con criterio, spiegate con onestà, con un budget chiaro. E diciamo anche cosa **non** comprare.

**Promessa:** in 60 secondi sai cosa ti serve per iniziare e quanto costa.
**Nemico:** la lista infinita, l'overthinking, il "compra tutto e poi vedi".
**Modello economico:** link affiliati Amazon.it. Lo dichiariamo sempre, in chiaro, perché la fiducia è l'unico asset.

## 2. Posizionamento

| Asse | Valore | Perché |
|---|---|---|
| Lusso ↔ Accessibile | 8/10 accessibile | Il pubblico spende 100-400 €, non 4.000. Il tono non intimidisce mai. |
| Tradizionale ↔ Innovativo | 7/10 innovativo | Contenuti generati e distribuiti in automatico, ma l'estetica è pulita, non "AI". |
| Serio ↔ Giocoso | 6/10 giocoso | Complice e diretto, mai comico. Il "Punto." finale è la firma. |
| Esclusivo ↔ Inclusivo | 9/10 inclusivo | Migliaia di attività, tutte trattate con la stessa dignità: dal criceto al sim racing. |

**Brand personality:** Chiaro · Complice · Essenziale.
**Brand voice:** informale, seconda persona singolare, frasi corte, anti-hype. Dice "no" più spesso di quanto dica "compra". Mai "in questo articolo", mai superlativi vuoti, mai clickbait.
**Territorio emotivo:** *sollievo da decisione*. Il pubblico arriva confuso e se ne va sicuro.
**Persona:** Marta, 31 anni, ha appena deciso di iniziare a correre. Non vuole diventare esperta di scarpe: vuole uscire di casa domani mattina senza sbagliare.

## 3. Logo

**Tipologia:** combination mark. Brandmark (il "Pack") + wordmark.

**Il Pack:** un quadrato dagli angoli molto arrotondati (la scatola, il kit) con cinque punti disposti a quinconce, come la faccia del 5 di un dado. Il punto centrale è arancio: è il "tu", il punto di partenza, il pulsante start. Legge "cinque" senza scrivere un numero, funziona a 16 px, in bianco e nero e da 20 metri. Il dado richiama "tirare i dadi": iniziare.

**Wordmark:** `my` in peso Regular, `starterpack` in Bold, punto finale arancio. Tutto minuscolo, spaziatura -1.5: il nome è una frase detta d'un fiato. Il punto arancio è lo stesso del "Punto." del claim.

**Versioni** (in `brand/logo/`): `logo-horizontal.svg` (primaria, su chiaro), `logo-horizontal-negative.svg` (su scuro), `mark.svg` (brandmark, avatar social), `mark-mono.svg` (monocromatico, usa `currentColor`), `favicon.svg`.

**Area di rispetto:** pari al raggio del punto centrale ×2 su ogni lato. **Dimensione minima:** brandmark 24 px, logo orizzontale 120 px di larghezza.

**Vietato:** ruotare il Pack, cambiare la disposizione dei punti, usare più di un punto arancio, aggiungere ombre o gradienti, scrivere "My Starter Pack" con spazi nel logo (nel testo corrente si scrive MyStarterPack).

## 4. Palette

| Ruolo | Nome | HEX | Uso |
|---|---|---|---|
| Primario | Inchiostro | `#1B1F3B` | Logo, titoli, sfondi hero, cover reel. Autorevole senza essere "corporate blu". |
| Accento | Start | `#FF5A36` | Il punto, i numeri 1-5, CTA "Vedi su Amazon", una sola volta per schermata. |
| Secondario | Menta | `#2EC4B6` | Badge "principiante", conferme, elementi "go". Mai per testo lungo. |
| Neutro chiaro | Carta | `#FAF7F2` | Sfondo pagina. Caldo, editoriale, non bianco ospedale. |
| Neutro medio | Nebbia | `#E8E4DD` | Bordi, divisori, card secondarie. |
| Neutro scuro | Grafite | `#2B2B2B` | Testo corrente. |

Regola 60-30-10: 60% Carta, 30% Inchiostro, 10% Start. Le 15 categorie hanno un colore proprio (in `site/src/data/categories.json`) usato solo come tinta della card e della cover reel, mai per il testo.

Contrasti verificati: Grafite su Carta 12.9:1, Carta su Inchiostro 14.6:1, Start su Inchiostro 4.6:1 (solo testo ≥ 18 px bold).

## 5. Tipografia

- **Primario, titoli e numeri:** Space Grotesk (Google Fonts) Bold 700 e Medium 500. Geometrico con carattere: le cifre 1-5 sono un elemento identitario e questo font le disegna bene.
- **Secondario, testo:** Inter Regular 400 e Semibold 600. Leggibile ovunque, neutro, non compete.
- Mai un terzo font. Fallback: `system-ui, -apple-system, Segoe UI, Roboto, sans-serif`.

Gerarchia web: H1 40/44 px (mobile 30), H2 28 px, H3 20 px, Body 17/28 px, Caption 14 px. Prezzi e budget sempre in Space Grotesk Medium con tabular figures.

## 6. Elementi ricorrenti

- **I numeri 1-5:** chip tondo arancio con cifra bianca in Space Grotesk Bold. Compaiono su ogni prodotto, in ogni reel, in ogni carosello. Sono il pattern.
- **Il quinconce:** pattern di sfondo a bassa opacità (5%) derivato dal brandmark, per hero e cover.
- **Angoli:** 16 px su card e immagini, 999 px su chip e bottoni. Mai spigoli vivi.
- **Immagini prodotto:** PNG scontornato su fondo tinta unita (colore della categoria al 12% su Carta), ombra morbida `0 12px 32px rgba(27,31,59,.12)`. Niente foto lifestyle stock.
- **Iconografia:** una emoji per attività (dichiarata nel pack). Nessuna icon-font.
- **Firma testuale:** ogni contenuto chiude con "Punto." Il claim completo compare nel footer e a fine reel.

## 7. Social e video

- **Formato reel:** 1080×1920, 30 fps, 35-50 s. Struttura fissa: hook (3 s, Inchiostro pieno, testo grande) → 5 card prodotto (6-7 s l'una: chip numero, PNG che entra dal basso, nome, ruolo, fascia prezzo) → chiusura con budget totale e logo (5 s).
- **Voce:** Gemini 2.5 TTS, voce `Kore` (chiara, neutra) per default; `Puck` per pack "energici" (sport, gaming). Ritmo naturale, niente effetti. Il testo è scritto per la voce: numeri in lettere, niente simboli.
- **Sottotitoli:** sempre, in Inter Semibold su pillola Inchiostro, perché l'80% guarda senza audio.
- **Caption Instagram:** hook + "Le 5 cose:" con elenco numerato + budget + "Link in bio → mystarterpack.it/pack/<slug>" + disclosure `#adv #affiliazione` + 8-12 hashtag.
- **Avatar:** `mark.svg`. **Bio:** "Le 5 cose per iniziare qualsiasi cosa. Punto. 🎲 Nuovo pack ogni giorno. Link affiliati Amazon."

## 8. Do & Don't

**Do:** dire cosa non comprare; dichiarare l'affiliazione; una CTA per schermata; prezzi come fascia; frasi corte.
**Don't:** "il migliore in assoluto"; countdown e urgenza finta; più di 5 prodotti; emoji nei titoli del sito; promesse mediche; tono da televendita.
