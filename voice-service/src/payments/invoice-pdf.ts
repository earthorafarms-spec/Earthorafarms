import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import 'regenerator-runtime/runtime.js';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { supabase } from '../lib/supabaseClient.js';
import type { SupportedLanguage } from '../conversation/language.js';

const A4: [number, number] = [595.28, 841.89];
const INK = rgb(0.08, 0.14, 0.1);
const MUTED = rgb(0.35, 0.4, 0.36);
const GREEN = rgb(0.12, 0.33, 0.21);
const PALE_GREEN = rgb(0.93, 0.96, 0.93);
const RULE = rgb(0.62, 0.69, 0.64);

const COPY: Record<SupportedLanguage, Record<string, string>> = {
  en: {
    invoice: 'TAX INVOICE', original: 'ORIGINAL', billTo: 'BILL TO', shipTo: 'SHIP TO',
    invoiceNo: 'Invoice No.', invoiceDate: 'Invoice Date', source: 'Order source',
    item: 'Description of goods', hsn: 'HSN/SAC', quantity: 'Qty.', rate: 'Rate', taxable: 'Taxable value',
    amount: 'Amount', cgst: 'CGST @ 9%', sgst: 'SGST @ 9%', igst: 'IGST @ 18%', totalTax: 'Total tax',
    total: 'TOTAL', amountWords: 'Amount chargeable (in words)', payment: 'Payment status',
    declaration: 'Declaration', authorized: 'Authorised signatory', terms: 'Terms and notes',
    generated: 'This is a computer generated invoice.', reference: 'Payment reference', method: 'Method',
  },
  hi: {
    invoice: 'टैक्स इनवॉइस', original: 'मूल', billTo: 'बिल प्राप्तकर्ता', shipTo: 'भेजने का पता',
    invoiceNo: 'इनवॉइस नंबर', invoiceDate: 'इनवॉइस तारीख', source: 'ऑर्डर स्रोत',
    item: 'सामान का विवरण', hsn: 'एचएसएन/एसएसी', quantity: 'मात्रा', rate: 'दर', taxable: 'कर योग्य मूल्य',
    amount: 'राशि', cgst: 'सीजीएसटी @ 9%', sgst: 'एसजीएसटी @ 9%', igst: 'आईजीएसटी @ 18%', totalTax: 'कुल कर',
    total: 'कुल', amountWords: 'शब्दों में राशि', payment: 'पेमेंट स्थिति', declaration: 'घोषणा',
    authorized: 'अधिकृत हस्ताक्षर', terms: 'शर्तें और नोट्स', generated: 'यह कंप्यूटर द्वारा बनाया गया इनवॉइस है।',
    reference: 'पेमेंट संदर्भ', method: 'तरीका',
  },
  gu: {
    invoice: 'ટેક્સ ઇન્વોઇસ', original: 'મૂળ', billTo: 'બિલ મેળવનાર', shipTo: 'મોકલવાનું સરનામું',
    invoiceNo: 'ઇન્વોઇસ નંબર', invoiceDate: 'ઇન્વોઇસ તારીખ', source: 'ઓર્ડર સ્ત્રોત',
    item: 'વસ્તુની વિગતો', hsn: 'એચએસએન/એસએસી', quantity: 'જથ્થો', rate: 'દર', taxable: 'કરપાત્ર મૂલ્ય',
    amount: 'રકમ', cgst: 'સીજીએસટી @ 9%', sgst: 'એસજીીએસટી @ 9%', igst: 'આઇજીએસટી @ 18%', totalTax: 'કુલ કર',
    total: 'કુલ', amountWords: 'શબ્દોમાં રકમ', payment: 'પેમેન્ટ સ્થિતિ', declaration: 'ઘોષણા',
    authorized: 'અધિકૃત સહી', terms: 'શરતો અને નોંધો', generated: 'આ કમ્પ્યુટર દ્વારા બનાવેલ ઇનવોઇસ છે.',
    reference: 'પેમેન્ટ સંદર્ભ', method: 'રીત',
  },
};

