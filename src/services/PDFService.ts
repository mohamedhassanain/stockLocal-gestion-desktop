import { PDFDocument, rgb, StandardFonts, type PDFImage, type PDFFont } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import qrcode from 'qrcode-generator';
import type { Customer, ClientCredit } from '../repositories/ClientRepository';
import type { Supplier, SupplierCredit } from '../repositories/SupplierRepository';
import type { Document, Payment } from '../repositories/DocumentRepository';
import type { Product } from '../repositories/ProductRepository';
import { CompanySettingsService } from './CompanySettingsService';
import { DashboardRepository } from '../repositories/DashboardRepository';
import { encodeBarcode, barsFromModules, moduleCount } from '../domain/barcode/labelBarcode';

function truncate(text: string, max: number): string {
  return text.length > max ? text.substring(0, max) + '…' : text;
}

/**
 * Découpe un texte en lignes tenant dans une largeur donnée.
 * Utilisé pour la colonne Désignation (les désignations longues ne doivent
 * jamais déborder du tableau).
 */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    // Un mot seul plus large que la colonne → on le coupe
    while (font.widthOfTextAtSize(current, size) > maxWidth) {
      let split = current.length - 1;
      while (split > 0 && font.widthOfTextAtSize(current.slice(0, split), size) > maxWidth) split--;
      lines.push(current.slice(0, split));
      current = current.slice(split);
    }
  }
  if (current) lines.push(current);
  return lines;
}

