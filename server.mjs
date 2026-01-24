import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(cors());
app.use(express.json());

// ES Module এ __dirname এর জন্য
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Static files serve করুন (HTML, CSS, JS)
app.use(express.static(__dirname));

// Homepage route - index.html serve করবে
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Multiple API Keys (একাধিক API Key রাখতে পারেন)
const API_KEYS = [
  "AIzaSyBNIfGUzpA8u_BY1_dlJDto06iD2sq3Sag",
  // এখানে আরো API Key যোগ করুন
];

// Available models with priorities
const AVAILABLE_MODELS = [
  "gemini-2.5-flash-lite",      // Primary model
  "gemini-2.5-flash",           // Fallback 2
  "gemini-3-flash",             // Fallback 3
  "gemini-2.5-flash-tts",       // Fallback 1
];

// Track model usage and quotas
let modelUsage = {};
let currentModelIndex = 0;
let currentApiKeyIndex = 0;

// Initialize usage tracking
AVAILABLE_MODELS.forEach(model => {
  modelUsage[model] = {
    requestCount: 0,
    lastError: null,
    isActive: true
  };
});

// System prompt for Shouib AI personality
const SYSTEM_PROMPT = `আপনি Shouib AI - একজন বন্ধুত্বপূর্ণ, সহায়ক এবং বুদ্ধিমান বাংলা ভাষার AI সহায়ক। আপনাকে বানিয়েছে shouib ahamed যিনি একজন ছাত্র এবং প্রোগ্রামার। যার বাসা বাংলাদেশের রংপুর বিভাগের নীলফামারী জেলার সৈদপুর উপজেলায় অবস্থিত। 

আপনার বৈশিষ্ট্য:
- সর্ব প্রথম কথোপকথোনে আগে সালাম করুন যদি সে হায় হ্যালো করে এবং সে সরাসরি কোনো প্রশ্ন না করে: "আসসালামু আলাইকুম! আমি Shouib AI । কিভাবে সাহায্য করতে পারি?
- সবসময় বাংলায় উত্তর দিবেন
- সহজ, স্বচ্ছ এবং বোধগম্য ভাষা ব্যবহার করবেন
- আগের কথোপকথন মনে রাখবেন এবং context অনুযায়ী উত্তর দেবেন
- বন্ধুত্বপriendly এবং সম্মানজনক টোনে কথা বলবেন
- প্রয়োজনে উদাহরণ দিয়ে ব্যাখ্যা করবেন
- জটিল বিষয় সহজভাবে বুঝাবেন`;

// Function to get current active model
function getCurrentModel() {
  return AVAILABLE_MODELS[currentModelIndex];
}

// Function to check if we should switch models
function checkAndSwitchModel(error = null) {
  const currentModel = getCurrentModel();
  
  // Update error status for current model
  if (error) {
    modelUsage[currentModel].lastError = error;
    modelUsage[currentModel].isActive = false;
    console.log(`❌ Model ${currentModel} deactivated due to error:`, error);
  }
  
  // Increment request count
  modelUsage[currentModel].requestCount++;
  
  // Check if current model exceeded quota (15 requests threshold for safety)
  if (modelUsage[currentModel].requestCount >= 15) {
    console.log(`⚠️ Model ${currentModel} nearing quota limit (${modelUsage[currentModel].requestCount} requests)`);
    modelUsage[currentModel].isActive = false;
  }
  
  // Try to find next available model
  for (let i = 1; i <= AVAILABLE_MODELS.length; i++) {
    const nextIndex = (currentModelIndex + i) % AVAILABLE_MODELS.length;
    const nextModel = AVAILABLE_MODELS[nextIndex];
    
    if (modelUsage[nextModel].isActive) {
      if (currentModelIndex !== nextIndex) {
        console.log(`🔄 Switching from ${currentModel} to ${nextModel}`);
        currentModelIndex = nextIndex;
      }
      return nextModel;
    }
  }
  
  // If all models are exhausted, reset all and use first one
  console.log("🔄 All models exhausted, resetting...");
  AVAILABLE_MODELS.forEach(model => {
    modelUsage[model].isActive = true;
    modelUsage[model].requestCount = 0;
  });
  currentModelIndex = 0;
  return getCurrentModel();
}

// Function to rotate API keys
function getCurrentApiKey() {
  const key = API_KEYS[currentApiKeyIndex];
  currentApiKeyIndex = (currentApiKeyIndex + 1) % API_KEYS.length;
  return key;
}

