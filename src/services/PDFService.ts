import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { Customer, ClientCredit } from '../repositories/ClientRepository';

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
  }
};
