#!/usr/bin/env node
/**
 * codebase-memory — server MCP locale (stdio, zero dipendenze).
 *
 * Memoria di progetto che vive dentro il repository: ogni voce è un file markdown in
 * .claude/memory/<categoria>/<chiave>.md con un blocco di metadati in testa.
 * Versionata in git, leggibile da una persona, condivisa da tutte le sessioni che aprono questo repo.
 *
 * Protocollo: JSON-RPC 2.0 su stdio, messaggi separati da newline (trasporto stdio di MCP).
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.CODEBASE_MEMORY_DIR || path.resolve(HERE, '..', '..', 'memory');
const PROTOCOL_FALLBACK = '2025-06-18';
const SERVER_INFO = { name: 'codebase-memory', title: 'Memoria di progetto', version: '1.0.0' };

fs.mkdirSync(ROOT, { recursive: true });

// ---------------------------------------------------------------- archivio

const SAFE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const slug = (s) =>
  String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

function validName(value, what) {
  const raw = String(value || '');
  if (/[\\/]|\.\./.test(raw)) throw new McpError(`${what} non valida: "${raw}" contiene separatori di percorso. Usa un nome semplice come "infra".`);
  const s = slug(raw);
  if (!SAFE.test(s)) throw new McpError(`${what} non valida: "${value}". Usa lettere minuscole, numeri e trattini, per esempio "chiave-gemini".`);
  return s;
}

class McpError extends Error {}

function entryPath(category, key) { return path.join(ROOT, category, `${key}.md`); }

function listFiles() {
  const out = [];
  for (const cat of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!cat.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(ROOT, cat.name))) {
      if (f.endsWith('.md')) out.push({ category: cat.name, key: f.replace(/\.md$/, ''), file: path.join(ROOT, cat.name, f) });
    }
  }
  return out;
}

function parseEntry(file, category, key) {
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta = {}; let body = raw;
  if (m) {
    body = m[2];
    for (const line of m[1].split('\n')) {
      const i = line.indexOf(':');
      if (i === -1) continue;
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      if (v.startsWith('[') && v.endsWith(']')) meta[k] = v.slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean);
      else meta[k] = v;
    }
  }
  return {
    key, category,
    title: meta.title || key,
    tags: Array.isArray(meta.tags) ? meta.tags : (meta.tags ? [meta.tags] : []),
    importance: meta.importance || 'normale',
    updated: meta.updated || '',
    content: body.trim(),
    file,
  };
}

function readAll() {
  return listFiles().map((f) => parseEntry(f.file, f.category, f.key))
    .sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
}

function writeEntry({ key, category, title, content, tags = [], importance = 'normale' }) {
  const cat = validName(category, 'categoria');
  const k = validName(key, 'chiave');
  const dir = path.join(ROOT, cat);
  fs.mkdirSync(dir, { recursive: true });
  const file = entryPath(cat, k);
  const existed = fs.existsSync(file);
  const front = [
    '---',
    `title: ${title || k}`,
    `tags: [${tags.map(slug).filter(Boolean).join(', ')}]`,
    `importance: ${['alta', 'normale', 'bassa'].includes(importance) ? importance : 'normale'}`,
    `updated: ${new Date().toISOString().slice(0, 10)}`,
    '---',
    '',
  ].join('\n');
  fs.writeFileSync(file, front + String(content).trim() + '\n');
  return { file: path.relative(process.cwd(), file), created: !existed, category: cat, key: k };
}

const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function search(query, { category, tag, limit = 10 } = {}) {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  const scored = [];
  for (const e of readAll()) {
    if (category && e.category !== slug(category)) continue;
    if (tag && !e.tags.map(norm).includes(norm(tag))) continue;
    const hay = norm([e.key, e.title, e.tags.join(' '), e.category, e.content].join('\n'));
    if (terms.length && !terms.every((t) => hay.includes(t))) continue;
    let score = terms.reduce((acc, t) => acc + (norm(e.title + ' ' + e.key).includes(t) ? 3 : 0) + (hay.split(t).length - 1), 0);
    if (e.importance === 'alta') score += 2;
    scored.push({ e, score });
  }
  return scored.sort((a, b) => b.score - a.score || (b.e.updated || '').localeCompare(a.e.updated || '')).slice(0, limit).map((s) => s.e);
}

const snippet = (e, n = 220) => e.content.replace(/\s+/g, ' ').slice(0, n) + (e.content.length > n ? '…' : '');
const asRef = (e) => `${e.category}/${e.key}`;

// ---------------------------------------------------------------- strumenti

const TOOLS = [
  {
    name: 'memory_search',
    title: 'Cerca nella memoria di progetto',
    description: 'Cerca fatti, decisioni e convenzioni salvati per questo repository. Usalo PRIMA di chiedere qualcosa che potrebbe essere già stato deciso o spiegato in una sessione precedente (chiavi e segreti, scelte di strategia, stato dei progetti, convenzioni). Restituisce un estratto per ogni voce trovata: leggi il testo completo con memory_read.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Parole chiave, per esempio "chiave gemini" o "strategia mystarterpack". Vuoto per elencare le voci più recenti.' },
        category: { type: 'string', description: 'Limita a una categoria, per esempio "infra" o "mystarterpack".' },
        tag: { type: 'string', description: 'Limita a un tag.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'memory_read',
    title: 'Leggi voci di memoria',
    description: 'Restituisce il testo completo di una o più voci, indicate come "categoria/chiave" (il riferimento che compare nei risultati di memory_search).',
    inputSchema: {
      type: 'object',
      required: ['refs'],
      properties: { refs: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20, description: 'Per esempio ["infra/chiave-gemini"].' } },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'memory_write',
    title: 'Salva o aggiorna una voce di memoria',
    description: 'Scrive un fatto duraturo su questo repository, così le sessioni future non devono riscoprirlo. Salva: decisioni prese e il loro motivo, dove vivono chiavi e credenziali (mai il valore), convenzioni, stato dei progetti, trappole già incontrate. Non salvare: segreti, dati personali, cose vere solo oggi, o ciò che si legge già nel codice. Riscrivere la stessa chiave aggiorna la voce.',
    inputSchema: {
      type: 'object',
      required: ['category', 'key', 'title', 'content'],
      properties: {
        category: { type: 'string', description: 'Raggruppamento in minuscolo, per esempio "infra", "mystarterpack", "convenzioni", "fuyue".' },
        key: { type: 'string', description: 'Identificativo breve in minuscolo con trattini, per esempio "chiave-gemini".' },
        title: { type: 'string', description: 'Titolo leggibile di una riga.' },
        content: { type: 'string', description: 'Il fatto in markdown. Scrivi perché, non solo cosa. Includi date e percorsi di file quando servono.' },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 8 },
        importance: { type: 'string', enum: ['alta', 'normale', 'bassa'], default: 'normale', description: '"alta" per ciò che va letto a ogni inizio sessione.' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'memory_delete',
    title: 'Elimina una voce di memoria',
    description: 'Rimuove una voce non più vera o non più utile. Indicala come "categoria/chiave".',
    inputSchema: { type: 'object', required: ['ref'], properties: { ref: { type: 'string' } } },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'memory_brief',
    title: 'Riepilogo di apertura',
    description: 'Elenca le voci a importanza alta più le più recenti: è il modo più rapido per riprendere il contesto del repository a inizio sessione.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 40, default: 12 } } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

function callTool(name, args = {}) {
  switch (name) {
    case 'memory_search': {
      const found = search(args.query || '', args);
      if (!found.length) return { text: 'Nessuna voce trovata. Con memory_write puoi aggiungerla.', data: { results: [] } };
      return {
        text: found.map((e) => `- ${asRef(e)} · ${e.title}${e.importance === 'alta' ? ' (alta)' : ''}\n  ${snippet(e)}`).join('\n'),
        data: { results: found.map((e) => ({ ref: asRef(e), title: e.title, tags: e.tags, importance: e.importance, updated: e.updated })) },
      };
    }
    case 'memory_read': {
      const out = [];
      for (const ref of args.refs) {
        const [cat, key] = String(ref).split('/');
        const file = entryPath(slug(cat), slug(key));
        if (!fs.existsSync(file)) { out.push({ ref, error: 'non trovata' }); continue; }
        const e = parseEntry(file, slug(cat), slug(key));
        out.push({ ref: asRef(e), title: e.title, updated: e.updated, importance: e.importance, tags: e.tags, content: e.content });
      }
      return {
        text: out.map((e) => (e.error ? `## ${e.ref}\nVoce non trovata.` : `## ${e.ref} · ${e.title}\n(aggiornata il ${e.updated})\n\n${e.content}`)).join('\n\n'),
        data: { entries: out },
      };
    }
    case 'memory_write': {
      const r = writeEntry(args);
      return { text: `${r.created ? 'Creata' : 'Aggiornata'} la voce ${r.category}/${r.key} in ${r.file}`, data: r };
    }
    case 'memory_delete': {
      const [cat, key] = String(args.ref).split('/');
      const file = entryPath(slug(cat), slug(key));
      if (!fs.existsSync(file)) throw new McpError(`Voce "${args.ref}" non trovata. Elenca quelle esistenti con memory_search.`);
      fs.unlinkSync(file);
      return { text: `Eliminata la voce ${args.ref}`, data: { ref: args.ref, deleted: true } };
    }
    case 'memory_brief': {
      const all = readAll();
      const alta = all.filter((e) => e.importance === 'alta');
      const resto = all.filter((e) => e.importance !== 'alta').slice(0, Math.max(0, (args.limit || 12) - alta.length));
      const fmt = (e) => `- ${asRef(e)} · ${e.title}\n  ${snippet(e, 160)}`;
      return {
        text: [
          `Memoria di progetto: ${all.length} voci.`,
          alta.length ? `\nDa sapere sempre:\n${alta.map(fmt).join('\n')}` : '',
          resto.length ? `\nAggiornate di recente:\n${resto.map(fmt).join('\n')}` : '',
        ].filter(Boolean).join('\n'),
        data: { total: all.length, always: alta.map(asRef), recent: resto.map(asRef) },
      };
    }
    default:
      throw new McpError(`Strumento sconosciuto: ${name}`);
  }
}

// ---------------------------------------------------------------- protocollo

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

function handle(msg) {
  const { id, method, params = {} } = msg;
  if (id === undefined || id === null) return; // notifica: niente risposta
  try {
    switch (method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: params.protocolVersion || PROTOCOL_FALLBACK,
          capabilities: { tools: {}, resources: {} },
          serverInfo: SERVER_INFO,
          instructions: 'Memoria di progetto versionata in git. Consulta memory_brief a inizio sessione e memory_search prima di chiedere qualcosa che potrebbe essere già stato deciso. Salva con memory_write i fatti duraturi, mai i valori dei segreti.',
        });
      case 'ping':
        return reply(id, {});
      case 'tools/list':
        return reply(id, { tools: TOOLS });
      case 'tools/call': {
        const { text, data } = callTool(params.name, params.arguments || {});
        return reply(id, { content: [{ type: 'text', text }], structuredContent: data });
      }
      case 'resources/list':
        return reply(id, {
          resources: readAll().map((e) => ({
            uri: `memory://${asRef(e)}`, name: e.title, description: snippet(e, 120), mimeType: 'text/markdown',
          })),
        });
      case 'resources/read': {
        const uri = String(params.uri || '');
        const ref = uri.replace(/^memory:\/\//, '');
        const [cat, key] = ref.split('/');
        const file = entryPath(slug(cat), slug(key));
        if (!fs.existsSync(file)) return fail(id, -32602, `Risorsa non trovata: ${uri}`);
        return reply(id, { contents: [{ uri, mimeType: 'text/markdown', text: fs.readFileSync(file, 'utf8') }] });
      }
      case 'prompts/list':
        return reply(id, { prompts: [] });
      default:
        return fail(id, -32601, `Metodo non gestito: ${method}`);
    }
  } catch (err) {
    if (err instanceof McpError) {
      return reply(id, { content: [{ type: 'text', text: `Errore: ${err.message}` }], isError: true });
    }
    return fail(id, -32603, `Errore interno: ${err.message}`);
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const t = line.trim();
  if (!t) return;
  let msg;
  try { msg = JSON.parse(t); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON non valido' } }); }
  if (Array.isArray(msg)) msg.forEach(handle); else handle(msg);
});
