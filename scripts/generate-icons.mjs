// Génère les icônes de l'application StockLocal à partir du logo vectoriel
// `build/icon.svg` (source de vérité). Produit :
//   - build/icon.png      : 1024x1024 (icône fenêtre, repli, source electron-builder)
//   - build/icon.ico      : multi-résolutions (16→256) pour Windows (taskbar, raccourci, installeur NSIS)
//   - public/logo.png     : 512x512 (copiée par Vite dans dist/, favicon + icône de fenêtre)
//
// Usage : npm run icons
import fs from 'node:fs';
import sharp from 'sharp';

const SVG_PATH = 'build/icon.svg';
const svg = fs.readFileSync(SVG_PATH);

/** Rend le SVG à une taille carrée donnée → Buffer PNG. */
function renderPng(size) {
  return sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

/** Construit un fichier .ico (entrées PNG, supporté par Windows Vista+). */
function buildIco(entries) {
  const headerSize = 6;
  const entrySize = 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // réservé
  header.writeUInt16LE(1, 2); // type = icône
  header.writeUInt16LE(entries.length, 4);

  let offset = headerSize + entrySize * entries.length;
  const directory = [];
  for (const { size, buf } of entries) {
    const e = Buffer.alloc(entrySize);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // largeur (0 = 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1); // hauteur (0 = 256)
    e.writeUInt8(0, 2); // nombre de couleurs
    e.writeUInt8(0, 3); // réservé
    e.writeUInt16LE(1, 4); // plans
    e.writeUInt16LE(32, 6); // bits par pixel
    e.writeUInt32LE(buf.length, 8); // taille des données
    e.writeUInt32LE(offset, 12); // décalage des données
    offset += buf.length;
    directory.push(e);
  }

  return Buffer.concat([header, ...directory, ...entries.map((e) => e.buf)]);
}

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

await fs.promises.mkdir('public', { recursive: true });

await fs.promises.writeFile('build/icon.png', await renderPng(1024));
await fs.promises.writeFile('public/logo.png', await renderPng(512));

const icoEntries = [];
for (const size of ICO_SIZES) {
  icoEntries.push({ size, buf: await renderPng(size) });
}
await fs.promises.writeFile('build/icon.ico', buildIco(icoEntries));

console.log('Icônes générées : build/icon.png, build/icon.ico, public/logo.png');