export const PDFService = {
  async generateClientStatement(client: Customer, history: ClientCredit[]): Promise<string> {
    const settings = CompanySettingsService.getAll();
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let y = height - 50;

    // ── En-tête : logo + nom CENTRÉS ensemble, titre à GAUCHE sous le bloc ──
    const nameText = settings.name || 'StockLocal';
    const titleText = 'Relevé de Compte (Client)';
    const nameSize = 20;
    const titleSize = 16;
    const logoW = 72, logoH = 36, logoGap = 14;
    let logoImage: PDFImage | null = null;
    if (settings.show_logo_on_documents && settings.logo_path && fs.existsSync(settings.logo_path)) {
      try {
        const logoBytes = fs.readFileSync(settings.logo_path);
        const ext = path.extname(settings.logo_path).toLowerCase();
        logoImage = ext === '.png' ? await pdfDoc.embedPng(logoBytes) : await pdfDoc.embedJpg(logoBytes);
      } catch { logoImage = null; }
    }
    const showName = settings.show_company_name_on_documents;
    const nameW = showName ? boldFont.widthOfTextAtSize(nameText, nameSize) : 0;
    const headerTotalW = (logoImage ? logoW + logoGap : 0) + nameW;
    const headerStartX = (width - headerTotalW) / 2;
    // Logo + nom CENTRÉS ensemble (même ligne) — logo à gauche du nom
    if (logoImage) {
      page.drawImage(logoImage, { x: headerStartX, y: y - 12, width: logoW, height: logoH });
    }
    if (showName) {
      page.drawText(nameText, { x: headerStartX + (logoImage ? logoW + logoGap : 0), y, size: nameSize, font: boldFont, color: rgb(0.1, 0.2, 0.4) });
    }
    y -= 40; // saut de ligne avant le titre
    // Titre à GAUCHE
    page.drawText(titleText, { x: 50, y, size: titleSize, font: boldFont, color: rgb(0.1, 0.2, 0.4) });
    y -= 28;

    page.drawText(`Client: ${client.name}`, { x: 50, y, size: 14, font: boldFont });
    y -= 20;
    if (client.phone) {
      page.drawText(`Tél: ${client.phone}`, { x: 50, y, size: 12, font });
      y -= 15;
    }

    const balance = client.balance ?? 0;
    page.drawText(`Solde actuel: ${balance.toFixed(2)} MAD`, {
      x: 50, y, size: 14, font: boldFont, color: balance > 0 ? rgb(0.8, 0.1, 0.1) : rgb(0.1, 0.6, 0.1)
    });

    y -= 40;

    page.drawText('Date', { x: 50, y, size: 12, font: boldFont });
    page.drawText('Type', { x: 150, y, size: 12, font: boldFont });
    page.drawText('Description', { x: 250, y, size: 12, font: boldFont });
    page.drawText('Montant', { x: 450, y, size: 12, font: boldFont });

    y -= 10;
    page.drawLine({ start: { x: 50, y }, end: { x: 550, y }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
    y -= 20;

    for (const item of history) {
      if (y < 50) {
        page = pdfDoc.addPage();
        y = height - 50;
      }
      const dateStr = new Date(item.date).toLocaleDateString();
      const typeStr = item.type === 'CREDIT' ? 'Dette' : 'Paiement';
      const color = item.type === 'CREDIT' ? rgb(0.8, 0.1, 0.1) : rgb(0.1, 0.6, 0.1);

      page.drawText(dateStr, { x: 50, y, size: 10, font });
      page.drawText(typeStr, { x: 150, y, size: 10, font, color });
      page.drawText(truncate(item.description || '', 30), { x: 250, y, size: 10, font });
      page.drawText(`${item.amount.toFixed(2)} MAD`, { x: 450, y, size: 10, font: boldFont, color });

      y -= 20;
    }

    const pdfBytes = await pdfDoc.save();
    const documentsPath = app.getPath('documents');
    const safeName = client.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filePath = path.join(documentsPath, `Releve_${safeName}_${Date.now()}.pdf`);

    fs.writeFileSync(filePath, pdfBytes);
    return filePath;
  },

  async generateSupplierStatement(supplier: Supplier, history: SupplierCredit[]): Promise<string> {
    const settings = CompanySettingsService.getAll();
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let y = height - 50;

    // ── En-tête : logo + nom CENTRÉS ensemble, titre à GAUCHE sous le bloc ──
    const nameText = settings.name || 'StockLocal';
    const titleText = 'Relevé de Compte (Fournisseur)';
    const nameSize = 20;
    const titleSize = 16;
    const logoW = 72, logoH = 36, logoGap = 14;
    let logoImage: PDFImage | null = null;
    if (settings.show_logo_on_documents && settings.logo_path && fs.existsSync(settings.logo_path)) {
      try {
        const logoBytes = fs.readFileSync(settings.logo_path);
        const ext = path.extname(settings.logo_path).toLowerCase();
        logoImage = ext === '.png' ? await pdfDoc.embedPng(logoBytes) : await pdfDoc.embedJpg(logoBytes);
      } catch { logoImage = null; }
    }
    const showName = settings.show_company_name_on_documents;
    const nameW = showName ? boldFont.widthOfTextAtSize(nameText, nameSize) : 0;
    const headerTotalW = (logoImage ? logoW + logoGap : 0) + nameW;
    const headerStartX = (width - headerTotalW) / 2;
    // Logo + nom CENTRÉS ensemble (même ligne) — logo à gauche du nom
    if (logoImage) {
      page.drawImage(logoImage, { x: headerStartX, y: y - 12, width: logoW, height: logoH });
    }
    if (showName) {
      page.drawText(nameText, { x: headerStartX + (logoImage ? logoW + logoGap : 0), y, size: nameSize, font: boldFont, color: rgb(0.1, 0.2, 0.4) });
    }
    y -= 40; // saut de ligne avant le titre
    // Titre à GAUCHE
    page.drawText(titleText, { x: 50, y, size: titleSize, font: boldFont, color: rgb(0.1, 0.2, 0.4) });
    y -= 28;

    page.drawText(`Fournisseur: ${supplier.name}`, { x: 50, y, size: 14, font: boldFont });
    y -= 20;
    if (supplier.phone) {
      page.drawText(`Tél: ${supplier.phone}`, { x: 50, y, size: 12, font });
      y -= 15;
    }
    if (supplier.ice) {
      page.drawText(`ICE: ${supplier.ice}`, { x: 50, y, size: 12, font });
      y -= 15;
    }

    const balance = supplier.balance ?? 0;
    page.drawText(`Solde actuel: ${balance.toFixed(2)} MAD`, {
      x: 50, y, size: 14, font: boldFont, color: balance > 0 ? rgb(0.8, 0.1, 0.1) : rgb(0.1, 0.6, 0.1)
    });

    y -= 40;

    page.drawText('Date', { x: 50, y, size: 12, font: boldFont });
    page.drawText('Type', { x: 150, y, size: 12, font: boldFont });
    page.drawText('Description', { x: 250, y, size: 12, font: boldFont });
    page.drawText('Montant', { x: 450, y, size: 12, font: boldFont });

    y -= 10;
    page.drawLine({ start: { x: 50, y }, end: { x: 550, y }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
    y -= 20;

    for (const item of history) {
      if (y < 50) {
        page = pdfDoc.addPage();
        y = height - 50;
      }
      const dateStr = new Date(item.date).toLocaleDateString();
      const typeStr = item.type === 'DEBT' ? 'Dette' : 'Paiement';
      const color = item.type === 'DEBT' ? rgb(0.8, 0.1, 0.1) : rgb(0.1, 0.6, 0.1);

      page.drawText(dateStr, { x: 50, y, size: 10, font });
      page.drawText(typeStr, { x: 150, y, size: 10, font, color });
      page.drawText(truncate(item.description || '', 30), { x: 250, y, size: 10, font });
      page.drawText(`${item.amount.toFixed(2)} MAD`, { x: 450, y, size: 10, font: boldFont, color });

      y -= 20;
    }

    const pdfBytes = await pdfDoc.save();
    const documentsPath = app.getPath('documents');
    const safeName = supplier.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filePath = path.join(documentsPath, `Releve_Fournisseur_${safeName}_${Date.now()}.pdf`);

    fs.writeFileSync(filePath, pdfBytes);
    return filePath;
  },

  /**
   * Génère un PDF pour un document commercial (Devis, BL, Facture, Avoir)
   * — format A4 portrait, mise en page inspirée de la facture professionnelle
   * de référence (bandeaux colorés, double rangée d'en-tête, bloc de totaux).
   *
   * Les valeurs affichées proviennent UNIQUEMENT du moteur métier
   * (DocumentRepository/DocumentService) : aucune recalcul ici. Les
   * coordonnées de l'entreprise viennent de CompanySettingsService (jamais
   * de valeurs codées en dur).
   */
  async generateDocument(doc: Document): Promise<string> {
    const settings = CompanySettingsService.getAll();
    const { DocumentRepository } = await import('../repositories/DocumentRepository');
    const { ClientRepository } = await import('../repositories/ClientRepository');
    const payments: Payment[] = DocumentRepository.getPayments(doc.id);
    const customer = ClientRepository.getById(doc.entity_id);

    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const MARGIN = 30;
    const RIGHT = width - MARGIN;
    const BOTTOM = 46;

    const TYPE_TITLES: Record<string, string> = {
      QUOTE: 'Devis N°',
      DELIVERY_NOTE: 'Bon de Livraison N°',
      INVOICE: 'Facture N°',
      CREDIT_NOTE: 'Avoir N°',
    };
    const titleLabel = TYPE_TITLES[doc.type] || doc.type;

    const STATUS_LABELS: Record<string, string> = {
      PAID: 'PAYÉE', UNPAID: 'IMPAYÉE', PARTIAL: 'PARTIELLEMENT PAYÉE',
      DRAFT: 'BROUILLON', CANCELLED: 'ANNULÉE'
    };
    const PAYMENT_LABELS: Record<string, string> = {
      CASH: 'Espèces', CHECK: 'Chèque', TRANSFER: 'Virement'
    };

    // Palette inspirée de la référence : bandeaux pêche / saumon
    const PEACH_HEADER = rgb(0.97, 0.80, 0.64);
    const PEACH_TOTAL = rgb(0.95, 0.72, 0.53);
    const BORDER = rgb(0.35, 0.34, 0.33);
    const TEXT = rgb(0.12, 0.12, 0.12);
    const MUTED = rgb(0.45, 0.44, 0.43);

    const drawText = (
      text: string, x: number, y: number,
      attr: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; align?: 'left' | 'right' | 'center' } = {}
    ): void => {
      const size = attr.size ?? 10;
      const f = attr.font ?? font;
      const color = attr.color ?? TEXT;
      const w = f.widthOfTextAtSize(text, size);
      const tx = attr.align === 'right' ? x - w : attr.align === 'center' ? x - w / 2 : x;
      page.drawText(text, { x: tx, y, size, font: f, color });
    };

    const drawBox = (x: number, y: number, w: number, h: number, fill?: ReturnType<typeof rgb>) => {
      page.drawRectangle({
        x, y, width: w, height: h,
        borderColor: BORDER, borderWidth: 0.5,
        color: fill,
      });
    };

    // Dessine un VRAI QR code (lien site / réseaux sociaux) dans un carré qSize à (qx, qy).
    const drawQrCode = (text: string, qx: number, qy: number, qSize: number): void => {
      try {
        const qr = qrcode(0, 'M');
        qr.addData(text);
        qr.make();
        const count = qr.getModuleCount();
        const cell = qSize / count;
        // Fond blanc
        page.drawRectangle({ x: qx, y: qy, width: qSize, height: qSize, color: rgb(1, 1, 1), borderColor: BORDER, borderWidth: 0.5 });
        for (let r = 0; r < count; r++) {
          for (let c = 0; c < count; c++) {
            if (qr.isDark(r, c)) {
              page.drawRectangle({
                x: qx + c * cell,
                y: qy + (count - 1 - r) * cell, // repère PDF : origine en bas à gauche
                width: cell,
                height: cell,
                color: rgb(0, 0, 0),
              });
            }
          }
        }
      } catch {
        // Lien trop long / invalide : ne jamais casser la génération du PDF.
        drawBox(qx, qy, qSize, qSize, rgb(0.97, 0.96, 0.95));
      }
    };

    const centerX = width / 2;
    let y = height - MARGIN;

    // ─────────────────────── EN-TÊTE : logo + entreprise (gauche) ───────────────────────
    let logoImage: PDFImage | null = null;
    if (settings.show_logo_on_documents && settings.logo_path && fs.existsSync(settings.logo_path)) {
      try {
        const logoBytes = fs.readFileSync(settings.logo_path);
        const ext = path.extname(settings.logo_path).toLowerCase();
        logoImage = ext === '.png' ? await pdfDoc.embedPng(logoBytes) : await pdfDoc.embedJpg(logoBytes);
      } catch { logoImage = null; }
    }

    const showName = settings.show_company_name_on_documents;
    const leftX = MARGIN;
    const topY = y;

    // Logo à l'extrême GAUCHE
    if (logoImage) {
      page.drawImage(logoImage, { x: leftX, y: topY - 36, width: 72, height: 36 });
    }
    // Nom de l'entreprise à l'extrême DROITE (aligné à droite)
    if (showName) {
      drawText(settings.name || 'StockLocal', RIGHT, topY - 14, { size: 20, font: boldFont, color: rgb(0.1, 0.2, 0.4), align: 'right' });
    }

    // ── Titre centré + numéro ──
    const titleY = topY - 60;
    drawText(titleLabel, centerX, titleY, { size: 10, font: boldFont, color: MUTED, align: 'center' });
    drawText(doc.document_number, centerX, titleY - 14, { size: 13, font: boldFont, color: TEXT, align: 'center' });

    // ── Encadré client + date (à droite, face au numéro de facture) ──
    const clientBoxW = 150;
    const clientBoxH = 40;
    const clientBoxX = RIGHT - clientBoxW;
    const clientBoxY = titleY - 54; // bas de l'encadré (au niveau du numéro)
    drawText(`le ${new Date(doc.date).toLocaleDateString('fr-MA')}`, RIGHT, titleY, { size: 9, font: boldFont, color: TEXT, align: 'right' });
    drawBox(clientBoxX, clientBoxY, clientBoxW, clientBoxH, rgb(0.98, 0.97, 0.95));
    drawText(
      truncate(customer?.name || doc.customer_name || '-', 24),
      clientBoxX + clientBoxW / 2,
      clientBoxY + clientBoxH / 2 - 3,
      { size: 10, font: boldFont, color: TEXT, align: 'center' }
    );

    // Espace entre le numéro/encadré et le tableau (tableau sous l'encadré, bien séparé)
    y = clientBoxY - 22;

    // ─────────────────────── TABLEAU : CODE ARTICLE | DESIGNATION | QTE | P.U | REMISE % | TOTAL ───────────────────────
    const colB = [
      { label: 'CODE ARTICLE', w: 70 },
      { label: 'DESIGNATION', w: 180 },
      { label: 'QTE', w: 50, align: 'right' as const },
      { label: 'P.U', w: 55, align: 'right' as const },
      { label: 'REMISE %', w: 50, align: 'right' as const },
      { label: 'TOTAL', w: 130, align: 'right' as const },
    ];
    const colBx: number[] = [];
    let bx = MARGIN;
    for (const c of colB) {
      colBx.push(bx);
      bx += c.w;
    }
    const bandBh = 18;
    let cx = MARGIN;
    for (let i = 0; i < colB.length; i++) {
      drawBox(cx, y - bandBh, colB[i].w, bandBh, PEACH_HEADER);
      drawText(colB[i].label, cx + colB[i].w / 2, y - bandBh / 2 - 3, {
        size: 7.5, font: boldFont, color: TEXT, align: 'center' as const,
      });
      cx += colB[i].w;
    }
    y -= bandBh;

    const ensureSpace = (needed: number): void => {
      if (y - needed < BOTTOM) {
        page = pdfDoc.addPage();
        y = height - MARGIN - 20;
        // Redessiner l'en-tête du tableau sur la nouvelle page
        cx = MARGIN;
        for (const c of colB) {
          drawBox(cx, y - bandBh, c.w, bandBh, PEACH_HEADER);
          drawText(c.label, cx + c.w / 2, y - bandBh / 2 - 3, { size: 7.5, font: boldFont, color: TEXT, align: 'center' as const });
          cx += c.w;
        }
        y -= bandBh;
      }
    };

    const items = doc.items ?? [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const code = item.product_ref || '—';
      const designation = item.product_name || item.product_ref || '—';
      const lines = wrapText(designation || '—', font, 8.5, colB[1].w - 8);
      const rowH = Math.max(1, lines.length) * 10 + 5;

      ensureSpace(rowH);

      // Fond léger alterné + bordures : chaque cellule dessinée avec sa bordure
      const cellBg = i % 2 === 0 ? rgb(0.985, 0.985, 0.985) : rgb(0.97, 0.95, 0.93);
      for (let ci = 0; ci < colB.length; ci++) {
        drawBox(colBx[ci], y - rowH, colB[ci].w, rowH, cellBg);
      }
      const rowTop = y - 8;
      drawText(truncate(code, 12), colBx[0] + 3, rowTop, { size: 8.5 });
      for (let li = 0; li < lines.length; li++) {
        drawText(lines[li], colBx[1] + 3, rowTop - li * 10, { size: 8.5 });
      }
      drawText(item.quantity.toFixed(2), colBx[2] + colB[2].w - 3, rowTop, { size: 8.5, align: 'right' });
      drawText(item.unit_price.toFixed(2), colBx[3] + colB[3].w - 3, rowTop, { size: 8.5, align: 'right' });
      drawText(`${item.discount}%`, colBx[4] + colB[4].w - 3, rowTop, { size: 8.5, align: 'right' });
      drawText(`${item.total.toFixed(2)}`, colBx[5] + colB[5].w - 3, rowTop, { size: 8.5, font: boldFont, align: 'right' });
      y -= rowH;
    }

    // ─────────────────────── BLOC TOTAUX (MONTANT H. TVA | T.V.A | MONTANT TVA | MONTANT TTC) — aligné à droite ───────────────────────
    ensureSpace(90);
    const totalW = 85; // largeur de chaque case
    const totalH = 18;
    const totalY = y - totalH;
    const totalStart = RIGHT - totalW * 4; // bloc aligné à droite
    const totalLabels = ['MONTANT H. TVA', 'T.V.A', 'MONTANT TVA', 'MONTANT TTC'];
    const taxRate = doc.total_excl_tax > 0 ? (doc.total_tax / doc.total_excl_tax) * 100 : 0;
    const totalValues = [
      doc.total_excl_tax.toFixed(2),
      `${taxRate.toFixed(2)} %`,
      doc.total_tax.toFixed(2),
      doc.total_incl_tax.toFixed(2),
    ];
    let tx2 = totalStart;
    for (let i = 0; i < 4; i++) {
      drawBox(tx2, totalY, totalW, totalH, PEACH_TOTAL);
      drawText(totalLabels[i], tx2 + totalW / 2, totalY + totalH / 2 - 3, { size: 7, font: boldFont, color: TEXT, align: 'center' });
      tx2 += totalW;
    }
    tx2 = totalStart;
    for (let i = 0; i < 4; i++) {
      drawBox(tx2, totalY - 16, totalW, 16);
      drawText(totalValues[i], tx2 + totalW - 4, totalY - 11, { size: 8, font: boldFont, color: TEXT, align: 'right' });
      tx2 += totalW;
    }
    y = totalY - 26;

    // ── PAYÉ / RESTE DÛ (factures) — aligné à droite ──
    if (doc.type === 'INVOICE') {
      const paid = doc.amount_paid ?? 0;
      const restDue = Math.max(0, doc.total_incl_tax - paid);
      const payW = 150, restW = 150, payGap = 5;
      const restX = RIGHT - restW;
      const payX = restX - payGap - payW;
      drawBox(payX, y - 16, payW, 16, PEACH_TOTAL);
      drawText('PAYÉ', payX + 4, y - 11, { size: 8, font: boldFont, color: TEXT });
      drawText(`${paid.toFixed(2)}`, payX + payW - 4, y - 11, { size: 8, font: boldFont, color: TEXT, align: 'right' });
      drawBox(restX, y - 16, restW, 16, PEACH_TOTAL);
      drawText('RESTE DÛ', restX + 4, y - 11, { size: 8, font: boldFont, color: TEXT });
      drawText(`${restDue.toFixed(2)}`, restX + restW - 4, y - 11, { size: 8, font: boldFont, color: TEXT, align: 'right' });
      y -= 26;
    }

    // ── Paiements détaillés — aligné à droite ──
    if (payments.length > 0) {
      ensureSpace(30 + payments.length * 10);
      drawText('Paiements :', RIGHT, y, { size: 8.5, font: boldFont, color: TEXT, align: 'right' });
      y -= 11;
      for (const p of payments) {
        const label = PAYMENT_LABELS[p.payment_method] || p.payment_method;
        drawText(`${new Date(p.date).toLocaleDateString('fr-MA')} — ${label}`, RIGHT - 60, y, { size: 8, color: MUTED, align: 'right' });
        drawText(`${p.amount.toFixed(2)}`, RIGHT, y, { size: 8, color: MUTED, align: 'right' });
        y -= 10;
      }
      y -= 4;
    }

    // ── Notes / statut ──
    if (doc.notes) {
      ensureSpace(36);
      drawText('Notes :', MARGIN, y, { size: 8.5, font: boldFont, color: TEXT });
      y -= 11;
      const noteLines = wrapText(doc.notes, font, 8, RIGHT - MARGIN - 40);
      for (const nl of noteLines) {
        drawText(nl, MARGIN, y, { size: 8, color: MUTED });
        y -= 10;
      }
      y -= 4;
    }

    ensureSpace(14);
    drawText(`Statut : ${STATUS_LABELS[doc.status] || doc.status}`, RIGHT, y, { size: 8.5, font: boldFont, color: TEXT, align: 'right' });

    // ─────────────────────── PIED DE PAGE (mentions légales) ───────────────────────
    const footerY = 30;
    const footerX = MARGIN;
    page.drawLine({ start: { x: MARGIN, y: footerY + 14 }, end: { x: RIGHT, y: footerY + 14 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });

    const contactLine = [
      settings.address,
      [settings.phone, settings.email].filter(Boolean).join(' · '),
    ].filter(Boolean).join('  —  ');
    if (contactLine) drawText(contactLine, footerX, footerY, { size: 8, color: MUTED });

    const legalLine = [
      settings.rc ? `RC : ${settings.rc}` : '',
      settings.if_ ? `IF : ${settings.if_}` : '',
      settings.patente ? `Patente : ${settings.patente}` : '',
      settings.ice ? `ICE : ${settings.ice}` : '',
    ].filter(Boolean).join('   ');
    if (legalLine) drawText(legalLine, footerX, footerY - 11, { size: 8, color: MUTED });

    const disclaimer = 'Les marchandises sont considérées comme agréées par l\'acheteur et voyagent à ses risques et périls. En cas de litige, les tribunaux du siège de l\'entreprise seront seuls compétents.';
    drawText(disclaimer, footerX, footerY - 22, { size: 7, color: MUTED });
    drawText('Réalisé par :', footerX, footerY - 38, { size: 8, font: boldFont, color: MUTED });

    // Zone QR : affichée UNIQUEMENT si l'option est activée ET qu'un lien est configuré.
    // Désactivée → rien n'est dessiné (plus de carré vide).
    if (settings.show_qr_on_documents && settings.qr_link && settings.qr_link.trim()) {
      drawQrCode(settings.qr_link.trim(), RIGHT - 70, footerY, 70);
      drawText('Scannez-moi', RIGHT - 35, footerY + 74, { size: 6, font: boldFont, color: MUTED, align: 'center' });
    }

    const pdfBytes = await pdfDoc.save();
    const documentsPath = app.getPath('documents');
    const prefix = doc.document_number.replace(/[^a-z0-9]/gi, '_');
    const filePath = path.join(documentsPath, `${prefix}.pdf`);

    fs.writeFileSync(filePath, pdfBytes);
    return filePath;
  },

  /**
   * Rapport mensuel du tableau de bord (cahier des charges §8).
   */
  async generateMonthlyReport(month?: string): Promise<string> {
    const settings = CompanySettingsService.getAll();
    const stats = DashboardRepository.getStats();
    const topProducts = DashboardRepository.getTopProducts();
    const topClients = DashboardRepository.getTopClients();

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const labelMonth = month ?? new Date().toLocaleDateString('fr-MA', { month: 'long', year: 'numeric' });
    let y = height - 50;

    // ── Bloc (logo à GAUCHE du nom) CENTRÉ sur la page, logo aligné au nom ──
    const nameText = settings.name || 'StockLocal';
    const showName = settings.show_company_name_on_documents;
    const nameW = showName ? boldFont.widthOfTextAtSize(nameText, 20) : 0;
    const logoW = 72, logoH = 36, gap = 14;
    let logoImage: PDFImage | null = null;
    if (settings.show_logo_on_documents && settings.logo_path && fs.existsSync(settings.logo_path)) {
      try {
        const logoBytes = fs.readFileSync(settings.logo_path);
        const ext = path.extname(settings.logo_path).toLowerCase();
        logoImage = ext === '.png' ? await pdfDoc.embedPng(logoBytes) : await pdfDoc.embedJpg(logoBytes);
      } catch {
        logoImage = null;
      }
    }
    const startX = (width - (logoImage ? logoW + gap : 0) - nameW) / 2;
    const nameBaseline = y - 14;
    if (logoImage) {
      // Logo verticalement centré sur le nom (même niveau), et rapproché du nom
      const logoY = nameBaseline - 12;
      page.drawImage(logoImage, { x: startX, y: logoY, width: logoW, height: logoH });
    }
    if (showName) {
      page.drawText(nameText, { x: startX + (logoImage ? logoW + gap : 0), y: nameBaseline, size: 20, font: boldFont, color: rgb(0.1, 0.2, 0.4) });
    }
    y -= 62; // saute quelques lignes avant le titre

    // Titre et date alignés à gauche (début de page)
    page.drawText(`Rapport de ventes — ${labelMonth}`, { x: 50, y, size: 14, font: boldFont });
    y -= 14;

    page.drawText(`Généré le ${new Date().toLocaleDateString('fr-MA')}`, { x: 50, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    y -= 30;

    const drawKpi = (label: string, value: string) => {
      page.drawText(label, { x: 50, y, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
      page.drawText(value, { x: 300, y, size: 11, font: boldFont });
      y -= 18;
    };

    drawKpi('CA aujourd\'hui', `${stats.revenue_today.toFixed(2)} MAD`);
    drawKpi('CA cette semaine', `${stats.revenue_week.toFixed(2)} MAD`);
    drawKpi('CA ce mois', `${stats.revenue_month.toFixed(2)} MAD`);
    drawKpi('Marge brute (mois)', `${stats.gross_margin_month.toFixed(2)} MAD`);
    drawKpi('Valeur du stock', `${stats.total_stock_value.toFixed(2)} MAD`);
    drawKpi('Impayés', `${stats.unpaid_total.toFixed(2)} MAD`);
    y -= 20;

    page.drawText('Top produits du mois', { x: 50, y, size: 12, font: boldFont });
    y -= 16;
    for (const p of topProducts) {
      page.drawText(truncate(p.designation, 35), { x: 50, y, size: 10, font });
      page.drawText(`${p.total_qty} u`, { x: 400, y, size: 10, font });
      page.drawText(`${p.total_revenue.toFixed(2)} MAD`, { x: 480, y, size: 10, font: boldFont });
      y -= 14;
    }
    y -= 10;

    page.drawText('Top clients du mois', { x: 50, y, size: 12, font: boldFont });
    y -= 16;
    for (const c of topClients) {
      page.drawText(truncate(c.name, 35), { x: 50, y, size: 10, font });
      page.drawText(`${c.invoice_count} factures`, { x: 400, y, size: 10, font });
      page.drawText(`${c.total_revenue.toFixed(2)} MAD`, { x: 480, y, size: 10, font: boldFont });
      y -= 14;
    }

    page.drawText('Rapport généré par StockLocal - 100% local.', {
      x: 50, y: 40, size: 9, font, color: rgb(0.5, 0.5, 0.5)
    });

    const pdfBytes = await pdfDoc.save();
    const documentsPath = app.getPath('documents');
    const filePath = path.join(documentsPath, `Rapport_${labelMonth.replace(/[^a-z0-9]/gi, '_')}.pdf`);

    fs.writeFileSync(filePath, pdfBytes);
    return filePath;
  },

  /**
   * Génère un TICKET DE CAISSE au format thermique 80 mm (reçu court).
   *
   * Contenu compact :
   *   - nom de l'entreprise UNIQUEMENT si `show_company_name_on_documents`
   *     (réutilise le paramètre existant) ;
   *   - numéro + date/heure ;
   *   - lignes de vente (désignation, quantité × prix, total ligne) ;
   *   - TOTAL TTC ;
   *   - mode de paiement.
   *
   * AUCUNE mention légale (RC / IF / Patente / ICE / clause de litige) : celles-ci
   * restent réservées à la facture A4 (`generateDocument`). La page mesure 80 mm
   * de large ; sa hauteur est calculée selon le contenu (rouleau thermique continu).
   */
  async generateReceipt(doc: Document): Promise<string> {
    const settings = CompanySettingsService.getAll();
    const { DocumentRepository } = await import('../repositories/DocumentRepository');
    const payments: Payment[] = DocumentRepository.getPayments(doc.id);

    // 80 mm en points PDF (1 mm = 2.8346 pt) → ≈ 226.77 pt.
    const MM = 2.8346;
    const WIDTH = Math.round(80 * MM * 100) / 100;
    const MARGIN = 6;
    const LEFT = MARGIN;
    const RIGHT = WIDTH - MARGIN;

    const PAYMENT_LABELS: Record<string, string> = { CASH: 'Espèces', CHECK: 'Chèque', TRANSFER: 'Virement' };

    type Row =
      | { kind: 'text'; text: string; size: number; bold?: boolean; align?: 'left' | 'center' | 'right' }
      | { kind: 'sep' };

    const rows: Row[] = [];
    if (settings.show_company_name_on_documents) {
      rows.push({ kind: 'text', text: settings.name || 'StockLocal', size: 11, bold: true, align: 'center' });
    }
    rows.push({ kind: 'text', text: doc.document_number, size: 9, bold: true, align: 'center' });
    rows.push({ kind: 'text', text: new Date(doc.date).toLocaleString('fr-MA'), size: 7.5, align: 'center' });
    if (doc.customer_name) {
      rows.push({ kind: 'text', text: `Client : ${truncate(doc.customer_name, 34)}`, size: 8, align: 'left' });
    }

    rows.push({ kind: 'sep' });
    for (const item of (doc.items ?? [])) {
      const name = item.product_name || item.product_ref || '—';
      rows.push({ kind: 'text', text: truncate(name, 36), size: 8, align: 'left' });
      const discountSuffix = item.discount ? ` (-${item.discount}%)` : '';
      rows.push({ kind: 'text', text: `${item.quantity} × ${item.unit_price.toFixed(2)}${discountSuffix}`, size: 8, align: 'left' });
      rows.push({ kind: 'text', text: `${item.total.toFixed(2)} MAD`, size: 8, align: 'right' });
    }

    rows.push({ kind: 'sep' });
    rows.push({ kind: 'text', text: `TOTAL TTC : ${doc.total_incl_tax.toFixed(2)} MAD`, size: 11, bold: true, align: 'left' });
    const lastPayment = payments[0];
    const methodLabel = lastPayment ? (PAYMENT_LABELS[lastPayment.payment_method] || lastPayment.payment_method) : 'Non encaissé';
    rows.push({ kind: 'text', text: `Paiement : ${methodLabel}`, size: 8, align: 'left' });
    rows.push({ kind: 'sep' });
    rows.push({ kind: 'text', text: 'Merci de votre visite', size: 8, align: 'center' });

    const rowHeight = (r: Row): number => (r.kind === 'sep' ? 10 : r.size + 4);
    const HEIGHT = rows.reduce((sum, r) => sum + rowHeight(r), 0) + MARGIN * 2;

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([WIDTH, HEIGHT]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let y = HEIGHT - MARGIN;
    for (const r of rows) {
      if (r.kind === 'sep') {
        y -= 5;
        page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
        y -= 5;
        continue;
      }
      const f = r.bold ? boldFont : font;
      const textWidth = f.widthOfTextAtSize(r.text, r.size);
      let x = LEFT;
      if (r.align === 'center') x = Math.max(LEFT, (WIDTH - textWidth) / 2);
      else if (r.align === 'right') x = Math.max(LEFT, RIGHT - textWidth);
      y -= r.size + 2;
      page.drawText(r.text, { x, y, size: r.size, font: f, color: rgb(0.05, 0.05, 0.05) });
      y -= 2;
    }

    const pdfBytes = await pdfDoc.save();
    const documentsPath = app.getPath('documents');
    const prefix = doc.document_number.replace(/[^a-z0-9]/gi, '_');
    const filePath = path.join(documentsPath, `Ticket_${prefix}.pdf`);
    fs.writeFileSync(filePath, pdfBytes);
    return filePath;
  },

  /**
   * Génère une planche d'ÉTIQUETTES PRODUIT (une par produit) au format
   * configuré dans Paramètres (largeur/hauteur en mm), prête pour une
   * imprimante d'étiquettes ou une imprimante A4 (plusieurs étiquettes/page).
   *
   * Chaque étiquette contient : désignation (2 lignes max), prix de vente et
   * le code-barres du produit (`barcode`) dessiné en VRAIES barres vectorielles
   * (EAN-13 si la clé est valide, sinon CODE 128) avec sa valeur lisible.
   *
   * ⚠️ Aucun code-barres vide n'est jamais produit : si un produit n'a pas de
   * code-barres encodable, la génération ÉCHOUE avec la liste des références
   * concernées (l'utilisateur sait exactement quoi corriger).
   */
  async generateProductLabels(
    products: Product[],
    options: { widthMm: number; heightMm: number },
  ): Promise<string> {
    if (products.length === 0) {
      throw new Error('Aucun produit sélectionné pour l\'impression d\'étiquettes.');
    }

    // 1. Encoder TOUS les codes-barres AVANT de dessiner : on refuse l'ensemble
    //    plutôt que de produire une planche partielle silencieuse.
    const missing: string[] = [];
    const encoded = products.map(product => {
      try {
        return { product, barcode: encodeBarcode(product.barcode) };
      } catch {
        missing.push(product.reference || product.designation);
        return null;
      }
    });
    if (missing.length > 0) {
      const list = missing.slice(0, 10).join(', ');
      const extra = missing.length > 10 ? ` (+${missing.length - 10} autres)` : '';
      throw new Error(
        `Impossible d'imprimer les étiquettes : ${missing.length} produit(s) sans code-barres exploitable. ` +
        `Renseignez un code-barres avant l'impression. Concerné(s) : ${list}${extra}.`,
      );
    }

    const MM = 2.8346;
    const widthMm = Math.min(Math.max(options.widthMm, 20), 210);
    const heightMm = Math.min(Math.max(options.heightMm, 15), 297);
    const labelW = widthMm * MM;
    const labelH = heightMm * MM;

    // Page A4 (210 × 297 mm) : plusieurs étiquettes par page quand elles tiennent.
    const pageW = 210 * MM;
    const pageH = 297 * MM;
    const outerMargin = 6;
    const gap = 2 * MM;
    const cols = Math.max(1, Math.floor((pageW - 2 * outerMargin + gap) / (labelW + gap)));
    const rows = Math.max(1, Math.floor((pageH - 2 * outerMargin + gap) / (labelH + gap)));
    const perPage = cols * rows;

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const innerPad = 1.5 * MM;
    const lineGap = 1;

    for (let index = 0; index < encoded.length; index++) {
      const entry = encoded[index];
      if (!entry) continue;

      const cell = index % perPage;
      if (cell === 0) pdfDoc.addPage([pageW, pageH]);
      const page = pdfDoc.getPages()[pdfDoc.getPageCount() - 1];

      const col = cell % cols;
      const row = Math.floor(cell / cols);
      // Coordonnée PDF : origine en bas à gauche → on descend depuis le haut.
      const x0 = outerMargin + col * (labelW + gap);
      const y0 = pageH - outerMargin - labelH - row * (labelH + gap);
      const innerW = labelW - innerPad * 2;

      // Cadre léger : aide à découper l'étiquette.
      page.drawRectangle({
        x: x0, y: y0, width: labelW, height: labelH,
        borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.4,
      });

      let cursorY = y0 + labelH - innerPad;

      // ── Désignation (2 lignes max) ──
      const nameSize = 6.5;
      const nameLines = wrapText(entry.product.designation, font, nameSize, innerW).slice(0, 2);
      for (const line of nameLines) {
        cursorY -= nameSize + lineGap;
        page.drawText(line, { x: x0 + innerPad, y: cursorY, size: nameSize, font, color: rgb(0.05, 0.05, 0.05) });
      }

      // ── Prix de vente ──
      const priceSize = 8;
      cursorY -= priceSize + 2;
      page.drawText(`${entry.product.selling_price.toFixed(2)} MAD`, {
        x: x0 + innerPad, y: cursorY, size: priceSize, font: boldFont, color: rgb(0.1, 0.2, 0.4),
      });

      // ── Code-barres : barres vectorielles centrées, hauteur = tiers restant ──
      const textSize = 5.5;
      const usableH = cursorY - y0 - innerPad - textSize - 2;
      const barH = Math.max(6, Math.min(usableH, labelH * 0.42));
      const bars = barsFromModules(entry.barcode.modules);
      const totalModules = moduleCount(entry.barcode.modules);
      const moduleW = innerW / totalModules;
      const barsBottom = y0 + innerPad + textSize + 2;
      const barsStartX = x0 + innerPad;
      for (const bar of bars) {
        page.drawRectangle({
          x: barsStartX + bar.x * moduleW,
          y: barsBottom,
          width: Math.max(bar.width * moduleW, 0.35),
          height: barH,
          color: rgb(0, 0, 0),
        });
      }

      // ── Valeur lisible sous les barres ──
      const textW = font.widthOfTextAtSize(entry.barcode.text, textSize);
      page.drawText(entry.barcode.text, {
        x: x0 + Math.max(innerPad, (labelW - textW) / 2),
        y: y0 + innerPad - 1,
        size: textSize,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
    }

    const pdfBytes = await pdfDoc.save();
    const documentsPath = app.getPath('documents');
    const filePath = path.join(documentsPath, `Etiquettes_${Date.now()}.pdf`);
    fs.writeFileSync(filePath, pdfBytes);
    return filePath;
  }
};
