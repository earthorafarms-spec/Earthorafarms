import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // 1. Fetch Order Details
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single();

    if (orderErr || !order) {
      console.error("[send-invoice] Order query error:", orderErr);
      return new Response(
        JSON.stringify({ ok: false, error: `Order not found: ${orderId}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Fetch Order Items with Product details
    const { data: orderItems, error: itemsErr } = await supabase
      .from("order_items")
      .select("*, products(*)")
      .eq("order_id", orderId);

    if (itemsErr || !orderItems || orderItems.length === 0) {
      console.error("[send-invoice] Order Items query error:", itemsErr);
      return new Response(
        JSON.stringify({ ok: false, error: "Order items not found." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Fetch Payment details
    const { data: payment } = await supabase
      .from("Payments")
      .select("*")
      .eq("payment_order_id", orderId)
      .single();

    // Extract address details
    const shipping = order.shipping_address || {};
    const recipientEmail = shipping.email || order.user_id;
    const recipientName = shipping.name || "Customer";
    const recipientPhone = shipping.phone || "";
    const fullAddress = `${shipping.address || ""}, ${shipping.city || ""}, ${shipping.state || ""} - ${shipping.zip || ""}, ${shipping.country || ""}`;

    const invoiceDate = new Date(order.created_at).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

    const paymentMethod = payment?.payment_method || "Online Payment";
    const transactionId = payment?.payment_transaction_id || "N/A";
    const totalAmount = Number(order.total_amount);

    // Calculate line items for GST standard layout (5% Moringa Tax Rate)
    const HSN_CODE = "12119029";
    let subtotalTaxable = 0;
    let totalCgst = 0;
    let totalSgst = 0;

    const itemsHtmlList = orderItems.map((item: any, idx: number) => {
      const productName = item.products?.name || "Organic Moringa Supplement";
      const quantity = Number(item.quantity);
      const lineTotal = Number(item.total_price);
      
      const unitPrice = Number(item.unit_price);
      const taxableUnitPrice = unitPrice / 1.05;
      const taxableLineTotal = lineTotal / 1.05;
      const lineGst = lineTotal - taxableLineTotal;
      const lineCgst = lineGst / 2;
      const lineSgst = lineGst / 2;

      subtotalTaxable += taxableLineTotal;
      totalCgst += lineCgst;
      totalSgst += lineSgst;

      return `
        <tr style="border-bottom: 1px solid #e8e6df;">
          <td style="padding: 12px 8px; font-size: 13px; text-align: center; color: #444;">${idx + 1}</td>
          <td style="padding: 12px 8px; font-size: 13px; color: #222; font-weight: 500;">
            ${productName}
          </td>
          <td style="padding: 12px 8px; font-size: 13px; text-align: center; color: #444;">${HSN_CODE}</td>
          <td style="padding: 12px 8px; font-size: 13px; text-align: center; color: #222; font-weight: 600;">${quantity}</td>
          <td style="padding: 12px 8px; font-size: 13px; text-align: right; color: #444;">₹${taxableUnitPrice.toFixed(2)}</td>
          <td style="padding: 12px 8px; font-size: 13px; text-align: right; color: #444;">₹${taxableLineTotal.toFixed(2)}</td>
          <td style="padding: 12px 8px; font-size: 12px; text-align: center; color: #666;">
            2.5% CGST (₹${lineCgst.toFixed(2)})<br/>
            2.5% SGST (₹${lineSgst.toFixed(2)})
          </td>
          <td style="padding: 12px 8px; font-size: 13px; text-align: right; color: #222; font-weight: 600;">₹${lineTotal.toFixed(2)}</td>
        </tr>
      `;
    }).join("");

    const grandTotalWords = numberToWords(totalAmount);

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 750px; margin: 0 auto; padding: 24px; background: #FAF9F5; color: #15271D; border-radius: 24px; border: 1px solid #CFDCD3;">
        
        <!-- Header / Banner -->
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <tr>
            <td>
              <h1 style="margin: 0; font-size: 26px; color: #26593B; letter-spacing: -0.5px; font-family: Georgia, serif;">Earthora Farms</h1>
              <p style="margin: 4px 0 0; font-size: 12px; color: #DC9950; font-weight: bold; letter-spacing: 1px; text-transform: uppercase;">Pure. Potent. Alive.</p>
            </td>
            <td style="text-align: right;">
              <span style="background: #26593B; color: #FAF8F3; padding: 6px 16px; border-radius: 20px; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">Tax Invoice</span>
              <p style="margin: 8px 0 0; font-size: 13px; color: #26593B; font-weight: 600;">Invoice #: INV-${orderId.substring(0, 8).toUpperCase()}</p>
            </td>
          </tr>
        </table>

        <!-- Invoice Meta Details -->
        <table style="width: 100%; border-collapse: collapse; background: #ffffff; border-radius: 16px; border: 1px solid #E1E8E3; margin-bottom: 24px; padding: 16px;">
          <tr>
            <td style="padding: 16px; width: 50%; vertical-align: top; border-right: 1px solid #E1E8E3;">
              <h3 style="margin: 0 0 8px; font-size: 12px; text-transform: uppercase; color: #888; letter-spacing: 0.5px;">Order Information</h3>
              <p style="margin: 0 0 6px; font-size: 13px; color: #222;"><strong>Order ID:</strong> ${orderId}</p>
              <p style="margin: 0 0 6px; font-size: 13px; color: #222;"><strong>Date:</strong> ${invoiceDate}</p>
              <p style="margin: 0 0 6px; font-size: 13px; color: #222;"><strong>Payment Method:</strong> ${paymentMethod}</p>
              <p style="margin: 0; font-size: 13px; color: #222;"><strong>Transaction ID:</strong> <span style="font-family: monospace; font-size: 12px; color: #555;">${transactionId}</span></p>
            </td>
            <td style="padding: 16px; width: 50%; vertical-align: top;">
              <h3 style="margin: 0 0 8px; font-size: 12px; text-transform: uppercase; color: #888; letter-spacing: 0.5px;">Payment Status</h3>
              <div style="display: inline-block; background: #DCE7C5; color: #26593B; font-weight: bold; padding: 6px 14px; border-radius: 12px; font-size: 14px; margin-bottom: 8px; border: 1px solid #CFDCD3;">
                ✓ PAID
              </div>
              <p style="margin: 0; font-size: 12px; color: #666; line-height: 1.4;">Thank you for your payment. Your order is confirmed and is being prepared for shipment from our farm.</p>
            </td>
          </tr>
        </table>

        <!-- Party Details -->
        <table style="width: 100%; border-collapse: collapse; background: #ffffff; border-radius: 16px; border: 1px solid #E1E8E3; margin-bottom: 24px;">
          <tr>
            <!-- Supplier / From -->
            <td style="padding: 16px; width: 50%; vertical-align: top; border-right: 1px solid #E1E8E3;">
              <h3 style="margin: 0 0 10px; font-size: 12px; text-transform: uppercase; color: #888; letter-spacing: 0.5px;">Billed From (Supplier)</h3>
              <p style="margin: 0 0 4px; font-size: 14px; font-weight: bold; color: #1b4332;">Earthora Farms Private Limited</p>
              <p style="margin: 0 0 8px; font-size: 12px; color: #555; line-height: 1.4;">
                12, Green Meadow Estate,<br/>
                Botanical Garden Road, Ooty,<br/>
                Tamil Nadu - 643001, India
              </p>
              <p style="margin: 0 0 4px; font-size: 12px; color: #444;"><strong>GSTIN:</strong> 33AAACE1234F1Z5 (Fictional)</p>
              <p style="margin: 0; font-size: 12px; color: #444;"><strong>FSSAI Lic No:</strong> 12423999000123</p>
            </td>
            <!-- Customer / To -->
            <td style="padding: 16px; width: 50%; vertical-align: top;">
              <h3 style="margin: 0 0 10px; font-size: 12px; text-transform: uppercase; color: #888; letter-spacing: 0.5px;">Billed & Shipped To</h3>
              <p style="margin: 0 0 4px; font-size: 14px; font-weight: bold; color: #222;">${recipientName}</p>
              <p style="margin: 0 0 8px; font-size: 12px; color: #555; line-height: 1.4; white-space: pre-wrap;">${fullAddress}</p>
              <p style="margin: 0 0 4px; font-size: 12px; color: #444;"><strong>Email:</strong> ${recipientEmail}</p>
              <p style="margin: 0; font-size: 12px; color: #444;"><strong>Phone:</strong> ${recipientPhone}</p>
            </td>
          </tr>
        </table>

        <!-- Itemized Table -->
        <table style="width: 100%; border-collapse: collapse; background: #ffffff; border-radius: 16px; border: 1px solid #E1E8E3; overflow: hidden; margin-bottom: 24px;">
          <thead>
            <tr style="background: #26593B; color: #FAF8F3;">
              <th style="padding: 12px 8px; font-size: 11px; text-transform: uppercase; text-align: center; font-weight: bold; width: 40px;">S.No</th>
              <th style="padding: 12px 8px; font-size: 11px; text-transform: uppercase; text-align: left; font-weight: bold;">Description of Goods</th>
              <th style="padding: 12px 8px; font-size: 11px; text-transform: uppercase; text-align: center; font-weight: bold; width: 80px;">HSN</th>
              <th style="padding: 12px 8px; font-size: 11px; text-transform: uppercase; text-align: center; font-weight: bold; width: 50px;">Qty</th>
              <th style="padding: 12px 8px; font-size: 11px; text-transform: uppercase; text-align: right; font-weight: bold; width: 90px;">Unit Price</th>
              <th style="padding: 12px 8px; font-size: 11px; text-transform: uppercase; text-align: right; font-weight: bold; width: 100px;">Taxable Value</th>
              <th style="padding: 12px 8px; font-size: 11px; text-transform: uppercase; text-align: center; font-weight: bold; width: 130px;">Taxes</th>
              <th style="padding: 12px 8px; font-size: 11px; text-transform: uppercase; text-align: right; font-weight: bold; width: 100px;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtmlList}
          </tbody>
        </table>

        <!-- Calculations Summary -->
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <tr>
            <!-- Left Empty Column / Terms -->
            <td style="width: 55%; vertical-align: top; padding: 12px;">
              <h4 style="margin: 0 0 6px; font-size: 12px; color: #26593B; text-transform: uppercase;">Amount in Words</h4>
              <p style="margin: 0 0 16px; font-size: 13px; font-style: italic; color: #555;">${grandTotalWords}</p>
              
              <div style="border-top: 1px solid #E1E8E3; padding-top: 12px;">
                <p style="margin: 0; font-size: 10px; color: #888; line-height: 1.4;">
                  <strong>Terms & Declarations:</strong> We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct. Goods once sold cannot be returned unless damaged in transit.
                </p>
              </div>
            </td>
            <!-- Right calculations column -->
            <td style="width: 45%; vertical-align: top; padding: 12px; background: #ffffff; border-radius: 16px; border: 1px solid #E1E8E3;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 6px 0; font-size: 13px; color: #555;">Total Taxable Value</td>
                  <td style="padding: 6px 0; font-size: 13px; text-align: right; color: #222;">₹${subtotalTaxable.toFixed(2)}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; font-size: 13px; color: #555;">CGST Total (2.5%)</td>
                  <td style="padding: 6px 0; font-size: 13px; text-align: right; color: #222;">₹${totalCgst.toFixed(2)}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; font-size: 13px; color: #555;">SGST Total (2.5%)</td>
                  <td style="padding: 6px 0; font-size: 13px; text-align: right; color: #222; border-bottom: 1px solid #E1E8E3;">₹${totalSgst.toFixed(2)}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 0 0; font-size: 16px; font-weight: bold; color: #26593B;">Grand Total</td>
                  <td style="padding: 10px 0 0; font-size: 16px; font-weight: bold; text-align: right; color: #26593B;">₹${totalAmount.toFixed(2)}</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- Signatory Sign-off Footer -->
        <table style="width: 100%; border-collapse: collapse; margin-top: 16px; border-top: 1px dashed #CFDCD3; padding-top: 16px;">
          <tr>
            <td>
              <p style="margin: 0; font-size: 11px; color: #888;">For customer support queries, email <a href="mailto:support@earthorafarms.com" style="color: #26593B; text-decoration: none;">support@earthorafarms.com</a></p>
            </td>
            <td style="text-align: right; vertical-align: bottom;">
              <p style="margin: 0 0 4px; font-size: 12px; font-weight: bold; color: #26593B;">Earthora Farms Pvt Ltd</p>
              <p style="margin: 0; font-size: 11px; color: #888; font-style: italic;">Authorized Signatory</p>
            </td>
          </tr>
        </table>

      </div>
    `;

    // 4. Send Email via Resend
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Earthora Farms <support@earthorafarms.com>",
        to: [recipientEmail],
        subject: `Your Tax Invoice & Bill of Supply for Order #${orderId.substring(0, 8).toUpperCase()}`,
        html: emailHtml,
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
