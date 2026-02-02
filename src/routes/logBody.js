const express = require("express");
const axios = require("axios");
const { GoogleGenAI } = require("@google/genai");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
//Image Gen Whatsapp
// Ensure env is loaded if not already by the host
try { require("dotenv").config(); } catch (_) {}

const router = express.Router();

// --- MongoDB client (reuse across invocations) ---
const MONGO_URI = "mongodb+srv://karanvishwakarma732_db_user:LD5FZYAzsX3Jf9bF@clusterai.qzyxuin.mongodb.net/?appName=Clusterai";
const mongoClient = new MongoClient(MONGO_URI, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});
let mongoReady = null;
async function getMongoCollection() {
  if (!mongoReady) mongoReady = mongoClient.connect();
  await mongoReady;
  const db = mongoClient.db("tryon");
  return db.collection("images");
}

// Helper: fetch image bytes from a URL and prepare inlineData part
async function urlToInlineDataPart(url) {
  try {
    const finalUrl = encodeURI(url);
    const resp = await axios.get(finalUrl, { responseType: "arraybuffer" });

    let mime = resp.headers["content-type"] || "";
    if (!mime) {
      // naive fallback based on extension
      if (/\.png(\?|$)/i.test(finalUrl)) mime = "image/png";
      else if (/\.jpe?g(\?|$)/i.test(finalUrl)) mime = "image/jpeg";
      else if (/\.webp(\?|$)/i.test(finalUrl)) mime = "image/webp";
      else mime = "image/jpeg";
    }
    const base64 = Buffer.from(resp.data).toString("base64");
    return { inlineData: { data: base64, mimeType: mime } };
  } catch (err) {
    throw new Error(`Failed to fetch image from ${url}: ${err.message}`);
  }
}

