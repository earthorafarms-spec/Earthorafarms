import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
// @pdf-lib/fontkit's complex-script shaper expects this runtime global when
// embedding the Noto WOFF fonts used for Hindi and Gujarati invoices.
import 'regenerator-runtime/runtime.js';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { supabase } from '../lib/supabaseClient.js';
import type { SupportedLanguage } from '../conversation/language.js';

const A4: [number, number] = [595.28, 841.89];
const INK = rgb(0.08, 0.14, 0.1);
const MUTED = rgb(0.35, 0.4, 0.36);
const GREEN = rgb(0.12, 0.33, 0.21);
const RULE = rgb(0.78, 0.82, 0.79);

const COPY: Record<SupportedLanguage, Record<string, string>> = {
  en: {
    invoice: 'TAX INVOICE', billTo: 'BILL TO', invoiceNo: 'Invoice No.', invoiceDate: 'Invoice Date',
    item: 'Item', quantity: 'Qty.', unitPrice: 'Unit price', amount: 'Amount', subtotal: 'Subtotal',
    cgst: 'CGST (9%)', sgst: 'SGST (9%)', igst: 'IGST (18%)', total: 'TOTAL', gstin: 'GSTIN',
    place: 'Place of supply', payment: 'Payment status', paid: 'Paid', thankYou: 'Thank you for choosing Earthora Farms.',
  },
  hi: {
    invoice: 'टैक्स इनवॉइस', billTo: 'बिल प्राप्तकर्ता', invoiceNo: 'इनवॉइस नंबर', invoiceDate: 'इनवॉइस तारीख',
    item: 'सामान', quantity: 'मात्रा', unitPrice: 'यूनिट कीमत', amount: 'राशि', subtotal: 'सबटोटल',
    cgst: 'सीजीएसटी (9%)', sgst: 'एसजीएसटी (9%)', igst: 'आईजीएसटी (18%)', total: 'कुल', gstin: 'जीएसटीआईएन',
    place: 'सप्लाई का स्थान', payment: 'पेमेंट स्थिति', paid: 'पेड', thankYou: 'Earthora Farms चुनने के लिए धन्यवाद।',
  },
  gu: {
    invoice: 'ટેક્સ ઇન્વોઇસ', billTo: 'બિલ મેળવનાર', invoiceNo: 'ઇન્વોઇસ નંબર', invoiceDate: 'ઇન્વોઇસ તારીખ',
    item: 'વસ્તુ', quantity: 'જથ્થો', unitPrice: 'યુનિટ કિંમત', amount: 'રકમ', subtotal: 'સબટોટલ',
    cgst: 'સીજીએસટી (9%)', sgst: 'એસજીએસટી (9%)', igst: 'આઇજીએસટી (18%)', total: 'કુલ', gstin: 'જીએસટીઆઇએન',
    place: 'સપ્લાયનું સ્થળ', payment: 'પેમેન્ટ સ્થિતિ', paid: 'ચૂકવેલ', thankYou: 'Earthora Farms પસંદ કરવા બદલ આભાર.',
  },
};

