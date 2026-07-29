import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { Tool } from "../speech/types.js";

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

export const supabase = createClient(supabaseUrl, supabaseServiceKey);

// ── Anthropic Tool Schemas ───────────────────────────────────────────────────

export const agentTools: Tool[] = [
  {
    name: "list_products",
    description: "List all active Earthora Farms products with their name, price, stock status, and tag.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "check_product_stock",
    description: "Check available stock for a specific product by its slug.",
    input_schema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Product slug e.g. 'powder' or 'tablets'" },
      },
      required: ["slug"],
    },
  },
  {
    name: "lookup_customer",
    description: "Look up existing customer shipping details in User_details by phone number.",
    input_schema: {
      type: "object",
      properties: {
        phone: { type: "string", description: "Customer 10-digit phone number" },
      },
      required: ["phone"],
    },
  },
  {
    name: "save_customer_details",
    description: "Save or update customer address & profile in User_details.",
    input_schema: {
      type: "object",
      properties: {
        phone: { type: "string", description: "Customer phone number" },
        name: { type: "string", description: "Customer full name" },
        address: { type: "string", description: "Street address, apartment, suite" },
        city: { type: "string", description: "City / Town" },
        state: { type: "string", description: "State / Region" },
        zip: { type: "string", description: "6-digit PIN code (India)" },
        country: { type: "string", description: "Country name, defaults to India" },
      },
      required: ["phone", "name", "address", "city", "state", "zip"],
    },
  },
  {
    name: "create_order",
    description: "Create an order for the customer. Validates stock, calculates totals, and creates database records.",
    input_schema: {
      type: "object",
      properties: {
        userEmail: { type: "string", description: "Customer email or phone-based identifier" },
        items: {
          type: "array",
          description: "Array of items to purchase",
          items: {
            type: "object",
            properties: {
              slug: { type: "string", description: "Product slug e.g. 'powder' or 'tablets'" },
              quantity: { type: "number", description: "Quantity to order" },
            },
            required: ["slug", "quantity"],
          },
        },
        shippingAddress: {
          type: "object",
          description: "Shipping details object",
          properties: {
            name: { type: "string" },
            phone: { type: "string" },
            address: { type: "string" },
            city: { type: "string" },
            state: { type: "string" },
            zip: { type: "string" },
            country: { type: "string" },
          },
          required: ["name", "phone", "address", "city", "state", "zip"],
        },
      },
      required: ["userEmail", "items", "shippingAddress"],
    },
  },
  {
    name: "get_order_status",
    description: "Look up order status timeline by order reference ID or customer phone/email.",
    input_schema: {
      type: "object",
      properties: {
        identifier: { type: "string", description: "Order ID or customer phone/email" },
      },
      required: ["identifier"],
    },
  },
  {
    name: "modify_order",
    description: "Modify an existing order (add/remove items or change quantity) if status is pending/processing.",
    input_schema: {
      type: "object",
      properties: {
        orderId: { type: "string", description: "Order reference ID" },
        changes: {
          type: "object",
          description: "Order modifications",
          properties: {
            addItems: { type: "array" },
            removeItems: { type: "array" },
            updateQuantities: { type: "array" },
          },
        },
      },
      required: ["orderId", "changes"],
    },
  },
  {
    name: "cancel_order",
    description: "Cancel an order if its status is pending or processing.",
    input_schema: {
      type: "object",
      properties: {
        orderId: { type: "string", description: "Order reference ID" },
      },
      required: ["orderId"],
    },
  },
  {
    name: "search_knowledge",
    description: "Search grounded knowledge base for Moringa benefits, usage, recipes, or farm policies.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Topic or question to search" },
      },
      required: ["query"],
    },
  },
  {
    name: "initiate_payment",
    description: "Generate and send a Razorpay payment link via SMS/WhatsApp to the customer.",
    input_schema: {
      type: "object",
      properties: {
        orderId: { type: "string", description: "Order reference ID" },
        customerPhone: { type: "string", description: "Customer phone number" },
      },
      required: ["orderId", "customerPhone"],
    },
  },
];

// ── Tool Executions ──────────────────────────────────────────────────────────