interface InvoiceItem { name: string; quantity: number; unitPrice: number; total: number; hsn?: string; }
interface InvoiceOrder {
  id: string; order_number?: string | null; created_at: string | null; total_amount: number | string | null;
  customer_name: string | null; customer_email: string | null; customer_phone: string | null;
  customer_address: string | null; customer_city: string | null; customer_state: string | null;
  customer_zip: string | null; customer_country: string | null; customer_gst: string | null;
  shipping_address: Record<string, unknown> | null;
}
interface InvoicePayment { payment_status?: string | null; payment_method?: string | null; payment_transaction_id?: string | null; }
export interface InvoiceRenderData { order: InvoiceOrder; items: InvoiceItem[]; payment?: InvoicePayment | null; language: SupportedLanguage; }

function money(amount: number): string {
  return `INR ${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) { lines.push(line); line = word; } else line = candidate;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function drawWrapped(page: PDFPage, text: string, x: number, y: number, width: number, font: PDFFont, size: number, color = INK, leading = 3): number {
  const lines = wrap(text, font, size, width);
  lines.forEach((line, index) => page.drawText(line, { x, y: y - index * (size + leading), size, font, color }));
  return y - lines.length * (size + leading);
}

function rightText(page: PDFPage, text: string, right: number, y: number, size: number, font: PDFFont, color = INK): void {
  page.drawText(text, { x: right - font.widthOfTextAtSize(text, size), y, size, font, color });
}

function numberToWords(num: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const chunk = (value: number): string => value < 20 ? ones[value] : value < 100 ? `${tens[Math.floor(value / 10)]}${value % 10 ? ` ${ones[value % 10]}` : ''}` : `${ones[Math.floor(value / 100)]} Hundred${value % 100 ? ` and ${chunk(value % 100)}` : ''}`;
  let remainder = Math.max(0, Math.round(num));
  if (!remainder) return 'Zero Rupees Only';
  const parts: string[] = [];
  const crore = Math.floor(remainder / 10_000_000); remainder %= 10_000_000;
  const lakh = Math.floor(remainder / 100_000); remainder %= 100_000;
  const thousand = Math.floor(remainder / 1_000); remainder %= 1_000;
  if (crore) parts.push(`${chunk(crore)} Crore`);
  if (lakh) parts.push(`${chunk(lakh)} Lakh`);
  if (thousand) parts.push(`${chunk(thousand)} Thousand`);
  if (remainder) parts.push(chunk(remainder));
  return `${parts.join(' ')} Rupees Only`;
}

function shippingValue(order: InvoiceOrder, key: string): string {
  const shipping = order.shipping_address ?? {};
  const direct = order[`customer_${key}` as keyof InvoiceOrder];
  const fallback = shipping[key] ?? (key === 'zip' ? shipping.postalCode : undefined);
  return String(direct ?? fallback ?? '').trim();
}

function sourceLabel(order: InvoiceOrder): string {
  const source = String(order.shipping_address?.source ?? '').toLowerCase();
  if (source.includes('whatsapp')) return 'WhatsApp chatbot';
  if (source.includes('voice') || source.includes('smartflo')) return 'Voice agent';
  if (source.includes('offline') || source.includes('manual')) return 'Offline order';
  return 'Website';
}

async function embedInvoiceFont(pdf: PDFDocument, language: SupportedLanguage): Promise<PDFFont> {
  if (language === 'en') return pdf.embedFont(StandardFonts.Helvetica);
  pdf.registerFontkit(fontkit);
  const filename = language === 'hi' ? 'NotoSansDevanagari-Regular.ttf' : 'NotoSansGujarati-Regular.ttf';
  const bytes = await readFile(resolve(process.cwd(), 'assets', 'fonts', filename));
  return pdf.embedFont(bytes, { subset: true });
}

function drawCell(page: PDFPage, text: string, x: number, y: number, width: number, font: PDFFont, size: number, align: 'left' | 'right' | 'center' = 'left'): void {
  const value = wrap(text, font, size, width - 8)[0];
  const textWidth = font.widthOfTextAtSize(value, size);
  const drawX = align === 'right' ? x + width - textWidth - 5 : align === 'center' ? x + (width - textWidth) / 2 : x + 5;
  page.drawText(value, { x: drawX, y, size, font, color: INK });
}

function companyValue(key: string, fallback: string): string { return (process.env[key] || fallback).trim(); }

/** Renders a single-page Indian tax invoice in the grid style of the supplied reference. */
export async function renderInvoicePdf(data: InvoiceRenderData): Promise<Buffer> {
  const { order, items, payment, language } = data;
  const copy = COPY[language];
  const pdf = await PDFDocument.create();
  const page = pdf.addPage(A4);
  const font = await embedInvoiceFont(pdf, language);
  const bold = language === 'en' ? await pdf.embedFont(StandardFonts.HelveticaBold) : font;
  const width = A4[0]; const left = 28; const right = width - left; const contentWidth = right - left;
  const total = Number(order.total_amount ?? 0);
  const state = shippingValue(order, 'state'); const country = shippingValue(order, 'country') || 'India';
  const isIndia = /india|भारत|ભારત/iu.test(country); const isGujarat = /gujarat|गुजरात|ગુજરાત/iu.test(state);
  const tax = isIndia ? total - total / 1.18 : 0; const taxable = total - tax;
  const customerName = shippingValue(order, 'name') || 'Customer';
  const email = shippingValue(order, 'email'); const phone = shippingValue(order, 'phone');
  const address = [shippingValue(order, 'address'), shippingValue(order, 'city'), state, shippingValue(order, 'zip'), country].filter(Boolean).join(', ');
  const orderNumber = String(order.order_number || order.id);
  const date = new Date(order.created_at ?? Date.now()).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const sellerName = companyValue('INVOICE_COMPANY_NAME', 'Earthora Farms & Foods Pvt. Ltd.');
  const sellerAddress = companyValue('INVOICE_COMPANY_ADDRESS', 'Shop No 02, Shree Krishna Apartment, Nr. Stock Yard Estate, Ahmedabad, Gujarat - 382210');
  const sellerEmail = companyValue('INVOICE_COMPANY_EMAIL', 'contactus@earthorafarms.com');
  const sellerPhone = companyValue('INVOICE_COMPANY_PHONE', '9825346884'); const sellerGstin = companyValue('INVOICE_COMPANY_GSTIN', '24AAACE1234F1Z5');
  const paymentStatus = String(payment?.payment_status || 'paid').toUpperCase();
  const displayItems = items.slice(0, 8); const totalQty = displayItems.reduce((sum, item) => sum + item.quantity, 0);

  let y = 812;
  page.drawText(copy.invoice, { x: left, y, size: 16, font: bold, color: INK });
  page.drawRectangle({ x: left + 106, y: y - 2, width: 58, height: 15, borderColor: GREEN, borderWidth: 0.8 });
  page.drawText(copy.original, { x: left + 113, y: y + 2, size: 7.5, font: bold, color: GREEN });
  rightText(page, sellerName, right, y + 1, 12, bold, GREEN); y -= 22;

  const metaTop = y; const metaHeight = 74;
  page.drawRectangle({ x: left, y: metaTop - metaHeight, width: contentWidth, height: metaHeight, borderColor: RULE, borderWidth: 0.9 });
  page.drawLine({ start: { x: 316, y: metaTop }, end: { x: 316, y: metaTop - metaHeight }, thickness: 0.9, color: RULE });
  page.drawText(sellerName, { x: left + 8, y: metaTop - 16, size: 10, font: bold, color: INK });
  const sellerY = drawWrapped(page, sellerAddress, left + 8, metaTop - 29, 270, font, 7.5, INK, 1.5);
  page.drawText(`${sellerEmail}${sellerPhone ? `  |  ${sellerPhone}` : ''}`, { x: left + 8, y: sellerY - 3, size: 7.5, font, color: MUTED });
  if (sellerGstin) page.drawText(`GSTIN: ${sellerGstin}`, { x: left + 8, y: sellerY - 15, size: 7.5, font: bold, color: INK });
  const metaX = 330;
  page.drawText(copy.invoiceNo, { x: metaX, y: metaTop - 16, size: 7.5, font: bold, color: MUTED });
  page.drawText(orderNumber, { x: metaX, y: metaTop - 28, size: 9, font: bold, color: INK });
  page.drawText(copy.invoiceDate, { x: 456, y: metaTop - 16, size: 7.5, font: bold, color: MUTED });
  page.drawText(date, { x: 456, y: metaTop - 28, size: 9, font: bold, color: INK });
  page.drawText(copy.source, { x: metaX, y: metaTop - 46, size: 7.5, font: bold, color: MUTED });
  page.drawText(sourceLabel(order), { x: metaX, y: metaTop - 58, size: 8.5, font: bold, color: INK });
  page.drawText(`${copy.payment}: ${paymentStatus}`, { x: 456, y: metaTop - 52, size: 7.5, font: bold, color: GREEN });
  y = metaTop - metaHeight;

  const partyTop = y; const partyHeight = 88;
  page.drawRectangle({ x: left, y: partyTop - partyHeight, width: contentWidth, height: partyHeight, borderColor: RULE, borderWidth: 0.9 });
  page.drawLine({ start: { x: 310, y: partyTop }, end: { x: 310, y: partyTop - partyHeight }, thickness: 0.9, color: RULE });
  const drawParty = (title: string, x: number, partyWidth: number) => {
    page.drawText(title, { x: x + 8, y: partyTop - 14, size: 8, font: bold, color: MUTED });
    page.drawText(customerName, { x: x + 8, y: partyTop - 28, size: 9.5, font: bold, color: INK });
    const partyY = drawWrapped(page, address || country, x + 8, partyTop - 41, partyWidth - 16, font, 7.8, INK, 2);
    if (email) page.drawText(`Email: ${email}`, { x: x + 8, y: partyY - 1, size: 7.2, font, color: MUTED });
    if (phone) page.drawText(`Phone: ${phone}`, { x: x + 8, y: partyY - 12, size: 7.2, font, color: MUTED });
    const gst = shippingValue(order, 'gst'); if (gst) page.drawText(`GSTIN: ${gst}`, { x: x + 8, y: partyY - 23, size: 7.2, font: bold, color: INK });
  };
  drawParty(copy.billTo, left, 310 - left); drawParty(copy.shipTo, 310, right - 310); y = partyTop - partyHeight;

  const tableTop = y; const tableHeight = 232; const tableBottom = tableTop - tableHeight;
  page.drawRectangle({ x: left, y: tableBottom, width: contentWidth, height: tableHeight, borderColor: RULE, borderWidth: 0.9 });
  const columns = [left, left + 34, left + 264, left + 322, left + 377, left + 452, right];
  columns.slice(1, -1).forEach((x) => page.drawLine({ start: { x, y: tableTop }, end: { x, y: tableBottom }, thickness: 0.7, color: RULE }));
  const headerHeight = 27;
  page.drawRectangle({ x: left + 0.5, y: tableTop - headerHeight, width: contentWidth - 1, height: headerHeight - 0.5, color: PALE_GREEN });
  page.drawLine({ start: { x: left, y: tableTop - headerHeight }, end: { x: right, y: tableTop - headerHeight }, thickness: 0.8, color: RULE });
  const headers = ['No.', copy.item, copy.hsn, copy.quantity, copy.rate, copy.amount];
  headers.forEach((header, index) => drawCell(page, header, columns[index], tableTop - 17, columns[index + 1] - columns[index], bold, 7.2, index > 2 ? 'right' : 'left'));
  const rowHeight = 22;
  displayItems.forEach((item, index) => {
    const rowY = tableTop - headerHeight - 15 - index * rowHeight;
    page.drawLine({ start: { x: left, y: rowY - 8 }, end: { x: right, y: rowY - 8 }, thickness: 0.35, color: RULE });
    drawCell(page, String(index + 1), columns[0], rowY, columns[1] - columns[0], font, 8);
    drawCell(page, item.name, columns[1], rowY, columns[2] - columns[1], font, 8);
    drawCell(page, item.hsn || '-', columns[2], rowY, columns[3] - columns[2], font, 7.5);
    drawCell(page, `${item.quantity} NOS`, columns[3], rowY, columns[4] - columns[3], font, 7.5, 'right');
    drawCell(page, money(item.unitPrice), columns[4], rowY, columns[5] - columns[4], font, 7.5, 'right');
    drawCell(page, money(item.total), columns[5], rowY, columns[6] - columns[5], font, 7.5, 'right');
  });
  const totalRowY = tableBottom + 21;
  page.drawLine({ start: { x: left, y: totalRowY + 10 }, end: { x: right, y: totalRowY + 10 }, thickness: 0.8, color: RULE });
  rightText(page, copy.total, columns[2] - 8, totalRowY, 8.5, bold, INK);
  drawCell(page, `${totalQty} NOS`, columns[3], totalRowY, columns[4] - columns[3], bold, 8.5, 'right');
  drawCell(page, money(total), columns[5], totalRowY, columns[6] - columns[5], bold, 8.5, 'right'); y = tableBottom - 9;

  const taxTop = y; const taxHeight = 70;
  page.drawRectangle({ x: left, y: taxTop - taxHeight, width: contentWidth, height: taxHeight, borderColor: RULE, borderWidth: 0.9 });
  page.drawLine({ start: { x: left, y: taxTop - 24 }, end: { x: right, y: taxTop - 24 }, thickness: 0.7, color: RULE });
  const taxCols = [left, left + 78, left + 185, left + 275, left + 365, left + 455, right];
  taxCols.slice(1, -1).forEach((x) => page.drawLine({ start: { x, y: taxTop }, end: { x, y: taxTop - taxHeight }, thickness: 0.6, color: RULE }));
  const taxHeaders = [copy.hsn, copy.taxable, copy.cgst, copy.sgst, copy.igst, copy.totalTax];
  taxHeaders.forEach((header, index) => drawCell(page, header, taxCols[index], taxTop - 15, taxCols[index + 1] - taxCols[index], bold, 6.8, index > 0 ? 'right' : 'left'));
  drawCell(page, displayItems[0]?.hsn || '-', taxCols[0], taxTop - 39, taxCols[1] - taxCols[0], font, 7.2);
  drawCell(page, money(taxable), taxCols[1], taxTop - 39, taxCols[2] - taxCols[1], font, 7.2, 'right');
  drawCell(page, isIndia && isGujarat ? money(tax / 2) : '-', taxCols[2], taxTop - 39, taxCols[3] - taxCols[2], font, 7.2, 'right');
  drawCell(page, isIndia && isGujarat ? money(tax / 2) : '-', taxCols[3], taxTop - 39, taxCols[4] - taxCols[3], font, 7.2, 'right');
  drawCell(page, isIndia && !isGujarat ? money(tax) : '-', taxCols[4], taxTop - 39, taxCols[5] - taxCols[4], font, 7.2, 'right');
  drawCell(page, money(tax), taxCols[5], taxTop - 39, taxCols[6] - taxCols[5], bold, 7.2, 'right'); y = taxTop - taxHeight - 8;

  const wordsTop = y;
  page.drawRectangle({ x: left, y: wordsTop - 34, width: contentWidth, height: 34, borderColor: RULE, borderWidth: 0.9 });
  page.drawText(copy.amountWords, { x: left + 8, y: wordsTop - 13, size: 7.5, font: bold, color: MUTED });
  page.drawText(numberToWords(total), { x: left + 8, y: wordsTop - 26, size: 8.5, font: bold, color: INK }); y = wordsTop - 42;

  const footerTop = y; const footerHeight = 92;
  page.drawRectangle({ x: left, y: footerTop - footerHeight, width: contentWidth, height: footerHeight, borderColor: RULE, borderWidth: 0.9 });
  page.drawLine({ start: { x: left + 184, y: footerTop }, end: { x: left + 184, y: footerTop - footerHeight }, thickness: 0.7, color: RULE });
  page.drawLine({ start: { x: left + 360, y: footerTop }, end: { x: left + 360, y: footerTop - footerHeight }, thickness: 0.7, color: RULE });
  page.drawText(copy.payment, { x: left + 7, y: footerTop - 14, size: 7.5, font: bold, color: MUTED });
  page.drawText(paymentStatus, { x: left + 7, y: footerTop - 29, size: 11, font: bold, color: GREEN });
  if (payment?.payment_method) page.drawText(`${copy.method}: ${payment.payment_method}`, { x: left + 7, y: footerTop - 45, size: 7.2, font, color: INK });
  if (payment?.payment_transaction_id) drawWrapped(page, `${copy.reference}: ${payment.payment_transaction_id}`, left + 7, footerTop - 59, 166, font, 6.8, MUTED, 2);
  page.drawText(copy.declaration, { x: left + 191, y: footerTop - 14, size: 7.5, font: bold, color: MUTED });
  drawWrapped(page, 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.', left + 191, footerTop - 28, 160, font, 7.2, INK, 2);
  page.drawText(copy.terms, { x: left + 367, y: footerTop - 14, size: 7.5, font: bold, color: MUTED });
  drawWrapped(page, 'Goods once sold will not be taken back or exchanged. Delivery timelines may vary by destination.', left + 367, footerTop - 28, 164, font, 7.2, INK, 2);
  rightText(page, `${copy.authorized} - ${sellerName}`, right - 7, footerTop - 76, 7.3, bold, INK);
  page.drawText(copy.generated, { x: left, y: 40, size: 7.3, font, color: MUTED });
  rightText(page, 'Earthora Farms | earthorafarms.com', right, 40, 7.3, font, MUTED);
  return Buffer.from(await pdf.save());
}

/** Creates the PDF served to WhatsApp and the voice checkout invoice route. */
export async function generateInvoicePdf(orderId: string, language: SupportedLanguage): Promise<Buffer> {
  const [{ data: orderData, error: orderError }, { data: itemRows, error: itemsError }, { data: paymentData }] = await Promise.all([
    supabase.from('orders').select('*').eq('id', orderId).maybeSingle(),
    supabase.from('order_items').select('quantity, unit_price, total_price, products(name)').eq('order_id', orderId),
    supabase.from('Payments').select('payment_status, payment_method, payment_transaction_id').eq('payment_order_id', orderId).maybeSingle(),
  ]);
  if (orderError) throw orderError;
  if (itemsError) throw itemsError;
  if (!orderData) throw new Error('invoice order not found');
  const items: InvoiceItem[] = (itemRows ?? []).map((row: Record<string, unknown>) => {
    const quantity = Number(row.quantity ?? 1); const unitPrice = Number(row.unit_price ?? 0);
    const product = row.products as { name?: string } | null;
    return { name: product?.name ?? 'Earthora Farms product', quantity, unitPrice, total: Number(row.total_price ?? unitPrice * quantity), hsn: '-' };
  });
  if (!items.length) {
    const total = Number((orderData as InvoiceOrder).total_amount ?? 0);
    items.push({ name: 'Earthora Farms product', quantity: 1, unitPrice: total, total, hsn: '-' });
  }
  return renderInvoicePdf({ order: orderData as InvoiceOrder, items, payment: paymentData as InvoicePayment | null, language });
}
