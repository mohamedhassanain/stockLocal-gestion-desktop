import { PDFDocument, PDFPage, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { Customer, ClientCredit } from '../repositories/ClientRepository';
import type { Supplier, SupplierCredit } from '../repositories/SupplierRepository';
import type { Document } from '../repositories/DocumentRepository';
import type { Product } from '../repositories/ProductRepository';
import { CompanySettingsService, type CompanySettings } from './CompanySettingsService';
import { DashboardRepository } from '../repositories/DashboardRepository';

function truncate(text: string, max: number): string {
  return text.length > max ? text.substring(0, max) : text;
}

// Dessine le logo d'entreprise en haut à gauche si l'utilisateur l'a activé
// (toggle `show_logo_on_documents`). Retourne le headerX à utiliser pour le nom
// (50 = pas de logo, 160 = nom décalé à droite du logo).
async function drawCompanyLogo(pdfDoc: PDFDocument, page: PDFPage, settings: CompanySettings): Promise<number> {
  let headerX = 50;
  if (settings.show_logo_on_documents && settings.logo_path && fs.existsSync(settings.logo_path)) {
    try {
      const logoBytes = fs.readFileSync(settings.logo_path);
      const ext = path.extname(settings.logo_path).toLowerCase();
      const logoImage = ext === '.png' ? await pdfDoc.embedPng(logoBytes) : await pdfDoc.embedJpg(logoBytes);
      // Logo discret (72×36) en haut à gauche ; le nom de l'entreprise est décalé à droite.
      page.drawImage(logoImage, { x: 50, y: page.getHeight() - 66, width: 72, height: 36 });
      headerX = 140;
    } catch {
      // Logo illisible : on ignore silencieusement
    }
  }
  return headerX;
}

export const PDFService = {
  async generateClientStatement(client: Customer, history: ClientCredit[]): Promise<string> {
    const settings = CompanySettingsService.getAll();
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage();
    const { height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let y = height - 50;

    const headerX = await drawCompanyLogo(pdfDoc, page, settings);
    page.drawText(settings.name || 'StockLocal', { x: headerX, y, size: 14, font: boldFont, color: rgb(0.1, 0.2, 0.4) });
    y -= 24;

    page.drawText('Relevé de Compte (نسيئة)', { x: headerX, y, size: 20, font: boldFont, color: rgb(0.1, 0.2, 0.4) });
    y -= 40;

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
    const { height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let y = height - 50;

    const headerX = await drawCompanyLogo(pdfDoc, page, settings);
    page.drawText(settings.name || 'StockLocal', { x: headerX, y, size: 14, font: boldFont, color: rgb(0.1, 0.2, 0.4) });
    y -= 24;

    page.drawText('Relevé de Compte (Fournisseur)', { x: headerX, y, size: 20, font: boldFont, color: rgb(0.1, 0.2, 0.4) });
    y -= 40;

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
   * avec logo (optionnel), mentions légales marocaines (ICE, RC, IF) et paramètres entreprise.
   */
  async generateDocument(doc: Document): Promise<string> {
    const settings = CompanySettingsService.getAll();
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const TYPE_TITLES: Record<string, string> = {
      QUOTE: 'DEVIS',
      DELIVERY_NOTE: 'BON DE LIVRAISON',
      INVOICE: 'FACTURE',
      CREDIT_NOTE: 'AVOIR'
    };
    const title = TYPE_TITLES[doc.type] || doc.type;

    let y = height - 50;

    // ── Logo entreprise (optionnel, si activé sur les documents) ──
    let headerX = 50;
    if (settings.show_logo_on_documents && settings.logo_path && fs.existsSync(settings.logo_path)) {
      try {
        const logoBytes = fs.readFileSync(settings.logo_path);
        const ext = path.extname(settings.logo_path).toLowerCase();
        const logoImage = ext === '.png'
          ? await pdfDoc.embedPng(logoBytes)
          : await pdfDoc.embedJpg(logoBytes);
        page.drawImage(logoImage, { x: 50, y: height - 70, width: 90, height: 45 });
        headerX = 160;
        y = height - 50;
      } catch {
        // Logo illisible : on ignore silencieusement
      }
    }

    // ── En-tête : entreprise + numéro ──
    page.drawText(settings.name || 'StockLocal', { x: headerX, y, size: 22, font: boldFont, color: rgb(0.1, 0.2, 0.4) });
    page.drawText(title, { x: width - 300, y: y + 4, size: 18, font: boldFont, color: rgb(0.1, 0.2, 0.4) });
    y -= 15;
    if (settings.address) {
      page.drawText(settings.address, { x: headerX, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
      y -= 12;
    }
    if (settings.phone || settings.email) {
      page.drawText([settings.phone, settings.email].filter(Boolean).join(' · '), { x: headerX, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
      y -= 12;
    }
    page.drawText(settings.tagline || 'Gestion commerciale - Grossiste', { x: headerX, y, size: 10, font });
    page.drawText(doc.document_number, { x: width - 300, y, size: 12, font: boldFont });
    y -= 15;
    page.drawText(`ICE : ${settings.ice}  ·  RC : ${settings.rc}  ·  IF : ${settings.if_}`, { x: headerX, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    y -= 15;
    page.drawText(`Date : ${new Date(doc.date).toLocaleDateString('fr-MA')}`, { x: width - 300, y, size: 10, font });
    if (doc.due_date) {
      y -= 15;
      page.drawText(`Échéance : ${new Date(doc.due_date).toLocaleDateString('fr-MA')}`, { x: width - 300, y, size: 10, font });
    }
    y -= 25;

    // ── Client ──
    page.drawText('Client :', { x: 50, y, size: 11, font: boldFont });
    y -= 16;
    page.drawText(doc.customer_name || '-', { x: 50, y, size: 12, font });
    y -= 25;

    // ── Table des lignes ──
    page.drawText('Désignation', { x: 50, y, size: 11, font: boldFont });
    page.drawText('Qté', { x: 320, y, size: 11, font: boldFont });
    page.drawText('P.U.', { x: 380, y, size: 11, font: boldFont });
    page.drawText('Rem%', { x: 450, y, size: 11, font: boldFont });
    page.drawText('Total', { x: 500, y, size: 11, font: boldFont });
    y -= 10;
    page.drawLine({ start: { x: 50, y }, end: { x: width - 50, y }, thickness: 1, color: rgb(0.6, 0.6, 0.6) });
    y -= 18;

    for (const item of (doc.items ?? [])) {
      if (y < 100) {
        page = pdfDoc.addPage();
        y = height - 50;
      }
      page.drawText(truncate(item.product_name || item.product_ref || '-', 40), { x: 50, y, size: 10, font });
      page.drawText(String(item.quantity), { x: 320, y, size: 10, font });
      page.drawText(item.unit_price.toFixed(2), { x: 380, y, size: 10, font });
      page.drawText(String(item.discount), { x: 450, y, size: 10, font });
      page.drawText(`${item.total.toFixed(2)} MAD`, { x: 500, y, size: 10, font: boldFont });
      y -= 16;
    }

    y -= 10;
    page.drawLine({ start: { x: 50, y }, end: { x: width - 50, y }, thickness: 1, color: rgb(0.6, 0.6, 0.6) });
    y -= 20;
    page.drawText(`TOTAL HT : ${doc.total_excl_tax.toFixed(2)} MAD`, { x: width - 250, y, size: 13, font: boldFont, color: rgb(0.1, 0.2, 0.4) });
    y -= 18;
    page.drawText(`TOTAL TTC : ${doc.total_incl_tax.toFixed(2)} MAD`, { x: width - 250, y, size: 13, font: boldFont });
    y -= 40;

    if (doc.notes) {
      page.drawText(`Notes : ${doc.notes}`, { x: 50, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
      y -= 15;
    }

    const statusLabel: Record<string, string> = {
      PAID: 'PAYÉE', UNPAID: 'IMPAYÉE', PARTIAL: 'PARTIELLEMENT PAYÉE', DRAFT: 'BROUILLON', CANCELLED: 'ANNULÉE'
    };
    page.drawText(`Statut : ${statusLabel[doc.status] || doc.status}`, { x: 50, y, size: 10, font: boldFont });
    page.drawText('Merci de votre confiance. Document généré par StockLocal - 100% local.', {
      x: 50, y: 40, size: 9, font, color: rgb(0.5, 0.5, 0.5)
    });

    const pdfBytes = await pdfDoc.save();
    const documentsPath = app.getPath('documents');
    const prefix = doc.document_number.replace(/[^a-z0-9]/gi, '_');
    const filePath = path.join(documentsPath, `${prefix}.pdf`);

    fs.writeFileSync(filePath, pdfBytes);
    return filePath;
  },

  /**
   * Génère une planche d'étiquettes avec codes-barres (cahier des charges §3).
   */
  async generateBarcodeLabels(productIds: string[]): Promise<string> {
    const settings = CompanySettingsService.getAll();
    const { ProductRepository } = await import('../repositories/ProductRepository');
    const products: Product[] = productIds
      .map(id => ProductRepository.findById(id))
      .filter((p): p is Product => !!p);

    if (products.length === 0) throw new Error('Aucun produit sélectionné pour les étiquettes.');

    const pdfDoc = await PDFDocument.create();
    const { width, height } = pdfDoc.addPage().getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const cols = 2;
    const rows = 4;
    const labelW = width / cols;
    const labelH = height / rows;

    products.forEach((product, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols) % rows;
      const pageIndex = Math.floor(i / (cols * rows));

      // Crée les pages supplémentaires au besoin
      while (pdfDoc.getPageCount() <= pageIndex) {
        pdfDoc.addPage();
      }
      const page = pdfDoc.getPage(pageIndex);
      const x0 = col * labelW + 10;
      const yTop = height - row * labelH - 10;

      page.drawText(settings.name || 'StockLocal', { x: x0, y: yTop, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
      page.drawText(truncate(product.designation, 28), { x: x0, y: yTop - 16, size: 11, font: boldFont });
      page.drawText(`Réf : ${product.reference}`, { x: x0, y: yTop - 32, size: 9, font });
      page.drawText(`${product.selling_price.toFixed(2)} MAD`, { x: x0, y: yTop - 48, size: 13, font: boldFont, color: rgb(0.1, 0.2, 0.4) });
      // Représentation du code-barres (rectangles) — codes-barres ZXing en V2
      const barcode = product.barcode || product.reference;
      page.drawText(barcode, { x: x0, y: yTop - 62, size: 9, font });
      for (let b = 0; b < 24; b++) {
        page.drawRectangle({
          x: x0 + b * 2,
          y: yTop - 80,
          width: b % 2 === 0 ? 1.6 : 0.6,
          height: 14,
          color: b % 2 === 0 ? rgb(0, 0, 0) : rgb(1, 1, 1),
        });
      }
    });

    const pdfBytes = await pdfDoc.save();
    const documentsPath = app.getPath('documents');
    const filePath = path.join(documentsPath, `Etiquettes_${Date.now()}.pdf`);

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
    const { height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const labelMonth = month ?? new Date().toLocaleDateString('fr-MA', { month: 'long', year: 'numeric' });
    let y = height - 50;

    const headerX = await drawCompanyLogo(pdfDoc, page, settings);
    page.drawText(settings.name || 'StockLocal', { x: headerX, y, size: 20, font: boldFont, color: rgb(0.1, 0.2, 0.4) });
    y -= 22;
    page.drawText(`Rapport de ventes — ${labelMonth}`, { x: headerX, y, size: 14, font: boldFont });
    y -= 14;
    page.drawText(`Généré le ${new Date().toLocaleDateString('fr-MA')}`, { x: headerX, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
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
  }
};
