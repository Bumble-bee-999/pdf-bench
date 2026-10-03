/** Builds a small multi-page fixture PDF with a form field and a rotated page. */
import { PDFDocument, StandardFonts, rgb, degrees } from '@cantoo/pdf-lib';
import { writeFileSync } from 'node:fs';

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);

for (let i = 0; i < 4; i++) {
  const page = doc.addPage([612, 792]);
  page.drawText(`Fixture page ${i + 1}`, { x: 60, y: 700, size: 26, font: bold, color: rgb(0.1, 0.1, 0.2) });
  page.drawText('The quick brown fox jumps over the lazy dog. Confidential test content.',
    { x: 60, y: 660, size: 12, font });
  page.drawRectangle({ x: 60, y: 100, width: 200, height: 60, borderColor: rgb(0.8, 0.3, 0.2), borderWidth: 2 });
  if (i === 2) page.setRotation(degrees(90));
}

const form = doc.getForm();
const page0 = doc.getPage(0);
const name = form.createTextField('applicant.name');
name.addToPage(page0, { x: 60, y: 560, width: 260, height: 22 });
const agree = form.createCheckBox('applicant.agree');
agree.addToPage(page0, { x: 60, y: 520, width: 16, height: 16 });

doc.setTitle('Fixture document');
doc.setAuthor('PDF Bench test');
writeFileSync(new URL('./fixture.pdf', import.meta.url), await doc.save());
console.log('fixture.pdf written');