export async function executeToolCall(name: string, args: any): Promise<any> {
  try {
    switch (name) {
      case "list_products": {
        const { data, error } = await supabase
          .from("products")
          .select(`
            id, slug, name, price, mrp, tag, description,
            inventory ( total_stock, reserved_stock )
          `)
          .eq("status", "active");

        if (error) throw error;

        const productList = (data || []).map((p: any) => {
          const inv = Array.isArray(p.inventory) ? p.inventory[0] : p.inventory;
          const availableStock = inv ? (inv.total_stock - inv.reserved_stock) : 0;
          return {
            name: p.name,
            slug: p.slug,
            price: `₹${p.price}`,
            tag: p.tag,
            available: availableStock > 0 ? "In Stock" : "Out of Stock",
          };
        });

        return { products: productList };
      }

      case "check_product_stock": {
        const { slug } = args;
        const { data: product, error: prodErr } = await supabase
          .from("products")
          .select("id, name, inventory(total_stock, reserved_stock)")
          .eq("slug", slug)
          .single();

        if (prodErr || !product) {
          return { error: `Product with slug '${slug}' not found.` };
        }

        const inv = Array.isArray(product.inventory) ? product.inventory[0] : product.inventory;
        const availableStock = inv ? (inv.total_stock - inv.reserved_stock) : 0;

        if (availableStock <= 0) {
          return { availableStock: 0, status: "Out of Stock", message: `${product.name} is currently out of stock.` };
        }

        return { productName: product.name, availableStock, status: "In Stock" };
      }

      case "lookup_customer": {
        const { phone } = args;
        const cleanPhone = phone.replace(/[\s-]/g, "");
        const { data, error } = await supabase
          .from("User_details")
          .select("*")
          .eq("user_phone", cleanPhone)
          .maybeSingle();

        if (error || !data) {
          return { found: false, message: "No customer profile found for this phone number." };
        }

        return {
          found: true,
          name: data.user_name,
          email: data.user_email,
          phone: data.user_phone,
          address: data.user_address,
          city: data.user_city,
          state: data.user_state,
          zip: data.user_zip,
          country: data.user_country || "India",
        };
      }

      case "save_customer_details": {
        const { phone, name, address, city, state, zip, country } = args;

        // PIN Code Validation (India 6 digits)
        if (!/^\d{6}$/.test(zip.trim())) {
          return { success: false, error: "Invalid PIN code format. Expected a 6-digit Indian PIN code." };
        }

        const cleanPhone = phone.replace(/[\s-]/g, "");
        const userEmail = `${cleanPhone}@voice.earthorafarms.com`;

        const { error } = await supabase.from("User_details").upsert(
          {
            user_email: userEmail,
            user_name: name,
            user_phone: cleanPhone,
            user_address: address,
            user_city: city,
            user_state: state,
            user_zip: zip,
            user_country: country || "India",
          },
          { onConflict: "user_email" }
        );

        if (error) return { success: false, error: error.message };
        return { success: true, message: "Customer details saved successfully." };
      }

      case "create_order": {
        const { userEmail, items, shippingAddress } = args;

        // 1. Save/Update Customer Details
        if (shippingAddress) {
          await supabase.from("User_details").upsert(
            {
              user_email: userEmail,
              user_name: shippingAddress.name,
              user_phone: shippingAddress.phone,
              user_address: shippingAddress.address,
              user_city: shippingAddress.city,
              user_state: shippingAddress.state,
              user_zip: shippingAddress.zip,
              user_country: shippingAddress.country || "India",
            },
            { onConflict: "user_email" }
          );
        }

        // 2. Stock Check & Product Price Fetch
        let totalAmount = 0;
        const orderRows = [];

        for (const item of items) {
          const { data: product, error: pErr } = await supabase
            .from("products")
            .select("id, name, price, inventory(total_stock, reserved_stock)")
            .eq("slug", item.slug)
            .single();

          if (pErr || !product) {
            return { success: false, error: `Product '${item.slug}' not found.` };
          }

          const inv = Array.isArray(product.inventory) ? product.inventory[0] : product.inventory;
          const availableStock = inv ? (inv.total_stock - inv.reserved_stock) : 0;

          if (availableStock < item.quantity) {
            return {
              success: false,
              error: `Insufficient stock for ${product.name}. Requested: ${item.quantity}, Available: ${availableStock}`,
            };
          }

          let itemPrice = Number(product.price);

          // Check active festival details for discount
          const { data: festival } = await supabase
            .from("festival_details")
            .select("discount_percentage, is_active")
            .eq("is_active", true)
            .maybeSingle();

          let appliedDiscountInfo = "";
          if (festival && festival.discount_percentage) {
            const discountPct = Number(festival.discount_percentage);
            itemPrice = itemPrice * (1 - discountPct / 100);
            appliedDiscountInfo = ` (${discountPct}% festival discount applied)`;
          }

          const itemTotal = itemPrice * item.quantity;
          totalAmount += itemTotal;

          orderRows.push({
            order_user_id: userEmail,
            order_product_id: product.id,
            order_product_quantity: String(item.quantity),
            order_product_price: String(itemPrice.toFixed(2)),
          });
        }

        // 3. Insert into "Orders" table (triggers automatically create orders & order_items)
        const { data: insertedOrders, error: insertErr } = await supabase
          .from("Orders")
          .insert(orderRows)
          .select();

        if (insertErr || !insertedOrders || insertedOrders.length === 0) {
          return { success: false, error: insertErr?.message || "Failed to insert order records." };
        }

        const orderId = String(insertedOrders[0].id);

        // 4. Create Payment & Order History records
        const txnId = `VOICE-${Date.now()}`;
        await supabase.from("Payments").insert({
          payment_order_id: orderId,
          payment_amount: String(totalAmount),
          payment_status: "pending",
          payment_method: "RAZORPAY_LINK",
          payment_transaction_id: txnId,
        });

        await supabase.from("Order_history").insert({
          order_id: orderId,
          order_status: "pending",
          order_notes: "Voice order initialized",
        });

        return {
          success: true,
          orderId,
          totalAmount: `₹${totalAmount}`,
          message: "Order created successfully. Payment link will be sent to customer.",
        };
      }

      case "get_order_status": {
        const { identifier } = args;
        // Search Orders by ID or user email
        const { data: ordersData, error: orderErr } = await supabase
          .from("Orders")
          .select("id, order_user_id, order_product_quantity, order_product_price, order_created_at")
          .or(`id.eq.${identifier},order_user_id.eq.${identifier}`);

        if (orderErr || !ordersData || ordersData.length === 0) {
          return { found: false, message: "No matching orders found." };
        }

        const refOrderId = String(ordersData[0].id);
        const { data: history } = await supabase
          .from("Order_history")
          .select("order_status, order_notes, order_updated_at")
          .eq("order_id", refOrderId)
          .order("order_updated_at", { ascending: false });

        const currentStatus = history?.[0]?.order_status || "pending";
        return {
          found: true,
          orderId: refOrderId,
          status: currentStatus,
          history: history || [],
        };
      }

      case "modify_order": {
        const { orderId, changes } = args;

        const { data: history } = await supabase
          .from("Order_history")
          .select("order_status")
          .eq("order_id", orderId)
          .order("order_updated_at", { ascending: false })
          .limit(1);

        const currentStatus = history?.[0]?.order_status || "pending";
        if (currentStatus === "shipped" || currentStatus === "delivered" || currentStatus === "cancelled") {
          return { success: false, error: `Order cannot be modified at this stage (current status: ${currentStatus}).` };
        }

        // Apply item quantity updates
        if (changes.updateQuantities && Array.isArray(changes.updateQuantities)) {
          for (const item of changes.updateQuantities) {
            await supabase
              .from("Orders")
              .update({ order_product_quantity: String(item.quantity) })
              .eq("id", orderId);
          }
        }

        return { success: true, message: "Order updated successfully.", orderId };
      }

      case "cancel_order": {
        const { orderId } = args;

        const { data: history } = await supabase
          .from("Order_history")
          .select("order_status")
          .eq("order_id", orderId)
          .order("order_updated_at", { ascending: false })
          .limit(1);

        const currentStatus = history?.[0]?.order_status || "pending";
        if (currentStatus === "shipped" || currentStatus === "delivered" || currentStatus === "cancelled") {
          return { success: false, error: `Order cannot be cancelled at this stage (current status: ${currentStatus}).` };
        }

        // Insert cancelled row into Order_history
        await supabase.from("Order_history").insert({
          order_id: orderId,
          order_status: "cancelled",
          order_notes: "Cancelled via voice agent",
        });

        // Update voice_orders status if linked
        await supabase
          .from("voice_orders")
          .update({ payment_status: "cancelled" })
          .eq("order_id", orderId);

        return { success: true, message: `Order ${orderId} has been cancelled successfully.` };
      }

      case "search_knowledge": {
        const { query } = args;
        const { data, error } = await supabase
          .from("knowledge_base")
          .select("topic, question, answer")
          .or(`question.ilike.%${query}%,answer.ilike.%${query}%,topic.ilike.%${query}%`)
          .limit(3);

        if (error || !data || data.length === 0) {
          return { found: false, message: "No matching knowledge base articles found." };
        }

        return { found: true, results: data };
      }

      case "initiate_payment": {
        const { orderId, customerPhone } = args;

        // Fetch order total from Payments table
        const { data: payRec } = await supabase
          .from("Payments")
          .select("payment_amount")
          .eq("payment_order_id", orderId)
          .maybeSingle();

        const amount = payRec?.payment_amount ? parseFloat(payRec.payment_amount) : 0;

        try {
          const { createPaymentLink } = await import("../payments/razorpay-link.js");
          const { sendPaymentLink } = await import("../payments/notify.js");

          const { paymentLinkUrl } = await createPaymentLink({
            orderId,
            amount,
            customerPhone,
          });

          const notifyResult = await sendPaymentLink(customerPhone, paymentLinkUrl, amount, orderId);

          return {
            success: true,
            orderId,
            amount: `₹${amount}`,
            paymentLinkUrl,
            sentVia: notifyResult.sentVia,
            message: `Payment link generated and sent to ${customerPhone} via ${notifyResult.sentVia}.`,
          };
        } catch (err: any) {
          console.error("❌ [initiate_payment Error]:", err);
          return {
            success: false,
            error: `Failed to generate payment link: ${err.message}`,
          };
        }
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err: any) {
    console.error(`❌ [Tool Error - ${name}]:`, err);
    return { error: err.message || "An unexpected error occurred during tool execution." };
  }
}