interface InvoiceItem {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface InvoiceOrder {
  id: string;
  order_number?: string | null;
  created_at: string | null;
  total_amount: number | string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  customer_city: string | null;
  customer_state: string | null;
  customer_zip: string | null;
  customer_country: string | null;
  customer_gst: string | null;
  shipping_address: Record<string, unknown> | null;
}

function money(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function drawWrapped(page: PDFPage, text: string, x: number, y: number, width: number, font: PDFFont, size: number, color = INK): number {
  const lines = wrap(text, font, size, width);
  lines.forEach((line, index) => page.drawText(line, { x, y: y - index * (size + 3), size, font, color }));
  return y - lines.length * (size + 3);
}

async function embedInvoiceFont(pdf: PDFDocument, language: SupportedLanguage): Promise<PDFFont> {
  if (language === 'en') return pdf.embedFont(StandardFonts.Helvetica);
  pdf.registerFontkit(fontkit);
  // Fontsource's web fonts are split by Unicode range. A complete local TTF
  // is required here because an invoice frequently mixes native-script
  // addresses with Roman product names, currency and order numbers.
  const filename = language === 'hi' ? 'NotoSansDevanagari-Regular.ttf' : 'NotoSansGujarati-Regular.ttf';
  const bytes = await readFile(resolve(process.cwd(), 'assets', 'fonts', filename));
  return pdf.embedFont(bytes, { subset: true });
}

function shippingValue(order: InvoiceOrder, key: string): string {
  const shipping = order.shipping_address ?? {};
  const direct = order[`customer_${key}` as keyof InvoiceOrder];
  const fallback = shipping[key] ?? (key === 'zip' ? shipping.postalCode : undefined);
  return String(direct ?? fallback ?? '').trim();
}

/**
 * Creates the PDF served to WhatsApp. This intentionally lives in the voice
 * service, rather than relying on the storefront SPA, so a signed invoice URL
 * always returns application/pdf even if the storefront's hosting rewrites are
 * temporarily unavailable.
 */
export async function generateInvoicePdf(orderId: string, language: SupportedLanguage): Promise<Buffer> {
  const [{ data: orderData, error: orderError }, { data: itemRows, error: itemsError }] = await Promise.all([
    supabase.from('orders').select('*').eq('id', orderId).maybeSingle(),
    supabase.from('order_items').select('quantity, unit_price, total_price, products(name)').eq('order_id', orderId),
  ]);
  if (orderError) throw orderError;
  if (itemsError) throw itemsError;
  if (!orderData) throw new Error('invoice order not found');

  const order = orderData as InvoiceOrder;
  const total = Number(order.total_amount ?? 0);
  const items: InvoiceItem[] = (itemRows ?? []).map((row: Record<string, unknown>) => {
    const quantity = Number(row.quantity ?? 1);
    const unitPrice = Number(row.unit_price ?? 0);
    const totalPrice = Number(row.total_price ?? unitPrice * quantity);
    const product = row.products as { name?: string } | null;
    return { name: product?.name ?? 'Earthora Farms product', quantity, unitPrice, total: totalPrice };
  });
  if (!items.length) items.push({ name: 'Earthora Farms product', quantity: 1, unitPrice: total, total });

  const copy = COPY[language];
  const state = shippingValue(order, 'state');
  const country = shippingValue(order, 'country') || (language === 'hi' ? 'भारत' : language === 'gu' ? 'ભારત' : 'India');
  const isGujarat = /gujarat|गुजरात|ગુજરાત/iu.test(state);
  const taxable = total / 1.18;
  const tax = total - taxable;
  const customerName = shippingValue(order, 'name') || 'Customer';
  const address = [shippingValue(order, 'address'), shippingValue(order, 'city'), state, shippingValue(order, 'zip'), country].filter(Boolean).join(', ');
  const orderNumber = String(order.order_number || orderId);
  const date = new Date(order.created_at ?? Date.now()).toLocaleDateString('en-IN');

  const pdf = await PDFDocument.create();
  const page = pdf.addPage(A4);
  const font = await embedInvoiceFont(pdf, language);
  const bold = language === 'en' ? await pdf.embedFont(StandardFonts.HelveticaBold) : font;
  const width = A4[0];
  const margin = 42;
  let y = 796;

  page.drawRectangle({ x: margin, y: y - 56, width: width - margin * 2, height: 56, color: GREEN });
  page.drawText('Earthora Farms', { x: margin + 16, y: y - 24, size: 18, font: bold, color: rgb(1, 1, 1) });
  page.drawText(copy.invoice, { x: margin + 16, y: y - 44, size: 10, font, color: rgb(0.9, 0.96, 0.91) });
  y -= 78;

  page.drawText(copy.billTo, { x: margin, y, size: 9, font: bold, color: MUTED });
  y -= 16;
  page.drawText(customerName, { x: margin, y, size: 11, font: bold, color: INK });
  y = drawWrapped(page, address || country, margin, y - 15, 280, font, 8.5);
  const gst = shippingValue(order, 'gst');
  if (gst) page.drawText(`${copy.gstin}: ${gst}`, { x: margin, y: y - 4, size: 8, font, color: MUTED });

  const right = width - margin - 180;
  page.drawText(copy.invoiceNo, { x: right, y: 718, size: 8, font, color: MUTED });
  page.drawText(orderNumber, { x: right, y: 703, size: 10, font: bold, color: INK });
  page.drawText(copy.invoiceDate, { x: right, y: 680, size: 8, font, color: MUTED });
  page.drawText(date, { x: right, y: 665, size: 10, font: bold, color: INK });
  page.drawText(copy.place, { x: right, y: 642, size: 8, font, color: MUTED });
  page.drawText(state || country, { x: right, y: 627, size: 10, font: bold, color: INK });

  y = 578;
  const cols = { item: margin + 10, qty: 344, unit: 406, amount: 496 };
  page.drawRectangle({ x: margin, y: y - 24, width: width - margin * 2, height: 24, color: rgb(0.93, 0.96, 0.93) });
  page.drawText(copy.item, { x: cols.item, y: y - 16, size: 8, font: bold, color: INK });
  page.drawText(copy.quantity, { x: cols.qty, y: y - 16, size: 8, font: bold, color: INK });
  page.drawText(copy.unitPrice, { x: cols.unit, y: y - 16, size: 8, font: bold, color: INK });
  page.drawText(copy.amount, { x: cols.amount, y: y - 16, size: 8, font: bold, color: INK });
  y -= 40;

  for (const item of items.slice(0, 8)) {
    const nameLines = wrap(item.name, font, 9, 270);
    page.drawText(nameLines[0], { x: cols.item, y, size: 9, font, color: INK });
    if (nameLines[1]) page.drawText(nameLines[1], { x: cols.item, y: y - 12, size: 9, font, color: INK });
    page.drawText(String(item.quantity), { x: cols.qty, y, size: 9, font, color: INK });
    page.drawText(money(item.unitPrice), { x: cols.unit, y, size: 9, font, color: INK });
    page.drawText(money(item.total), { x: cols.amount, y, size: 9, font, color: INK });
    y -= nameLines.length > 1 ? 30 : 22;
  }
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.8, color: RULE });
  y -= 20;

  const totalX = 400;
  const taxRows: Array<[string, string]> = isGujarat
    ? [[copy.cgst, money(tax / 2)], [copy.sgst, money(tax / 2)]]
    : [[copy.igst, money(tax)]];
  const totals: Array<[string, string]> = [
    [copy.subtotal, money(taxable)],
    ...taxRows,
    [copy.total, money(total)],
  ];
  for (const [label, value] of totals) {
    const isTotal = label === copy.total;
    page.drawText(label, { x: totalX - 90, y, size: isTotal ? 10 : 8.5, font: isTotal ? bold : font, color: INK });
    page.drawText(value, { x: totalX + 70, y, size: isTotal ? 10 : 8.5, font: isTotal ? bold : font, color: INK });
    y -= isTotal ? 24 : 17;
  }
  y -= 18;
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.8, color: RULE });
  page.drawText(`${copy.payment}: ${copy.paid}`, { x: margin, y: y - 20, size: 8.5, font: bold, color: GREEN });
  page.drawText(copy.thankYou, { x: margin, y: y - 42, size: 8.5, font, color: MUTED });

  return Buffer.from(await pdf.save());
}
