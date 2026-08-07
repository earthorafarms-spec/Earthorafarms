// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const corsHeaders = {
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
  return str.trim() + " Rupees Only";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { orderId } = (await req.json()) as { orderId?: string };

    if (!orderId) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing required field: orderId." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!resendApiKey) {
      console.warn("[send-invoice] RESEND_API_KEY secret is not configured in Supabase secrets.");
      return new Response(
        JSON.stringify({ ok: true, warning: "RESEND_API_KEY secret not configured." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Fetch Order Details (check lowercase 'orders' first, fallback to capital 'Orders')
    let order: any = null;
    const { data: orderData } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .maybeSingle();

    if (orderData) {
      order = orderData;
    } else {
      // Fallback: Query capital "Orders" table
      const { data: capOrderData } = await supabase
        .from("Orders")
        .select("*")
        .eq("id", orderId);

      if (capOrderData && capOrderData.length > 0) {
        const firstRow = capOrderData[0];
        const addr = firstRow.shipping_address || {};
        order = {
          id: firstRow.id,
          created_at: firstRow.order_created_at || new Date().toISOString(),
          total_amount: Number(firstRow.order_amount || 0),
          user_id: firstRow.order_user_id,
          shipping_address: addr,
        };
      }
    }

    if (!order) {
      console.error("[send-invoice] Order not found in orders or Orders table for ID:", orderId);
      return new Response(
        JSON.stringify({ ok: false, error: `Order not found: ${orderId}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Fetch Order Items with Product details (fallback to capital Orders if order_items is empty)
    let orderItems: any[] = [];
    const { data: itemsData } = await supabase
      .from("order_items")
      .select("*, products(*)")
      .eq("order_id", orderId);

    if (itemsData && itemsData.length > 0) {
      orderItems = itemsData;
    } else {
      // Fallback to capital "Orders" table rows
      const { data: capItems } = await supabase
        .from("Orders")
        .select("*")
        .eq("id", orderId);

      if (capItems && capItems.length > 0) {
        orderItems = capItems.map((ci: any) => ({
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
        total_price: order.total_amount,
        unit_price: order.total_amount,
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
      .single();

    // Extract details
    const shipping = order.shipping_address || {};
    const recipientEmail = shipping.email || order.user_id;
    const recipientName = shipping.name || "Customer";
    const recipientPhone = shipping.phone || "";
    const recipientGst = shipping.gst || "N/A";
    const fullAddress = `${shipping.address || ""}, ${shipping.city || ""}, ${shipping.state || ""} - ${shipping.zip || ""}, ${shipping.country || ""}`;

    const invoiceDateStr = new Date(order.created_at).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

    const paymentMethod = payment?.payment_method || "Online Payment";
    const transactionId = payment?.payment_transaction_id || "N/A";
    const totalAmount = Number(order.total_amount);
    const stateStr = String(shipping.state || "").trim().toLowerCase();
    const isIntraState = stateStr.includes("tamil nadu") || stateStr === "tn" || !stateStr;

    // Calculate line items details for tax calculations
    let subtotalTaxable = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;

    const computedItems = orderItems.map((item: any, idx: number) => {
      const productName = item.products?.name || "Organic Moringa Supplement";
      const quantity = Number(item.quantity);
      const lineTotal = Number(item.total_price);
      const unitPrice = Number(item.unit_price);
      
      const taxableUnitPrice = unitPrice / 1.18;
      const taxableLineTotal = lineTotal / 1.18;
      const lineGst = lineTotal - taxableLineTotal;
      const lineCgst = lineGst / 2;
      const lineSgst = lineGst / 2;

      subtotalTaxable += taxableLineTotal;
      if (isIntraState) {
        totalCgst += lineCgst;
        totalSgst += lineSgst;
      } else {
        totalIgst += lineGst;
      }

      return {
        sNo: String(idx + 1),
        name: productName,
        hsn: item.products?.hsn_code || "12119029",
        qty: String(quantity),
        unitPrice: `Rs. ${taxableUnitPrice.toFixed(2)}`,
        taxableVal: `Rs. ${taxableLineTotal.toFixed(2)}`,
        taxes: isIntraState
          ? `9.0% CGST (Rs. ${lineCgst.toFixed(2)})\n9.0% SGST (Rs. ${lineSgst.toFixed(2)})`
          : `18.0% IGST (Rs. ${lineGst.toFixed(2)})`,
        total: `Rs. ${lineTotal.toFixed(2)}`,
      };
    });

    const grandTotalWords = numberToWords(totalAmount);

    // ══════════════════════════════════════════════════════════════════════════
    // PDF GENERATION USING PDF-LIB
    // ══════════════════════════════════════════════════════════════════════════
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]); // A4 Size standard in points (1 point = 1/72 inch)
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Color definitions
    const primaryColor = rgb(0.149, 0.349, 0.231); // #26593b green
    const secondaryColor = rgb(0.862, 0.905, 0.772); // #dce7c5 sage
    const textColor = rgb(0.082, 0.153, 0.114); // #15271d dark text
    const borderGray = rgb(0.81, 0.86, 0.82);

    // Draw main green header banner
    page.drawRectangle({
      x: 40,
      y: 750,
      width: 515,
      height: 52,
      color: primaryColor,
    });

    page.drawText("TAX INVOICE / BILL OF SUPPLY", {
      x: 297,
      y: 771,
      size: 14,
      font: fontBold,
      color: rgb(0.98, 0.97, 0.95),
      alignment: 1, // Centered
    } as any);

    // Brand and logo below header
    page.drawText("Earthora Farms", { x: 40, y: 722, size: 18, font: fontBold, color: primaryColor });
    page.drawText("PURE. POTENT. ALIVE.", { x: 40, y: 708, size: 8, font: fontBold, color: rgb(0.86, 0.6, 0.31) });

    // Divider line
    page.drawLine({
      start: { x: 40, y: 698 },
      end: { x: 555, y: 698 },
      thickness: 1,
      color: borderGray,
    });

    // --- Row 1: Billed From & Invoice Meta Details ---
    // Left Box: Supplier details
    page.drawText("Billed From (Supplier):", { x: 40, y: 680, size: 9, font: fontBold, color: primaryColor });
    page.drawText("Earthora Farms Private Limited", { x: 40, y: 668, size: 9, font: fontBold, color: textColor });
    page.drawText("12, Green Meadow Estate,\nBotanical Garden Road, Ooty,\nTamil Nadu - 643001, India\nGSTIN: 33AAACE1234F1Z5", {
      x: 40,
      y: 656,
      size: 8,
      font: font,
      color: textColor,
      lineHeight: 11,
    });

    // Right Box: Invoice Meta Details
    page.drawText("Invoice Details:", { x: 340, y: 680, size: 9, font: fontBold, color: primaryColor });
    page.drawText(`Invoice #: INV-${orderId.substring(0, 8).toUpperCase()}`, { x: 340, y: 668, size: 8, font: fontBold, color: textColor });
    page.drawText(`Invoice Date: ${invoiceDateStr}`, { x: 340, y: 656, size: 8, font: font, color: textColor });
    page.drawText(`Order ID: ${orderId}`, { x: 340, y: 644, size: 8, font: font, color: textColor });
    page.drawText(`Payment Method: ${paymentMethod}`, { x: 340, y: 632, size: 8, font: font, color: textColor });
    page.drawText(`Transaction ID: ${transactionId}`, { x: 340, y: 620, size: 8, font: font, color: textColor });
    
    // Paid Status Badge
    page.drawRectangle({
      x: 340,
      y: 598,
      width: 50,
      height: 16,
      color: secondaryColor,
    });
    page.drawText("PAID", { x: 353, y: 603, size: 8, font: fontBold, color: primaryColor });

    // Divider line
    page.drawLine({
      start: { x: 40, y: 588 },
      end: { x: 555, y: 588 },
      thickness: 1,
      color: borderGray,
    });

    // --- Row 2: Billed & Shipped To details ---
    page.drawText("Billed & Shipped To (Recipient):", { x: 40, y: 574, size: 9, font: fontBold, color: primaryColor });
    page.drawText(recipientName, { x: 40, y: 562, size: 9, font: fontBold, color: textColor });
    
    // Wrap address details into multiple lines if needed
    const addrLines = fullAddress.match(/.{1,70}(\s|$)/g) || [fullAddress];
    let addrY = 550;
    addrLines.forEach((line) => {
      page.drawText(line.trim(), { x: 40, y: addrY, size: 8, font: font, color: textColor });
      addrY -= 11;
    });

    page.drawText(`Phone: ${recipientPhone}`, { x: 40, y: addrY, size: 8, font: font, color: textColor });
    page.drawText(`Email: ${recipientEmail}`, { x: 40, y: addrY - 11, size: 8, font: font, color: textColor });
    page.drawText(`GSTIN: ${recipientGst}`, { x: 40, y: addrY - 22, size: 8, font: fontBold, color: textColor });

    // --- Table Header ---
    const tableHeaderY = 460;
    page.drawRectangle({
      x: 40,
      y: tableHeaderY - 18,
      width: 515,
      height: 18,
      color: primaryColor,
    });

    const colX = { sNo: 45, name: 75, hsn: 250, qty: 300, unitPrice: 335, taxableVal: 395, taxes: 455, total: 515 };

    page.drawText("S.No", { x: colX.sNo, y: tableHeaderY - 12, size: 8, font: fontBold, color: rgb(0.98, 0.97, 0.95) });
    page.drawText("Description of Goods", { x: colX.name, y: tableHeaderY - 12, size: 8, font: fontBold, color: rgb(0.98, 0.97, 0.95) });
    page.drawText("HSN", { x: colX.hsn, y: tableHeaderY - 12, size: 8, font: fontBold, color: rgb(0.98, 0.97, 0.95) });
    page.drawText("Qty", { x: colX.qty, y: tableHeaderY - 12, size: 8, font: fontBold, color: rgb(0.98, 0.97, 0.95) });
    page.drawText("Unit Price", { x: colX.unitPrice, y: tableHeaderY - 12, size: 8, font: fontBold, color: rgb(0.98, 0.97, 0.95) });
    page.drawText("Taxable Val", { x: colX.taxableVal, y: tableHeaderY - 12, size: 8, font: fontBold, color: rgb(0.98, 0.97, 0.95) });
    page.drawText("Taxes", { x: colX.taxes, y: tableHeaderY - 12, size: 8, font: fontBold, color: rgb(0.98, 0.97, 0.95) });
    page.drawText("Total", { x: colX.total, y: tableHeaderY - 12, size: 8, font: fontBold, color: rgb(0.98, 0.97, 0.95) });

    // --- Table Rows ---
    let rowY = tableHeaderY - 35;
    computedItems.forEach((item) => {
      // Draw background stripe or border
      page.drawLine({
        start: { x: 40, y: rowY - 12 },
        end: { x: 555, y: rowY - 12 },
        thickness: 0.5,
        color: borderGray,
      });

      page.drawText(item.sNo, { x: colX.sNo, y: rowY, size: 8, font: font, color: textColor });
      page.drawText(item.name, { x: colX.name, y: rowY, size: 8, font: fontBold, color: textColor });
      page.drawText(item.hsn, { x: colX.hsn, y: rowY, size: 8, font: font, color: textColor });
      page.drawText(item.qty, { x: colX.qty, y: rowY, size: 8, font: font, color: textColor });
      page.drawText(item.unitPrice, { x: colX.unitPrice, y: rowY, size: 8, font: font, color: textColor });
      page.drawText(item.taxableVal, { x: colX.taxableVal, y: rowY, size: 8, font: font, color: textColor });
      
      // Draw multi-line taxes column
      const taxLines = item.taxes.split("\n");
      page.drawText(taxLines[0], { x: colX.taxes, y: rowY + 3, size: 6.5, font: font, color: textColor });
      page.drawText(taxLines[1], { x: colX.taxes, y: rowY - 5, size: 6.5, font: font, color: textColor });

      page.drawText(item.total, { x: colX.total, y: rowY, size: 8, font: fontBold, color: textColor });

      rowY -= 30; // Move down for the next item
    });

    // --- Totals Section ---
    rowY -= 15;
    // Box for totals
    page.drawRectangle({
      x: 320,
      y: rowY - 80,
      width: 235,
      height: 80,
      color: rgb(0.99, 0.99, 0.98),
      borderColor: borderGray,
      borderWidth: 1,
    });

    const totalsLabelsX = 330;
    const totalsValuesX = 490;

    page.drawText("Total Taxable Value:", { x: totalsLabelsX, y: rowY - 15, size: 8, font: font, color: textColor });
    page.drawText(`Rs. ${subtotalTaxable.toFixed(2)}`, { x: totalsValuesX, y: rowY - 15, size: 8, font: font, color: textColor });

    if (isIntraState) {
      page.drawText("CGST Total (9.0%):", { x: totalsLabelsX, y: rowY - 30, size: 8, font: font, color: textColor });
      page.drawText(`Rs. ${totalCgst.toFixed(2)}`, { x: totalsValuesX, y: rowY - 30, size: 8, font: font, color: textColor });

      page.drawText("SGST Total (9.0%):", { x: totalsLabelsX, y: rowY - 45, size: 8, font: font, color: textColor });
      page.drawText(`Rs. ${totalSgst.toFixed(2)}`, { x: totalsValuesX, y: rowY - 45, size: 8, font: font, color: textColor });
    } else {
      page.drawText("IGST Total (18.0%):", { x: totalsLabelsX, y: rowY - 30, size: 8, font: font, color: textColor });
      page.drawText(`Rs. ${totalIgst.toFixed(2)}`, { x: totalsValuesX, y: rowY - 30, size: 8, font: font, color: textColor });
    }

    page.drawLine({
      start: { x: 330, y: rowY - 52 },
      end: { x: 545, y: rowY - 52 },
      thickness: 0.5,
      color: borderGray,
    });

    page.drawText("Grand Total:", { x: totalsLabelsX, y: rowY - 68, size: 10, font: fontBold, color: primaryColor });
    page.drawText(`Rs. ${totalAmount.toFixed(2)}`, { x: totalsValuesX, y: rowY - 68, size: 10, font: fontBold, color: primaryColor });

    // Amount in Words
    page.drawText("Amount in Words:", { x: 40, y: rowY - 15, size: 8, font: fontBold, color: primaryColor });
    
    // Wrap words if needed
    const wordsLines = grandTotalWords.match(/.{1,45}(\s|$)/g) || [grandTotalWords];
    let wordsY = rowY - 28;
    wordsLines.forEach((wLine) => {
      page.drawText(wLine.trim(), { x: 40, y: wordsY, size: 8, font: font, color: textColor });
      wordsY -= 11;
    });

    // --- Footer & Signatory ---
    page.drawLine({
      start: { x: 40, y: 100 },
      end: { x: 555, y: 100 },
      thickness: 0.5,
      color: borderGray,
      dashArray: [4, 4],
    });

    page.drawText("Terms & Declarations:\nWe declare that this invoice shows the actual price of the goods described\nand that all particulars are true and correct. Goods once sold cannot be returned.", {
      x: 40,
      y: 85,
      size: 6.5,
      font: font,
      color: rgb(0.5, 0.5, 0.5),
      lineHeight: 9,
    });

    page.drawText("Earthora Farms Private Limited", { x: 410, y: 85, size: 8, font: fontBold, color: primaryColor });
    page.drawText("Authorized Signatory", { x: 450, y: 45, size: 8, font: font, color: rgb(0.5, 0.5, 0.5) });

    // Save PDF to Uint8Array
    const pdfBytes = await pdfDoc.save();
    
    // Encode to base64
    const pdfBase64 = encodeBase64(pdfBytes);

    // ══════════════════════════════════════════════════════════════════════════
    // EMAIL DISPATCH VIA RESEND API
    // ══════════════════════════════════════════════════════════════════════════
    const emailHtmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px; background: #FAF9F5; border-radius: 20px; border: 1px solid #CFDCD3; color: #15271D;">
        <div style="background: #26593B; padding: 24px; border-radius: 14px; margin-bottom: 24px; text-align: center;">
          <h1 style="color: #FAF8F3; margin: 0 0 8px; font-size: 22px; font-weight: normal; font-family: Georgia, serif;">Thank you for your order!</h1>
          <p style="color: #DCE7C5; margin: 0; font-size: 14px;">Your payment has been successfully processed.</p>
        </div>

        <div style="background: #ffffff; border-radius: 14px; padding: 24px; border: 1px solid #E1E8E3; margin-bottom: 24px;">
          <p style="margin: 0 0 12px; font-size: 15px; color: #15271D;">Hi <strong>${recipientName}</strong>,</p>
          <p style="margin: 0 0 12px; font-size: 14px; color: #444; line-height: 1.6;">
            We have successfully received your payment of <strong>₹${totalAmount.toFixed(2)}</strong> for order <strong>#${orderId.substring(0, 8).toUpperCase()}</strong>.
          </p>
          <p style="margin: 0 0 12px; font-size: 14px; color: #444; line-height: 1.6;">
            We have generated the softcopy of your bill. Please find the official **Tax Invoice / Bill of Supply** PDF attached to this email.
          </p>
          <p style="margin: 0; font-size: 14px; color: #444; line-height: 1.6;">
            Our farm team is already packaging your single-origin Moringa products to ensure maximum potency. We will send you another update with the tracking details as soon as it ships.
          </p>
        </div>

        <p style="text-align: center; font-size: 12px; color: #777; margin: 0; line-height: 1.5;">
          Warm regards,<br />
          <strong>The Earthora Farms Team</strong><br />
          <a href="https://earthorafarms.com" style="color: #26593B; text-decoration: none; font-weight: bold;">earthorafarms.com</a>
        </p>
      </div>
    `;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Earthora Farms <support@earthorafarms.com>",
        to: [recipientEmail],
        subject: `Invoice for your Earthora Farms Order #${orderId.substring(0, 8).toUpperCase()}`,
        html: emailHtmlBody,
        attachments: [
          {
            filename: `Invoice_${orderId.substring(0, 8).toUpperCase()}.pdf`,
            content: pdfBase64,
          },
        ],
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      console.error("[send-invoice] Resend API Error:", errText);
      return new Response(
        JSON.stringify({ ok: false, error: `Resend API Error: ${errText}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[send-invoice] Uncaught Exception:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err.message || "An unexpected error occurred." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
