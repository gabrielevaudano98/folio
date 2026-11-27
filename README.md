# Folio

[![CI](https://github.com/gabrielevaudano98/folio/actions/workflows/ci.yml/badge.svg)](https://github.com/gabrielevaudano98/folio/actions/workflows/ci.yml)
[![CodeQL](https://github.com/gabrielevaudano98/folio/actions/workflows/codeql.yml/badge.svg)](https://github.com/gabrielevaudano98/folio/actions/workflows/codeql.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-black)](LICENSE)

> Based on Folio by Gabriele Vaudano (https://github.com/gabrielevaudano98/folio)

Editor Markdown per **macOS e Windows** con un server **MCP** integrato: Claude, Cursor, VS Code, Windsurf, LM Studio, Claude Code (e qualsiasi client MCP) possono leggere, cercare e modificare le tue note, e ogni modifica dell'AI ti appare in tempo reale, evidenziata, con **Annulla** e **Rivedi**.

Le note restano file `.md` normali sul tuo disco. Quattro tipi di documento, ognuno con vista **Visuale** e vista **Codice** (e Split):

| File | Tipo | Vista visuale |
| --- | --- | --- |
| `nome.md` | Pagina | Editor stile Word con barra multifunzione |
| `nome.slides.md` | Slide (slides-md, compatibile Marp) | Miniature, layout, temi, note relatore, presentazione, export PowerPoint e PDF |
| `nome.board.md` | Lavagna (board-md) | Canvas stile draw.io: forme generali, flowchart, UML, ER, architettura, connettori UML, auto-layout, export PNG/SVG |
| `nome.sheet.md` | Foglio (sheet-md) | Griglia stile Excel: formule (~390 funzioni, CERCA.VERT/XLOOKUP), formati, riempimento, copia/incolla con Excel, più fogli, Kanban stile Airtable, export Excel e CSV |

La sintassi completa dei formati è in [`docs/FORMATS.md`](docs/FORMATS.md).

## Funzioni

**Editor**
- **Write (WYSIWYG live)**: titoli, grassetto, corsivo, link, citazioni, liste, checkbox cliccabili, immagini e righe orizzontali appaiono già formattati; la sintassi Markdown ricompare solo sulla riga dove hai il cursore (stile Typora/Obsidian). Tabelle, codice e formule restano in sorgente e si vedono renderizzati in Split/Read
- **Split** (sorgente + anteprima sincronizzati) e **Read** — `⌘1` `⌘2` `⌘3`
- Schede, albero cartelle con drag & drop, rinomina, cestino di sistema
- **Annulla e ripeti ovunque**: `⌘Z` / `⇧⌘Z` (su Windows anche `Ctrl+Y`) valgono per pagine, slide, lavagne e fogli, con la cronologia **separata per ogni scheda** (cambiare scheda non la perde). Pulsanti nella barra del titolo, menu Modifica e palette
- **Annulla azioni sui file**: crea, rinomina, sposta ed elimina si annullano con `⌘⌥Z` (o `⌘Z` con l'elenco file in primo piano, o il pulsante *Annulla* nella notifica). Gli elementi eliminati tornano con il loro contenuto
- **Indietro e avanti tra le note**: `Alt+←` / `Alt+→` (macOS `⌘⌥←` / `⌘⌥→`), pulsanti nella barra, tasti laterali del mouse, swipe sul trackpad
- Salvataggio automatico, ricarica se il file cambia su disco
- Palette comandi `⌘⇧P`, apertura rapida `⌘P`, ricerca in tutte le note `⌘⇧F`, cerca/sostituisci `⌘F`
- Formattazione: `⌘B` `⌘I` `⌘K` (link) `⌘E` (codice) `⌘L` (task), liste che continuano con Invio
- Incolla o trascina immagini e allegati → salvati nella cartella nascosta `.asset/` accanto alla nota
- Indice ("On this page") con sezione corrente, modalità Focus `⌘.`
- Esporta in **PDF** e **HTML**

**Slide** (`.slides.md`, compatibili Marp)
- Editor visuale stile PowerPoint: oggetti posizionati liberamente (testo, forme, linee e connettori, icone, immagini, video, tabelle, grafici, equazioni, diagrammi SmartArt, forme libere), allinea/distribuisci/raggruppa, pannello Formato, unione di forme
- **Template**: galleria con 8 template (colori, font, sfondi, master con segnaposto per titolo e testo, varianti di colore), template tuoi nella cartella `Templates/`, "Salva come template". Guida: [docs/TEMPLATES.md](docs/TEMPLATES.md)
- Master, sezioni, slide nascoste, ordinamento, struttura, commenti, trova e sostituisci, controllo accessibilità, Design ideas, riferimenti vivi ad altri documenti
- Transizioni (24 effetti e Morph), animazioni di entrata, enfasi, uscita e percorsi, con pannello Animazioni
- Link su qualsiasi oggetto, Zoom di slide e sezioni, presentazioni personalizzate, loop, kiosk e avanzamento automatico
- Vista relatore con finestra per il pubblico, penna, evidenziatore, laser, schermo nero, lente, prove dei tempi, registrazione della narrazione e domande del pubblico in rete locale
- Strumenti MCP per lavorare sulle slide oggetto per oggetto (posizione, stile, animazioni, link, alt text, note, idee di design)
- Presentazione, esportazione PDF, stampati (handout) e pagine note
- PowerPoint in entrata e in uscita: export .pptx fedele 1:1 con master, layout con segnaposto e colori del tema; import di .pptx come deck e di .potx come template

**Anteprima**
- GitHub Flavored Markdown, task cliccabili (aggiornano il sorgente), tabelle, note a piè di pagina
- Callout `> [!NOTE]`, `[!TIP]`, `[!WARNING]`…
- `[[Wiki link]]` tra note (crea la nota se manca)
- Diagrammi **Mermaid**, formule **KaTeX**, codice evidenziato, front-matter YAML

**Design**
- Stile Apple: font di sistema (SF Pro / Segoe UI Variable), barra laterale traslucida (vibrancy su macOS, Mica su Windows), tema chiaro/scuro automatico
- Palette **solo scala di grigi + bianco/nero**: l'accento è il nero (bianco in modalità scura); stati e differenze sono resi con peso, filetti, segni +/− e parole, mai con il colore
- Seguite le regole di [Hallmark](https://github.com/nutlope/hallmark) per le "app screen": token OKLCH, nessuna etichetta in maiuscoletto, focus visibile ovunque, `prefers-reduced-motion`, stati vuoti/caricamento/errore disegnati, colore usato solo come segnale

**Altro**
- Interfaccia in **italiano e inglese** (Impostazioni → Lingua)
- **Cronologia delle versioni** per ogni documento (anche i commit git), confronto e ripristino
- **Registratore di riunioni** opzionale (Windows): trascrizione locale con Whisper e note verificate sulla trascrizione; nulla lascia il computer
- Stato del progetto, lavori in corso e prossimi passi: [docs/STATUS.md](docs/STATUS.md). Documentazione completa: [docs/README.md](docs/README.md)

## Collegare la tua AI

Apri **AI → Connect AI Assistants…** (`⌘⇧A`) oppure clicca il riquadro in basso nella barra laterale:

| App | Come |
| --- | --- |
| Claude Desktop, Cursor, VS Code, Windsurf, LM Studio | Pulsante **Connect** (scrive la config MCP e fa un backup della precedente). Poi riavvia l'app. |
| Claude Code | Copia il comando `claude mcp add folio …` mostrato nel pannello |
| Altri client | URL Streamable HTTP `http://127.0.0.1:47321/mcp` + token Bearer (dal pannello) |

Il bridge stdio usa l'eseguibile stesso di Folio (`--mcp-stdio`), quindi **non serve installare Node**. Se Folio è aperto, le chiamate passano dall'app (evidenziazioni live, undo, nota aperta); se è chiuso, lavora direttamente sull'ultima cartella aperta.

**Strumenti MCP:** 41 strumenti, tra cui `list_notes`, `read_note`, `search_notes`, `get_outline`, `read_section`/`replace_section`, `edit_note` (trova/sostituisci esatto), `suggest_edit` e `add_comment` (proposte da accettare o rifiutare), `get_sheet_values`, la cronologia delle versioni e gli strumenti per le slide oggetto per oggetto. Elenco completo: [docs/reference/mcp-tools.md](docs/reference/mcp-tools.md).

**Sicurezza:** server solo su `127.0.0.1` con token e controllo Host/Origin; nessun accesso fuori dalla cartella aperta; scrittura solo su `.md/.markdown/.mdx/.txt`; interruttore "Let AI edit notes" per la sola lettura.

## Compilare

Requisiti: Node 22.

```bash
npm install
npm start              # sviluppo
npm run test:mcp       # test end-to-end del server MCP
npm run dist:mac       # su un Mac → release/Folio-<versione>-universal.dmg
npm run dist:win       # su Windows → installer x64/arm64 + portable
```

Il workflow `.github/workflows/release.yml` compila **macOS (.dmg universale)** e **Windows (.exe)** e pubblica una release quando un merge su `main` cambia la versione in `package.json` (vedi [docs/how-to/release.md](docs/how-to/release.md)).

### Firma
Senza certificati l'app non è firmata: su macOS la prima apertura va fatta con clic destro → Apri; su Windows SmartScreen chiede conferma. Per macOS il workflow di release è pronto: aggiungi i secret indicati in `release.yml` (certificato Developer ID e notarizzazione Apple). La firma per Windows non è ancora configurata (issue #4).

### Aggiornamenti
Folio controlla le release su GitHub (Impostazioni → Aggiornamenti; si può spegnere). L'installer Windows può scaricare e installare l'aggiornamento dopo la tua conferma, anche senza firma. Su macOS (senza firma Developer ID il sistema rifiuta gli aggiornamenti automatici) e nel portable Folio avvisa e apre la pagina della release. Dettagli in [docs/explanation/updates.md](docs/explanation/updates.md).

## Struttura

```
src/main/main.js        processo principale: finestra, file, watcher, server MCP HTTP, connessioni
src/main/notes.js       operazioni sulle note (condivise da app e MCP)
src/main/mcp-tools.js   definizione degli strumenti MCP
src/mcp/stdio.js        bridge stdio per i client MCP
src/renderer/rich.js    editor visuale delle pagine (TipTap 3)
src/renderer/slides*.js motore slides-md, editor, export PowerPoint (pptxgenjs)
src/renderer/board*.js  motore board-md e canvas (SVG, dagre per l'auto-layout)
src/renderer/sheet*.js  motore sheet-md, griglia, export Excel (hot-formula-parser, JSZip)
src/renderer/           interfaccia (CodeMirror 6, markdown-it, token di design)
build.mjs               build con esbuild
```

Ogni file di `src/`, una riga ciascuno: [docs/reference/source-map.md](docs/reference/source-map.md).

## Licenza

Folio è software libero sotto **GNU AGPL-3.0** (vedi [LICENSE](LICENSE)), con un termine aggiuntivo di attribuzione ai sensi della sezione 7(b) (vedi [NOTICE](NOTICE)):

- puoi usarlo, studiarlo, modificarlo e distribuirlo, anche commercialmente;
- se distribuisci una versione modificata **o la offri come servizio in rete**, devi pubblicarne il codice sorgente completo sotto AGPL-3.0;
- devi conservare, senza modificarla, l'attribuzione **"Based on Folio by Gabriele Vaudano (https://github.com/gabrielevaudano98/folio)"** nel NOTICE, nel README e nella finestra Informazioni.

Il progetto chiede inoltre di riportare ogni miglioramento con una pull request su `main`: vedi [CONTRIBUTING.md](CONTRIBUTING.md).

## Sviluppo e qualità

- `npm test` esegue i test di round-trip dei formati, i test MCP end-to-end e uno smoke test dell'interfaccia (su Linux con `xvfb-run`).
- La CI (GitHub Actions) li esegue a ogni push e pull request, poi crea i pacchetti Windows e macOS; i tag `v*` pubblicano una release.
- CodeQL analizza la sicurezza, Dependabot aggiorna le dipendenze.
- Review con agenti: [cubic](https://cubic.dev) legge `cubic.yaml` e `AGENTS.md`; scrivendo `@claude` in una issue o PR risponde Claude Code (serve il secret `ANTHROPIC_API_KEY`).
- Roadmap: [docs/ROADMAP.md](docs/ROADMAP.md) e le Issues del repository.
