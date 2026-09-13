// Throwaway analyzer v3: columns referenced ONLY by schema/migration plumbing.
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const sql = fs.readFileSync(path.join(ROOT, 'src', 'database', 'schema', 'database.sql'), 'utf-8');
const CONN = path.join(ROOT, 'src', 'database', 'config', 'connection.ts');

function extractTables(text) {
  const tables = new Map();
  const re = /CREATE TABLE IF NOT EXISTS\s+([a-z_]+)\s*\(/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    let i = re.lastIndex, depth = 1, body = '';
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) break; }
      body += ch; i++;
    }
    tables.set(name, body);
  }
  return tables;
}

function extractColumns(body) {
  const cols = [];
  let depth = 0, current = '';
  const segs = [];
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { segs.push(current); current = ''; }
    else current += ch;
  }
  if (current.trim()) segs.push(current);
  for (const raw of segs) {
    const s = raw.replace(/--[^\n]*/g, '').trim();
    if (!s) continue;
    if (/^(FOREIGN|PRIMARY|UNIQUE|CHECK|CONSTRAINT)\b/i.test(s)) continue;
    const first = s.split(/\s+/)[0];
    if (/^[a-z_][a-z0-9_]*$/i.test(first)) cols.push(first);
  }
  return cols;
}

function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'release'].includes(entry.name)) continue;
      walk(p, out);
    } else if (/\.(ts|tsx|js|cjs|mjs)$/.test(entry.name)) {
      if (p.includes(path.join('database', 'schema'))) continue;
      out.push(p);
    }
  }
}

const files = [];
walk(path.join(ROOT, 'src'), files);
walk(path.join(ROOT, 'electron'), files);

// Code EXCLUDING the migration/schema plumbing (connection.ts).
const nonPlumbing = files.filter(f => f !== CONN).map(f => fs.readFileSync(f, 'utf-8')).join('\n');

const tables = extractTables(sql);
const plumbingOnly = [];
const zeroAnywhere = [];
for (const [table, body] of tables) {
  for (const col of extractColumns(body)) {
    const re = new RegExp(`\\b${col}\\b`, 'g');
    const n = (nonPlumbing.match(re) || []).length;
    if (n === 0) plumbingOnly.push(`${table}.${col}`);
    const any = (nonPlumbing.match(re) || []).length + ((fs.readFileSync(CONN, 'utf-8').match(re) || []).length);
    if (any === 0) zeroAnywhere.push(`${table}.${col}`);
  }
}

console.log('COLUMNS_ONLY_IN_SCHEMA_OR_CONNECTION=' + plumbingOnly.length);
for (const c of plumbingOnly) console.log('  ' + c);
console.log('COLUMNS_NOWHERE_AT_ALL=' + zeroAnywhere.length);
for (const c of zeroAnywhere) console.log('  ' + c);