router.post("/", async (req, res) => {
  const { faceUrl, jewelleryUrl, name, number, seed } = req.body || {};
  const t0 = Date.now();

  // Log incoming request for debugging
  try {
    console.log("/api/image incoming:");
    console.log("- headers:", JSON.stringify(req.headers, null, 2));
    console.log("- body:", JSON.stringify(req.body, null, 2));
  } catch (_) {}

  if (!faceUrl || !jewelleryUrl) {
    return res.status(400).json({
      ok: false,
      error: "faceUrl and jewelleryUrl are required in JSON body",
      receivedKeys: Object.keys(req.body || {}),
      hint: "Send application/json with { faceUrl: string, jewelleryUrl: string }"
    });
  }

  const apiKey = "AIzaSyBHbqrIzd0b1dDgIURAAwIzvLZBKlX0Wy4" || req.headers["x-gemini-key"] || req.body?.apiKey;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: "Missing GEMINI_API_KEY in environment" });
  }

  try {
    // Prepare image parts from URLs
    console.log("[image] STEP 1: Fetching input images...");
    const [facePart, jewelleryPart] = await Promise.all([
      urlToInlineDataPart(faceUrl),
      urlToInlineDataPart(jewelleryUrl)
    ]);

    const tFetchEnd = Date.now();
    console.log(`[image] STEP 1 DONE in ${tFetchEnd - t0}ms`);

    const client = new GoogleGenAI({ apiKey });

    const promptText = `Create a single photorealistic photograph combining the two inputs.
    Input 1 is the person (face and body). Input 2 is the jewellery.
    Preserve the person's identity exactly: keep facial structure, skin tone, eye color, hairline, and key landmarks consistent.
    Place and align the jewellery naturally (no deformation), matching the perspective and scale.
    Match lighting and color temperature between subject and jewellery; avoid artifacts, extra accessories, or makeup changes.
    Do not change background unless necessary for realism. Output one clean, high-quality image.`;

    const generationConfig = {
      temperature: 0.2,
      topP: 0.8,
      topK: 40,
      candidateCount: 1,
      ...(seed != null ? { seed: Number(seed) } : {}),
    };
    if (seed != null) {
      console.log(`[image] Using seed: ${Number(seed)}`);
    }

    console.log("[image] STEP 2: Sending to Gemini...");
    const response = await client.models.generateContent({
      model: "gemini-3-pro-image-preview", // faster image model
      contents: [
        {
          role: "user",
          parts: [
            { text: promptText },
            facePart,      // { inlineData: ... }
            jewelleryPart  // { inlineData: ... }
          ]
        }
      ],
      config: {
        responseModalities: ["IMAGE"] // Force image response
      },
      generationConfig
    });
    const tGenEnd = Date.now();
    console.log(`[image] STEP 2 DONE in ${tGenEnd - tFetchEnd}ms (cumulative ${tGenEnd - t0}ms)`);

    const candidate = response?.candidates?.[0];
    const firstPart = candidate?.content?.parts?.[0];
    const inlineData = firstPart?.inlineData;

    // --- CHECK FOR REFUSAL (Safety/Policy) ---
    if (!inlineData?.data) {
      // If we didn't get an image, check if the model sent text explaining why
      const refusalText = firstPart?.text || "No reason provided";
      const finishReason = candidate?.finishReason || "UNKNOWN";
      
      console.log("/api/image: Model refused. Reason:", refusalText);
      console.log("Finish Reason:", finishReason);
      
      return res.status(422).json({ 
        ok: false, 
        error: "Model refused to generate image", 
        details: refusalText,
        finishReason: finishReason
      });
    }

    // Store in Mongo and return a public URL
    const col = await getMongoCollection();
    const doc = {
      mimeType: inlineData.mimeType || "image/jpeg",
      base64: inlineData.data,
      createdAt: new Date(),
      faceUrl: String(faceUrl || ""),
      jewelleryUrl: String(jewelleryUrl || ""),
      name: typeof name === "string" ? name : (name != null ? String(name) : ""),
      number: typeof number === "string" ? number : (number != null ? String(number) : ""),
    };
    const insert = await col.insertOne(doc);
    const tInsertEnd = Date.now();
    console.log(`[image] STEP 3 DONE: Saved to Mongo in ${tInsertEnd - tGenEnd}ms (id=${insert.insertedId})`);

    const host = req.get("host") || "";
    const forwardedProto = (req.headers["x-forwarded-proto"] || "").toString();
    const preferredProto = host.includes("vercel.app") ? "https" : (forwardedProto || req.protocol || "https");
    const url = `${preferredProto}://${host}${req.baseUrl}/${insert.insertedId.toString()}`;
    try { await col.updateOne({ _id: insert.insertedId }, { $set: { generatedUrl: url } }); } catch (_) {}
    const tDone = Date.now();
    console.log("[image] STEP 4 DONE: URL prepared and document updated");
    console.log(`[image] SUMMARY => total=${tDone - t0}ms, fetch=${tFetchEnd - t0}ms, gen=${tGenEnd - tFetchEnd}ms, db=${tInsertEnd - tGenEnd}ms, mime=${inlineData.mimeType || "image/jpeg"}, b64_len=${inlineData.data.length}, url=${url}`);
    return res.status(200).json({ ok: true, url, id: insert.insertedId.toString() });

  } catch (err) {
    const tErr = Date.now();
    console.error("/api/image generation error:", err?.response?.data || err.message, `after ${tErr - t0}ms`);
    return res.status(200).json({ ok: false, url: "", id: "", error: err.message || "Generation failed" });
  }
});

// GET /api/image/:id -> stream stored image
router.get("/:id", async (req, res) => {
  try {
    const col = await getMongoCollection();
    const id = req.params.id;
    const doc = await col.findOne({ _id: new ObjectId(id) });
    if (!doc) return res.status(404).send("Not found");
    const mime = doc.mimeType || "image/jpeg";
    const buf = Buffer.from(doc.base64, "base64");
    res.set("Content-Type", mime);
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    return res.status(200).send(buf);
  } catch (e) {
    console.error("/api/image/:id error:", e.message);
    return res.status(500).send("Error");
  }
});

module.exports = router;