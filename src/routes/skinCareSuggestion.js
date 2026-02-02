const express = require("express");
const { GoogleGenAI } = require("@google/genai");
const axios = require("axios");

// Ensure env is loaded if not already by the host
try { require("dotenv").config(); } catch (_) { }

const router = express.Router();

// L'Oréal product database
const lorealProducts = [
  {
    name: "L'Oréal Niacinamide + Zinc Face Serum",
    price: "₹899",
    ml: "30ml",
    buyUrl: "https://www.lorealparis.in/products/face-serum/niacinamide-zinc",
    concerns: ["oily", "acne", "dark spots", "large pores"]
  },
  {
    name: "L'Oréal Hyaluronic Acid Serum",
    price: "₹1099",
    ml: "30ml",
    buyUrl: "https://www.lorealparis.in/products/face-serum/hyaluronic-acid",
    concerns: ["dry", "dehydration", "fine lines", "dull"]
  },
  {
    name: "L'Oréal Vitamin C Serum",
    price: "₹1299",
    ml: "30ml",
    buyUrl: "https://www.lorealparis.in/products/face-serum/vitamin-c",
    concerns: ["dull", "dark spots", "uneven tone", "pigmentation"]
  },
  {
    name: "L'Oréal Retinol Serum",
    price: "₹1499",
    ml: "30ml",
    buyUrl: "https://www.lorealparis.in/products/face-serum/retinol",
    concerns: ["aging", "wrinkles", "texture", "mature"]
  },
  {
    name: "L'Oréal Salicylic Acid Serum",
    price: "₹999",
    ml: "30ml",
    buyUrl: "https://www.lorealparis.in/products/face-serum/salicylic-acid",
    concerns: ["acne", "clogged pores", "rough texture", "breakouts"]
  },
  {
    name: "L'Oréal Glycolic Acid Serum",
    price: "₹1199",
    ml: "30ml",
    buyUrl: "https://www.lorealparis.in/products/face-serum/glycolic-acid",
    concerns: ["dull", "texture", "fine lines", "uneven tone"]
  },
  {
    name: "L'Oréal Peptide Serum",
    price: "₹1399",
    ml: "30ml",
    buyUrl: "https://www.lorealparis.in/products/face-serum/peptide",
    concerns: ["aging", "loss of firmness", "wrinkles", "mature"]
  },
  {
    name: "L'Oréal Ceramide Serum",
    price: "₹1099",
    ml: "30ml",
    buyUrl: "https://www.lorealparis.in/products/face-serum/ceramide",
    concerns: ["sensitive", "dry", "irritation", "barrier damage"]
  },
  {
    name: "L'Oréal Azelaic Acid Serum",
    price: "₹1299",
    ml: "30ml",
    buyUrl: "https://www.lorealparis.in/products/face-serum/azelaic-acid",
    concerns: ["redness", "acne marks", "uneven tone", "rosacea"]
  },
  {
    name: "L'Oréal Bakuchiol Serum",
    price: "₹1599",
    ml: "30ml",
    buyUrl: "https://www.lorealparis.in/products/face-serum/bakuchiol",
    concerns: ["sensitive aging", "fine lines", "elasticity", "gentle"]
  },
  {
    name: "L'Oréal Caffeine Eye Serum",
    price: "₹799",
    ml: "15ml",
    buyUrl: "https://www.lorealparis.in/products/eye-serum/caffeine",
    concerns: ["dark circles", "puffiness", "eye bags", "tired eyes"]
  },
  {
    name: "L'Oréal Collagen Serum",
    price: "₹1399",
    ml: "30ml",
    buyUrl: "https://www.lorealparis.in/products/face-serum/collagen",
    concerns: ["loss of elasticity", "firmness", "aging", "sagging"]
  }
];

// Upsell products
const upsellProducts = [
  {
    name: "Gentle Face Cleanser",
    emoji: "🧼",
    price: "₹499",
    ml: "150ml",
    buyUrl: "https://www.lorealparis.in/products/face-cleanser"
  },
  {
    name: "Daily Sunscreen SPF 50",
    emoji: "☀️",
    price: "₹799",
    ml: "50ml",
    buyUrl: "https://www.lorealparis.in/products/sunscreen-spf-50"
  },
  {
    name: "Moisturizing Cream",
    emoji: "🧴",
    price: "₹699",
    ml: "50ml",
    buyUrl: "https://www.lorealparis.in/products/moisturizer"
  }
];

