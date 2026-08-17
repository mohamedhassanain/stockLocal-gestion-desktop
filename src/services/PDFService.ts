import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { Customer, ClientCredit } from '../repositories/ClientRepository';
import type { Document } from '../repositories/DocumentRepository';

export const PDFService = {
  async generateClientStatement(client: Customer, history: ClientCredit[]): Promise<string> {
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage();
    const { height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    let y = height - 50;

    // Header
    page.drawText('Relevé de Compte (نسيئة)', { x: 50, y, size: 20, font: boldFont, color: rgb(0.1, 0.2, 0.4) });
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

    // Table Header
    page.drawText('Date', { x: 50, y, size: 12, font: boldFont });
    page.drawText('Type', { x: 150, y, size: 12, font: boldFont });
    page.drawText('Description', { x: 250, y, size: 12, font: boldFont });
    page.drawText('Montant', { x: 450, y, size: 12, font: boldFont });
    
    y -= 10;
    page.drawLine({ start: { x: 50, y }, end: { x: 550, y }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
    y -= 20;

    // Table Rows
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
      page.drawText((item.description || '').substring(0, 30), { x: 250, y, size: 10, font });
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

  /**
   * Génère un PDF pour un document commercial (Devis, BL, Facture, Avoir)
   * avec les mentions légales marocaines (ICE, RC, IF).
   */
  async generateDocument(doc: Document): Promise<string> {
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

    // ── En-tête : entreprise + numéro ──
    page.drawText('StockLocal', { x: 50, y, size: 22, font: boldFont, color: rgb(0.1, 0.2, 0.4) });
    page.drawText(title, { x: width - 300, y: y + 4, size: 18, font: boldFont, color: rgb(0.1, 0.2, 0.4) });
    y -= 15;
    page.drawText('Gestion commerciale - Grossiste', { x: 50, y, size: 10, font });
    page.drawText(doc.document_number, { x: width - 300, y, size: 12, font: boldFont });
    y -= 15;
    // Mentions légales marocaines
    page.drawText('ICE : 000000000000000  ·  RC : 00000  ·  IF : 00000000', { x: 50, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
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
      page.drawText((item.product_name || item.product_ref || '-').substring(0, 40), { x: 50, y, size: 10, font });
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

    // ── Pied de page ──
    const statusLabel: Record<string, string> = {
      PAID: 'PAYÉE', UNPAID: 'IMPAYÉE', PARTIAL: 'PARTIELLEMENT PAYÉE', DRAFT: 'BROUILLON', CANCELLED: 'ANNULÉE'
    };
    page.drawText(`Statut : ${statusLabel[doc.status] || doc.status}`, { x: 50, y, size: 10, font: boldFont });
    y -= 20;
    page.drawText('Merci de votre confiance. Document généré par StockLocal - 100% local.', {
      x: 50, y: 40, size: 9, font, color: rgb(0.5, 0.5, 0.5)
    });

    const pdfBytes = await pdfDoc.save();
    const documentsPath = app.getPath('documents');
    const prefix = doc.document_number.replace(/[^a-z0-9]/gi, '_');
    const filePath = path.join(documentsPath, `${prefix}.pdf`);

    fs.writeFileSync(filePath, pdfBytes);
    return filePath;
  }
};
