// supabase/functions/send-invoice/index.ts
// Supabase Edge Function — generates official Indian Tax Invoice PDF (Matching Mahi Enterprise grid layout) & dispatches via Resend API.

// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-password",
};

function numberToWords(num: number): string {
  const a = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"
  ];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  const value = Math.round(num);
  if (value === 0) return "Zero";

  function chunk(n: number): string {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? " " + a[n % 10] : "");
    return a[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " and " + chunk(n % 100) : "");
  }

  const crores = Math.floor(value / 10000000);
  let rem = value % 10000000;
  const lakhs = Math.floor(rem / 100000);
  rem %= 100000;
  const thousands = Math.floor(rem / 1000);
  rem %= 1000;
  const hundreds = Math.floor(rem / 100);
  const remaining = rem % 100;

  let str = "";
  if (crores) str += chunk(crores) + " Crore ";
  if (lakhs) str += chunk(lakhs) + " Lakh ";
  if (thousands) str += chunk(thousands) + " Thousand ";
  if (hundreds) str += chunk(hundreds) + " Hundred ";
  if (remaining) {
    if (str !== "") str += "and ";
    str += chunk(remaining);
  }
  return str.trim() + " Rupees";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { orderId } = (await req.json()) as { orderId?: string };

    if (!orderId) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing required field: orderId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY_ADMIN") || Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.warn("[send-invoice] RESEND_API_KEY secret is not configured in Supabase secrets.");
      return new Response(
        JSON.stringify({ ok: false, warning: "RESEND_API_KEY secret not configured in Supabase secrets." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Fetch Order details
    let order = null;
    const { data: orderData } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .maybeSingle();

    if (orderData) {
      order = orderData;
    } else {
      const { data: capOrders } = await supabase
        .from("Orders")
        .select("*")
        .eq("id", orderId);

      if (capOrders && capOrders.length > 0) {
        const firstRow = capOrders[0];
        order = {
          id: firstRow.id,
          order_number: firstRow.order_number || firstRow.id,
          created_at: firstRow.order_created_at || new Date().toISOString(),
          total_amount: Number(firstRow.order_amount || 0),
          customer_email: firstRow.order_user_id,
          shipping_address: firstRow.shipping_address || {},
        };
      }
    }

    if (!order) {
      return new Response(
        JSON.stringify({ ok: false, error: `Order not found: ${orderId}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const orderNumber = String(order.order_number || orderId);

    // 2. Fetch Order items
    let orderItems = [];
    const { data: itemsData } = await supabase
      .from("order_items")
      .select("*, products(*)")
      .eq("order_id", orderId);

    if (itemsData && itemsData.length > 0) {
      orderItems = itemsData;
    } else {
      const { data: capItems } = await supabase
        .from("Orders")
        .select("*")
        .eq("id", orderId);

      if (capItems && capItems.length > 0) {
        orderItems = capItems.map((ci) => ({
          quantity: Number(ci.order_product_quantity || 1),
          total_price: Number(ci.order_amount || ci.order_product_price || order.total_amount),
          unit_price: Number(ci.order_product_price || order.total_amount),
          products: {
            name: "Organic Moringa Supplement",
            hsn_code: "12119029",
          },
        }));
      }
    }

    if (!orderItems || orderItems.length === 0) {
      orderItems = [{
        quantity: 1,
        total_price: Number(order.total_amount),
        unit_price: Number(order.total_amount),
        products: {
          name: "Organic Moringa Supplement",
          hsn_code: "12119029",
        },
      }];
    }

    // 3. Fetch Payment details
    const { data: payment } = await supabase
      .from("Payments")
      .select("*")
      .eq("payment_order_id", orderId)
      .maybeSingle();

    const shipping = order.shipping_address || {};
    const recipientEmail = (order.customer_email || shipping.email || order.user_id || "").trim();
    const recipientName = (order.customer_name || shipping.name || "Customer").toUpperCase();
    const recipientPhone = order.customer_phone || shipping.phone || "9825346884";
    const recipientGst = order.customer_gst || shipping.gst || "N/A";
    const recipientState = (order.customer_state || shipping.state || "Gujarat").trim();
    const fullAddress = `${order.customer_address || shipping.address || ""}, ${order.customer_city || shipping.city || ""}, ${recipientState} - ${order.customer_zip || shipping.zip || ""}, ${order.customer_country || shipping.country || "India"}`;

    const invoiceDateStr = new Date(order.created_at || Date.now()).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

    const totalAmount = Number(order.total_amount || 0);
    const stateStr = recipientState.toLowerCase();
    const isIntraState = stateStr.includes("gujarat") || stateStr === "gj" || stateStr === "guj";

    // ══════════════════════════════════════════════════════════════════════════
    // PDF GENERATION VIA PDF-LIB (EXACT MAHI ENTERPRISE TAX INVOICE GRID)
    // ══════════════════════════════════════════════════════════════════════════
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const black = rgb(0, 0, 0);
    const darkGray = rgb(0.2, 0.2, 0.2);

    const leftMargin = 30;
    const rightMargin = 565;
    const width = 535;

    let y = 810;

    // 1. TOP HEADER TITLE
    page.drawText("TAX INVOICE", { x: leftMargin, y, size: 11, font: fontBold, color: black });
    page.drawRectangle({ x: 105, y: y - 2, width: 55, height: 14, borderColor: black, borderWidth: 0.8 });
    page.drawText("ORIGINAL", { x: 110, y: y + 1, size: 7.5, font: fontBold, color: black });

    y -= 15;

    // 2. COMPANY & INVOICE NO / DATE HEADER BOX
    const topBoxY = y;
    const topBoxHeight = 65;
    page.drawRectangle({ x: leftMargin, y: topBoxY - topBoxHeight, width, height: topBoxHeight, borderColor: black, borderWidth: 1 });
    page.drawLine({ start: { x: 300, y: topBoxY }, end: { x: 300, y: topBoxY - topBoxHeight }, thickness: 1, color: black });

    let sellerY = topBoxY - 14;
    page.drawText("Earthora Farms & Foods Pvt. Ltd.", { x: leftMargin + 6, y: sellerY, size: 10, font: fontBold, color: black });
    sellerY -= 12;
    page.drawText("Shop No 02, Shree Krishna Apartment Nr Stock Yard Estate", { x: leftMargin + 6, y: sellerY, size: 8, font, color: black });
    sellerY -= 11;
    page.drawText("Ahmedabad, Gujarat, 382210., Ahmedabad, Gujarat, 382210", { x: leftMargin + 6, y: sellerY, size: 8, font, color: black });
    sellerY -= 12;
    page.drawText("GSTIN: 24AAACE1234F1Z5  Mobile: 9825346884", { x: leftMargin + 6, y: sellerY, size: 8, font: fontBold, color: black });

    page.drawText("Invoice No.", { x: 340, y: topBoxY - 18, size: 8.5, font: fontBold, color: black });
    page.drawText(`${orderNumber}/26-27`, { x: 340, y: topBoxY - 30, size: 9, font: fontBold, color: black });

    page.drawText("Invoice Date", { x: 460, y: topBoxY - 18, size: 8.5, font: fontBold, color: black });
    page.drawText(invoiceDateStr, { x: 460, y: topBoxY - 30, size: 9, font: fontBold, color: black });

    y = topBoxY - topBoxHeight;

    // 3. BILL TO / SHIP TO BOX
    const billBoxY = y;
    const billBoxHeight = 70;
    page.drawRectangle({ x: leftMargin, y: billBoxY - billBoxHeight, width, height: billBoxHeight, borderColor: black, borderWidth: 1 });
    page.drawLine({ start: { x: 290, y: billBoxY }, end: { x: 290, y: billBoxY - billBoxHeight }, thickness: 1, color: black });

    let billY = billBoxY - 12;
    page.drawText("BILL TO", { x: leftMargin + 6, y: billY, size: 8, font: fontBold, color: black });
    billY -= 12;
    page.drawText(recipientName, { x: leftMargin + 6, y: billY, size: 9, font: fontBold, color: black });
    billY -= 11;
    page.drawText(`Address: ${fullAddress.substring(0, 52)}`, { x: leftMargin + 6, y: billY, size: 7.5, font, color: black });
    billY -= 11;
    if (fullAddress.length > 52) {
      page.drawText(fullAddress.substring(52, 105), { x: leftMargin + 45, y: billY, size: 7.5, font, color: black });
      billY -= 11;
    }
    page.drawText(`GSTIN: ${recipientGst}    Place of Supply: ${recipientState}`, { x: leftMargin + 6, y: billY, size: 7.5, font, color: black });

    let shipY = billBoxY - 12;
    page.drawText("SHIP TO", { x: 296, y: shipY, size: 8, font: fontBold, color: black });
    shipY -= 12;
    page.drawText(recipientName, { x: 296, y: shipY, size: 9, font: fontBold, color: black });
    shipY -= 11;
    page.drawText(`Address: ${fullAddress.substring(0, 52)}`, { x: 296, y: shipY, size: 7.5, font, color: black });
    shipY -= 11;
    if (fullAddress.length > 52) {
      page.drawText(fullAddress.substring(52, 105), { x: 335, y: shipY, size: 7.5, font, color: black });
      shipY -= 11;
    }

    y = billBoxY - billBoxHeight;

    // 4. MAIN ITEMS TABLE
    const tableTopY = y;
    const tableHeight = 280;
    const tableBottomY = tableTopY - tableHeight;

    page.drawRectangle({ x: leftMargin, y: tableBottomY, width, height: tableHeight, borderColor: black, borderWidth: 1 });

    const colSno = 65;
    const colItems = 315;
    const colHsn = 375;
    const colQty = 425;
    const colRate = 495;

    page.drawLine({ start: { x: colSno, y: tableTopY }, end: { x: colSno, y: tableBottomY }, thickness: 1, color: black });
    page.drawLine({ start: { x: colItems, y: tableTopY }, end: { x: colItems, y: tableBottomY }, thickness: 1, color: black });
    page.drawLine({ start: { x: colHsn, y: tableTopY }, end: { x: colHsn, y: tableBottomY }, thickness: 1, color: black });
    page.drawLine({ start: { x: colQty, y: tableTopY }, end: { x: colQty, y: tableBottomY }, thickness: 1, color: black });
    page.drawLine({ start: { x: colRate, y: tableTopY }, end: { x: colRate, y: tableBottomY }, thickness: 1, color: black });

    const headerHeight = 20;
    page.drawLine({ start: { x: leftMargin, y: tableTopY - headerHeight }, end: { x: rightMargin, y: tableTopY - headerHeight }, thickness: 1, color: black });

    page.drawText("S.NO.", { x: leftMargin + 6, y: tableTopY - 14, size: 8, font: fontBold, color: black });
    page.drawText("ITEMS", { x: colSno + 70, y: tableTopY - 14, size: 8, font: fontBold, color: black });
    page.drawText("HSN", { x: colItems + 15, y: tableTopY - 14, size: 8, font: fontBold, color: black });
    page.drawText("QTY.", { x: colHsn + 12, y: tableTopY - 14, size: 8, font: fontBold, color: black });
    page.drawText("RATE", { x: colQty + 22, y: tableTopY - 14, size: 8, font: fontBold, color: black });
    page.drawText("AMOUNT", { x: colRate + 15, y: tableTopY - 14, size: 8, font: fontBold, color: black });

    let rowY = tableTopY - headerHeight - 16;
    let totalQty = 0;
    let totalTaxableVal = 0;
    let totalTaxAmount = 0;

    orderItems.forEach((item, index) => {
      const pName = (item.products?.name || "Organic Moringa Supplement").toUpperCase();
      const qty = Number(item.quantity || 1);
      const itemTotal = Number(item.total_price || (item.unit_price * qty));
      const taxableLine = itemTotal / 1.18;
      const ratePerUnit = taxableLine / qty;

      totalQty += qty;
      totalTaxableVal += taxableLine;
      totalTaxAmount += (itemTotal - taxableLine);

      page.drawText(String(index + 1), { x: leftMargin + 12, y: rowY, size: 8, font, color: black });
      page.drawText(pName.substring(0, 42), { x: colSno + 8, y: rowY, size: 8, font: fontBold, color: black });
      page.drawText(item.products?.hsn_code || "12119029", { x: colItems + 6, y: rowY, size: 8, font, color: black });
      page.drawText(`${qty} NOS`, { x: colHsn + 8, y: rowY, size: 8, font, color: black });
      page.drawText(ratePerUnit.toFixed(2), { x: colQty + 15, y: rowY, size: 8, font, color: black });
      page.drawText(taxableLine.toFixed(2), { x: colRate + 15, y: rowY, size: 8, font, color: black });

      rowY -= 14;
    });

    const taxCgstAmt = isIntraState ? (totalTaxAmount / 2) : 0;
    const taxSgstAmt = isIntraState ? (totalTaxAmount / 2) : 0;
    const taxIgstAmt = isIntraState ? 0 : totalTaxAmount;

    let taxRowY = tableBottomY + 50;
    if (isIntraState) {
      page.drawText("CGST @9%", { x: colSno + 120, y: taxRowY, size: 8.5, font: fontBold, color: black });
      page.drawText(`-`, { x: colHsn + 18, y: taxRowY, size: 8.5, font, color: black });
      page.drawText(`-`, { x: colQty + 28, y: taxRowY, size: 8.5, font, color: black });
      page.drawText(`${taxCgstAmt.toFixed(2)}`, { x: colRate + 15, y: taxRowY, size: 8.5, font: fontBold, color: black });

      taxRowY -= 16;
      page.drawText("SGST @9%", { x: colSno + 120, y: taxRowY, size: 8.5, font: fontBold, color: black });
      page.drawText(`-`, { x: colHsn + 18, y: taxRowY, size: 8.5, font, color: black });
      page.drawText(`-`, { x: colQty + 28, y: taxRowY, size: 8.5, font, color: black });
      page.drawText(`${taxSgstAmt.toFixed(2)}`, { x: colRate + 15, y: taxRowY, size: 8.5, font: fontBold, color: black });
    } else {
      page.drawText("IGST @18%", { x: colSno + 120, y: taxRowY, size: 8.5, font: fontBold, color: black });
      page.drawText(`-`, { x: colHsn + 18, y: taxRowY, size: 8.5, font, color: black });
      page.drawText(`-`, { x: colQty + 28, y: taxRowY, size: 8.5, font, color: black });
      page.drawText(`${taxIgstAmt.toFixed(2)}`, { x: colRate + 15, y: taxRowY, size: 8.5, font: fontBold, color: black });
    }

    const tableTotalY = tableBottomY + 22;
    page.drawLine({ start: { x: leftMargin, y: tableTotalY }, end: { x: rightMargin, y: tableTotalY }, thickness: 1, color: black });

    page.drawText("TOTAL", { x: colSno + 150, y: tableTotalY - 15, size: 9, font: fontBold, color: black });
    page.drawText(String(totalQty), { x: colHsn + 18, y: tableTotalY - 15, size: 9, font: fontBold, color: black });
    page.drawText(`Rs. ${totalAmount.toFixed(2)}`, { x: colRate + 10, y: tableTotalY - 15, size: 9, font: fontBold, color: black });

    y = tableBottomY - 10;

    // 5. HSN / SAC TAX BREAKDOWN GRID
    const hsnBoxY = y;
    const hsnBoxHeight = 55;
    page.drawRectangle({ x: leftMargin, y: hsnBoxY - hsnBoxHeight, width, height: hsnBoxHeight, borderColor: black, borderWidth: 1 });

    page.drawLine({ start: { x: leftMargin, y: hsnBoxY - 18 }, end: { x: rightMargin, y: hsnBoxY - 18 }, thickness: 1, color: black });
    page.drawLine({ start: { x: leftMargin, y: hsnBoxY - 36 }, end: { x: rightMargin, y: hsnBoxY - 36 }, thickness: 1, color: black });

    page.drawLine({ start: { x: 120, y: hsnBoxY }, end: { x: 120, y: hsnBoxY - hsnBoxHeight }, thickness: 1, color: black });
    page.drawLine({ start: { x: 210, y: hsnBoxY }, end: { x: 210, y: hsnBoxY - hsnBoxHeight }, thickness: 1, color: black });
    page.drawLine({ start: { x: 450, y: hsnBoxY }, end: { x: 450, y: hsnBoxY - hsnBoxHeight }, thickness: 1, color: black });

    if (isIntraState) {
      page.drawLine({ start: { x: 330, y: hsnBoxY }, end: { x: 330, y: hsnBoxY - hsnBoxHeight }, thickness: 1, color: black });
      page.drawLine({ start: { x: 210, y: hsnBoxY - 9 }, end: { x: 450, y: hsnBoxY - 9 }, thickness: 0.8, color: black });
      page.drawLine({ start: { x: 260, y: hsnBoxY - 9 }, end: { x: 260, y: hsnBoxY - hsnBoxHeight }, thickness: 0.8, color: black });
      page.drawLine({ start: { x: 380, y: hsnBoxY - 9 }, end: { x: 380, y: hsnBoxY - hsnBoxHeight }, thickness: 0.8, color: black });

      page.drawText("HSN/SAC", { x: leftMargin + 15, y: hsnBoxY - 13, size: 7.5, font: fontBold, color: black });
      page.drawText("Taxable Value", { x: 130, y: hsnBoxY - 13, size: 7.5, font: fontBold, color: black });
      page.drawText("CGST", { x: 255, y: hsnBoxY - 7, size: 7.5, font: fontBold, color: black });
      page.drawText("SGST", { x: 375, y: hsnBoxY - 7, size: 7.5, font: fontBold, color: black });
      page.drawText("Rate", { x: 220, y: hsnBoxY - 16, size: 6.5, font: fontBold, color: black });
      page.drawText("Amount", { x: 275, y: hsnBoxY - 16, size: 6.5, font: fontBold, color: black });
      page.drawText("Rate", { x: 345, y: hsnBoxY - 16, size: 6.5, font: fontBold, color: black });
      page.drawText("Amount", { x: 395, y: hsnBoxY - 16, size: 6.5, font: fontBold, color: black });
      page.drawText("Total Tax Amount", { x: 460, y: hsnBoxY - 13, size: 7.5, font: fontBold, color: black });

      page.drawText("12119029", { x: leftMargin + 12, y: hsnBoxY - 28, size: 7.5, font, color: black });
      page.drawText(totalTaxableVal.toFixed(2), { x: 135, y: hsnBoxY - 28, size: 7.5, font, color: black });
      page.drawText("9%", { x: 225, y: hsnBoxY - 28, size: 7.5, font, color: black });
      page.drawText(taxCgstAmt.toFixed(2), { x: 275, y: hsnBoxY - 28, size: 7.5, font, color: black });
      page.drawText("9%", { x: 350, y: hsnBoxY - 28, size: 7.5, font, color: black });
      page.drawText(taxSgstAmt.toFixed(2), { x: 395, y: hsnBoxY - 28, size: 7.5, font, color: black });
      page.drawText(`Rs. ${totalTaxAmount.toFixed(2)}`, { x: 460, y: hsnBoxY - 28, size: 7.5, font: fontBold, color: black });

      page.drawText("Total", { x: 70, y: hsnBoxY - 48, size: 8, font: fontBold, color: black });
      page.drawText(totalTaxableVal.toFixed(2), { x: 135, y: hsnBoxY - 48, size: 8, font: fontBold, color: black });
      page.drawText(taxCgstAmt.toFixed(2), { x: 275, y: hsnBoxY - 48, size: 8, font: fontBold, color: black });
      page.drawText(taxSgstAmt.toFixed(2), { x: 395, y: hsnBoxY - 48, size: 8, font: fontBold, color: black });
      page.drawText(`Rs. ${totalTaxAmount.toFixed(2)}`, { x: 460, y: hsnBoxY - 48, size: 8, font: fontBold, color: black });
    } else {
      page.drawText("HSN/SAC", { x: leftMargin + 15, y: hsnBoxY - 13, size: 7.5, font: fontBold, color: black });
      page.drawText("Taxable Value", { x: 140, y: hsnBoxY - 13, size: 7.5, font: fontBold, color: black });
      page.drawText("IGST Rate / Amount", { x: 260, y: hsnBoxY - 13, size: 7.5, font: fontBold, color: black });
      page.drawText("Total Tax Amount", { x: 460, y: hsnBoxY - 13, size: 7.5, font: fontBold, color: black });

      page.drawText("12119029", { x: leftMargin + 12, y: hsnBoxY - 28, size: 7.5, font, color: black });
      page.drawText(totalTaxableVal.toFixed(2), { x: 140, y: hsnBoxY - 28, size: 7.5, font, color: black });
      page.drawText(`18% (Rs. ${totalTaxAmount.toFixed(2)})`, { x: 260, y: hsnBoxY - 28, size: 7.5, font, color: black });
      page.drawText(`Rs. ${totalTaxAmount.toFixed(2)}`, { x: 460, y: hsnBoxY - 28, size: 7.5, font: fontBold, color: black });

      page.drawText("Total", { x: 70, y: hsnBoxY - 48, size: 8, font: fontBold, color: black });
      page.drawText(totalTaxableVal.toFixed(2), { x: 140, y: hsnBoxY - 48, size: 8, font: fontBold, color: black });
      page.drawText(`Rs. ${totalTaxAmount.toFixed(2)}`, { x: 460, y: hsnBoxY - 48, size: 8, font: fontBold, color: black });
    }

    y = hsnBoxY - hsnBoxHeight - 10;

    // 6. TOTAL AMOUNT IN WORDS BOX
    const wordsBoxY = y;
    const wordsBoxHeight = 24;
    page.drawRectangle({ x: leftMargin, y: wordsBoxY - wordsBoxHeight, width, height: wordsBoxHeight, borderColor: black, borderWidth: 1 });
    page.drawText("Total Amount (in words)", { x: leftMargin + 6, y: wordsBoxY - 10, size: 8, font: fontBold, color: black });
    page.drawText(numberToWords(totalAmount) + " Only", { x: leftMargin + 6, y: wordsBoxY - 20, size: 8, font, color: darkGray });

    y = wordsBoxY - wordsBoxHeight - 10;

    // 7. BOTTOM BOX: BANK DETAILS, TERMS, AUTHORISED SIGNATORY
    const bottomBoxY = y;
    const bottomBoxHeight = 85;
    page.drawRectangle({ x: leftMargin, y: bottomBoxY - bottomBoxHeight, width, height: bottomBoxHeight, borderColor: black, borderWidth: 1 });
    page.drawLine({ start: { x: 200, y: bottomBoxY }, end: { x: 200, y: bottomBoxY - bottomBoxHeight }, thickness: 1, color: black });
    page.drawLine({ start: { x: 380, y: bottomBoxY }, end: { x: 380, y: bottomBoxY - bottomBoxHeight }, thickness: 1, color: black });

    let bankY = bottomBoxY - 12;
    page.drawText("Bank Details", { x: leftMargin + 6, y: bankY, size: 8, font: fontBold, color: black });
    bankY -= 12;
    page.drawText("Name: Earthora Farms & Foods Pvt. Ltd.", { x: leftMargin + 6, y: bankY, size: 7.5, font, color: black });
    bankY -= 11;
    page.drawText("IFSC Code: BARB0MAKARB", { x: leftMargin + 6, y: bankY, size: 7.5, font, color: black });
    bankY -= 11;
    page.drawText("Account No: 41390200000521", { x: leftMargin + 6, y: bankY, size: 7.5, font, color: black });
    bankY -= 11;
    page.drawText("Bank: Bank of Baroda, MAKARBA, GUJARAT", { x: leftMargin + 6, y: bankY, size: 7, font, color: black });

    let termsY = bottomBoxY - 12;
    page.drawText("Terms and Conditions", { x: 206, y: termsY, size: 8, font: fontBold, color: black });
    termsY -= 12;
    page.drawText("1. Goods once sold will not be taken back or", { x: 206, y: termsY, size: 7, font, color: black });
    termsY -= 10;
    page.drawText("   exchanged", { x: 206, y: termsY, size: 7, font, color: black });
    termsY -= 11;
    page.drawText("2. All disputes are subject to Ahmedabad", { x: 206, y: termsY, size: 7, font, color: black });
    termsY -= 10;
    page.drawText("   jurisdiction only", { x: 206, y: termsY, size: 7, font, color: black });

    page.drawText("Authorised Signatory For", { x: 400, y: bottomBoxY - 60, size: 8, font: fontBold, color: black });
    page.drawText("Earthora Farms & Foods Pvt. Ltd.", { x: 390, y: bottomBoxY - 72, size: 8, font: fontBold, color: black });

    const pdfBytes = await pdfDoc.save();
    const pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(pdfBytes)));

    // ══════════════════════════════════════════════════════════════════════════
    // EMAIL DISPATCH VIA RESEND API
    // ══════════════════════════════════════════════════════════════════════════
    const emailHtmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px; background: #FAF9F5; border-radius: 20px; border: 1px solid #CFDCD3; color: #15271D;">
        <div style="background: #26593B; padding: 24px; border-radius: 14px; margin-bottom: 24px; text-align: center;">
          <h1 style="color: #FAF8F3; margin: 0 0 8px; font-size: 22px; font-weight: normal; font-family: Georgia, serif;">Thank you for your order!</h1>
          <p style="color: #DCE7C5; margin: 0; font-size: 14px;">Your payment of ₹${totalAmount.toFixed(2)} has been successfully processed.</p>
        </div>

        <div style="background: #ffffff; border-radius: 14px; padding: 24px; border: 1px solid #E1E8E3; margin-bottom: 24px;">
          <p style="margin: 0 0 12px; font-size: 15px; color: #15271D;">Hi <strong>${recipientName}</strong>,</p>
          <p style="margin: 0 0 12px; font-size: 14px; color: #444; line-height: 1.6;">
            We have successfully received your payment of <strong>₹${totalAmount.toFixed(2)}</strong> for order <strong>#${orderNumber}</strong>.
          </p>
          <p style="margin: 0 0 12px; font-size: 14px; color: #444; line-height: 1.6;">
            Please find your official <strong>Tax Invoice / Bill of Supply PDF</strong> attached to this email.
          </p>
          <p style="margin: 0; font-size: 14px; color: #444; line-height: 1.6;">
            Our farm team is packaging your single-origin Moringa products to ensure maximum botanical potency. We will send you another update with tracking details as soon as your shipment dispatches.
          </p>
        </div>

        <p style="text-align: center; font-size: 12px; color: #777; margin: 0; line-height: 1.5;">
          Warm regards,<br />
          <strong>The Earthora Farms Team</strong><br />
          <a href="https://earthorafarms.com" style="color: #26593B; text-decoration: none; font-weight: bold;">earthorafarms.com</a>
        </p>
      </div>
    `;

    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "Earthora Farms <contactus@earthorafarms.com>";

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [recipientEmail],
        bcc: ["orders@earthorafarms.com", "contactus@earthorafarms.com"],
        subject: `Tax Invoice for your Earthora Farms Order #${orderNumber}`,
        html: emailHtmlBody,
        attachments: [
          {
            filename: `Tax_Invoice_${orderNumber}.pdf`,
            content: pdfBase64,
          },
        ],
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      console.warn(`[send-invoice] Resend API Warning for customer (${recipientEmail}): ${errText}`);
      return new Response(
        JSON.stringify({ ok: false, warning: `Resend API Warning for ${recipientEmail}: ${errText}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, recipient: recipientEmail }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[send-invoice] Exception handled:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err.message || "An unexpected error occurred." }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