// Main API endpoint with fallback mechanism
app.post("/ask", async (req, res) => {
  const { question, history = [] } = req.body;
  
  let lastError = null;
  let attempts = 0;
  const maxAttempts = AVAILABLE_MODELS.length * 2; // Try all models twice
  
  while (attempts < maxAttempts) {
    attempts++;
    const model = getCurrentModel();
    const apiKey = getCurrentApiKey();
    
    try {
      console.log(`📡 Attempt ${attempts}: Using model ${model} with key ${apiKey.substring(0, 10)}...`);
      
      // Build conversation context
      const contents = [];
      
      // Add system instruction
      contents.push({
        role: "user",
        parts: [{ text: SYSTEM_PROMPT }]
      });
      
      contents.push({
        role: "model",
        parts: [{ text: "বুঝেছি! আমি Shouib AI হিসেবে সাহায্য করতে প্রস্তুত।" }]
      });
      
      // Add conversation history for context
      history.forEach(msg => {
        if (msg.role === 'user') {
          contents.push({
            role: "user",
            parts: [{ text: msg.text }]
          });
        } else if (msg.role === 'ai') {
          contents.push({
            role: "model",
            parts: [{ text: msg.text }]
          });
        }
      });
      
      // Add current question
      contents.push({
        role: "user",
        parts: [{ text: question }]
      });
      
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: contents,
            generationConfig: {
              temperature: 0.7,
              topK: 40,
              topP: 0.95,
              maxOutputTokens: 1024,
            }
          }),
          timeout: 30000 // 30 second timeout
        }
      );
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error ${response.status}: ${errorText}`);
      }
      
      const data = await response.json();
      
      if (!data.candidates || data.candidates.length === 0) {
        // Check for specific Gemini API errors
        if (data.error && data.error.message) {
          throw new Error(`Gemini API Error: ${data.error.message}`);
        }
        throw new Error("No response candidates found");
      }
      
      const reply = data.candidates[0].content.parts[0].text;
      
      // Success - return response
      console.log(`✅ Success with model ${model}`);
      modelUsage[model].requestCount++;
      
      return res.json({ 
        reply,
        modelUsed: model,
        attempts: attempts
      });
      
    } catch (error) {
      lastError = error;
      console.error(`❌ Attempt ${attempts} failed:`, error.message);
      
      // Check if error is quota-related
      const errorMsg = error.message.toLowerCase();
      const isQuotaError = errorMsg.includes('quota') || 
                          errorMsg.includes('limit') || 
                          errorMsg.includes('exceeded') ||
                          errorMsg.includes('429');
      
      // Switch model for quota errors or after 2 failures
      if (isQuotaError || attempts % 2 === 0) {
        checkAndSwitchModel(error);
        
        // Wait a bit before retrying with new model
        if (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
  }
  
  // All attempts failed
  console.error("🔥 All models failed:", lastError);
  res.status(500).json({ 
    reply: "দুঃখিত, সব মডেলের লিমিট শেষ হয়ে গেছে। কিছুক্ষণ পর আবার চেষ্টা করুন। ⚠️",
    error: "All models exhausted",
    attempts: attempts
  });
});

// Endpoint to check model status
app.get("/status", (req, res) => {
  res.json({
    currentModel: getCurrentModel(),
    modelUsage: modelUsage,
    availableModels: AVAILABLE_MODELS,
    apiKeysCount: API_KEYS.length,
    system: "Shouib AI Multi-Model Fallback System"
  });
});

// Reset all models (admin endpoint)
app.post("/reset-models", (req, res) => {
  AVAILABLE_MODELS.forEach(model => {
    modelUsage[model] = {
      requestCount: 0,
      lastError: null,
      isActive: true
    };
  });
  currentModelIndex = 0;
  res.json({ 
    message: "✅ All models reset successfully",
    modelUsage: modelUsage 
  });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log("🚀 Shouib AI Advanced Backend running!");
  console.log(`📍 Port: http://localhost:${PORT}`);
  console.log("🤖 Multi-Model Fallback System Active:");
  console.log("   Available Models:", AVAILABLE_MODELS.join(", "));
  console.log("   Primary Model:", getCurrentModel());
  console.log("   API Keys:", API_KEYS.length);
  console.log("📊 Check status at: http://localhost:${PORT}/status");
});