// Helper function to get AI response
async function getAIResponse(prompt) {
  try {
    // Use Gemini Flash for fastest response
    const apiKey = process.env.GEMINI_API_KEY || "AIzaSyBHbqrIzd0b1dDgIURAAwIzvLZBKlX0Wy4";
    const client = new GoogleGenAI({ apiKey });

    const response = await client.models.generateContent({
      model: "gemini-3-flash-preview", // Fastest new model
      contents: [{ role: "user", parts: [{ text: prompt }] }]
    });

    return response.response?.text() || "";
  } catch (error) {
    console.error("AI Error:", error.message);
    return null;
  }
}

// Helper function to format product response
function formatProductResponse(product, upsellItems) {
  const features = product.benefits || product.concerns || [];
  const benefits = features.map(benefit => `✔ ${benefit}`).join("\n ");
  const upsellText = upsellItems.map(item => `${item.emoji || '✨'} ${item.name} - ${item.price} | ${item.ml}\n🛍️ ${item.buyUrl}\n`).join("");

  return `💖 Your Perfect Match Is Ready!
${product.name}
${benefits}

💰 ${product.price} | ${product.ml}
🛍️ Buy: ${product.buyUrl}

For best results, pair it with 👇
${upsellText}`;
}

router.post("/", async (req, res) => {
  const { skinType, skinConcern, serumUsage } = req.body || {};

  console.log("[skincare-suggestion] Request received:", { skinType, skinConcern, serumUsage });

  if (!skinType && !skinConcern) {
    return res.status(400).json({
      ok: false,
      error: "At least skinType or skinConcern is required",
      receivedKeys: Object.keys(req.body || {}),
      hint: "Send { skinType: string, skinConcern?: string, serumUsage?: string }"
    });
  }

  try {
    // Use AI for personalized recommendation
    const aiPrompt = `Based on this user profile:
- Skin Type: ${skinType || "Not specified"}
- Skin Concern: ${skinConcern || "Not specified"}  
- Serum Usage: ${serumUsage || "Not specified"}

Recommend the best L'Oréal face serum from this list:
${lorealProducts.map((p, i) => `${i + 1}. ${p.name} - ${p.concerns.join(", ")}`).join("\n")}

IMPORTANT: You must generate the complete response in this exact format:
💖 Your Perfect Match Is Ready!
[Product Name]
✔ [Benefit 1]
✔ [Benefit 2] 
✔ [Benefit 3]

💰 [Price] | [Size]
🛍️ Buy: [Product URL]

For best results, pair it with 👇
[Emoji] [Upsell Product 1] - [Price] | [Size]
🛍️ [Product URL]
[Emoji] [Upsell Product 2] - [Price] | [Size]
🛍️ [Product URL]

Replace all bracketed information with the actual product details. Do not use any labels like "UPSELL". Make it conversational and natural.`;

    let selectedProduct = lorealProducts[0]; // Default fallback
    const aiResponse = await getAIResponse(aiPrompt);

    if (aiResponse) {
      const responseParts = aiResponse.split("\n\n");
      const productName = responseParts[1].trim();
      const benefits = responseParts[2].split("\n").map(benefit => benefit.trim().replace("✔ ", ""));
      const productPrice = responseParts[3].trim().replace("💰 ", "").split(" | ")[0];
      const productSize = responseParts[3].trim().replace("💰 ", "").split(" | ")[1];
      const productUrl = responseParts[4].trim().replace("🛍️ ", "");
      const aiUpsellRaw = responseParts[5].trim().split("\n\n");

      const foundProduct = lorealProducts.find(product => product.name === productName);

      if (foundProduct) {
        // Create a copy to use the dynamic benefits
        const productWithBenefits = { ...foundProduct, benefits: benefits };

        // Use global static upsell products instead of trying to parse AI text
        const shuffledUpsell = [...upsellProducts].sort(() => 0.5 - Math.random());
        const selectedUpsell = shuffledUpsell.slice(0, 2);

        // Format response
        const formattedResponse = formatProductResponse(productWithBenefits, selectedUpsell);

        console.log("[skincare-suggestion] Product recommended:", productWithBenefits.name);

        return res.status(200).json({
          ok: true,
          response: formattedResponse
        });
      }
    }

    // Select 2 random upsell products
    const shuffledUpsell = [...upsellProducts].sort(() => 0.5 - Math.random());
    const selectedUpsell = shuffledUpsell.slice(0, 2);

    // Format response
    const formattedResponse = formatProductResponse(selectedProduct, selectedUpsell);

    console.log("[skincare-suggestion] Product recommended:", selectedProduct.name);

    return res.status(200).json({
      ok: true,
      response: formattedResponse
    });

  } catch (error) {
    console.error("[skincare-suggestion] Error:", error.message);

    // Return error response if Gemini fails
    return res.status(500).json({
      ok: false,
      error: "Gemini AI failed to generate recommendation",
      details: error.message,
      gemini_working: false
    });
  }
});

module.exports = router;
