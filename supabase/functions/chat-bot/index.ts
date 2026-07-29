// @ts-ignore - Deno global for Supabase Edge Functions runtime environment
declare const Deno: any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// System prompt — locked to Earthora Farms context only
const SYSTEM_PROMPT = `You are Priya, a friendly and knowledgeable customer assistant for Earthora Farms — a premium organic moringa farm based in Tamil Nadu, India. You help customers learn about Earthora Farms, its products, health benefits, ordering, shipping, and policies.

ABOUT EARTHORA FARMS:
Earthora Farms is a family-run organic moringa farm growing 100% pure, sun-grown moringa in the fertile fields of Tamil Nadu. The brand believes in ancient wisdom reimagined for modern vitality. Every product is chemical-free, pesticide-free, and sustainably harvested.

PRODUCTS:
1. Moringa Powder — pure sun-dried moringa leaf powder, available in 100g, 200g, 500g
2. Moringa Tablets — compressed moringa leaf tablets, 500mg per tablet, no fillers

HEALTH BENEFITS OF MORINGA:
- 92 nutrients, 46 antioxidants, all 9 essential amino acids
- 25x more iron than spinach, 17x more calcium than milk, 7x more Vitamin C than oranges
- Supports energy, immunity, skin health, and digestion
- Anti-inflammatory and adaptogenic properties

SHIPPING: Ships all across India, 3–7 business days, free above ₹499
PAYMENT: Cash on Delivery (COD) now; Card & UPI coming soon
RETURNS: 48h window for damaged/incorrect items — contact query@earthorafarms.com
CONTACT: query@earthorafarms.com

RULES:
- Only answer questions related to Earthora Farms, moringa, our products, ordering, shipping, returns, and payments.
- For anything unrelated, reply: "I'm only able to help with questions about Earthora Farms and our moringa products."
- Keep replies warm, friendly, and concise (2–4 sentences). You may use 🌿 occasionally.
- For real-time order status or stock, direct to query@earthorafarms.com.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Ollama host — set via Supabase secret: OLLAMA_HOST=http://<device-ip>:11434
    const OLLAMA_HOST = Deno.env.get("OLLAMA_HOST") ?? "http://localhost:11434";

    const { messages } = await req.json() as {
      messages: { role: string; content: string }[];
    };

    if (!messages?.length) {
      return new Response(
        JSON.stringify({ error: "No messages provided." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ollamaBody = {
      model: "gemma3:4b",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages,
      ],
      stream: false,
    };

    const ollamaRes = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ollamaBody),
    });

    if (!ollamaRes.ok) {
      const err = await ollamaRes.text();
      console.error("Ollama error:", err);
      return new Response(
        JSON.stringify({ error: "AI service error. Please try again." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = (await ollamaRes.json()) as { message?: { content?: string } };
    const reply = data?.message?.content ?? "I'm not sure how to answer that. Please contact us at query@earthorafarms.com 🌿";

    return new Response(
      JSON.stringify({ reply }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("chat-bot error:", err);
    return new Response(
      JSON.stringify({ error: "Something went wrong. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
