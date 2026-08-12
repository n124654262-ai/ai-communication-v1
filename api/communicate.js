const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MAX_TEXT_LENGTH = 2000;
const WINDOW_MS = 60_000;
const requestWindows = new Map();

const SYSTEM_PROMPT = `你是一位精通繁體中文、越南文與英文的專業多語隨行翻譯官，專注於工廠與職場日常溝通。
規則：
1. 每筆輸入都是獨立任務，不使用先前對話。
2. 忠實保留命令、提醒、詢問、緊急或客氣程度，不擅自增減語意。
3. understoodMeaning 只顯示說話者原意，不要加「已收到」、模型名稱或解釋。
4. 使用母語者常用的職場白話，避免生硬書面語。
5. analyze 階段只分析原意、語氣、不確定處與關鍵詞，不產生翻譯。
6. translate 階段依已確認原意產生翻譯、反向翻譯及 1 到 5 個重點詞。
7. translation 必須是 targetLanguage；backTranslation 必須是 sourceLanguage。
8. 關鍵詞說明限 30 字內，聚焦工廠或職場語境。
9. 嚴格依指定 JSON Schema 回覆，不輸出 Markdown 或額外文字。`;

const keywordSchema = {
  type: "object",
  additionalProperties: false,
  required: ["original", "meaning", "role"],
  properties: {
    original: {type: "string"},
    meaning: {type: "string"},
    role: {type: "string"}
  }
};

const translatedKeywordSchema = {
  type: "object",
  additionalProperties: false,
  required: ["original", "translated", "meaning"],
  properties: {
    original: {type: "string"},
    translated: {type: "string"},
    meaning: {type: "string"}
  }
};

const analysisProperties = {
  detectedLanguage: {type: "string", enum: ["zh-TW", "vi", "en"]},
  originalText: {type: "string"},
  understoodMeaning: {type: "string"},
  mainIntent: {type: "string"},
  tone: {type: "string"},
  confidence: {type: "number", minimum: 0, maximum: 1},
  uncertainParts: {type: "array", items: {type: "string"}},
  keywords: {type: "array", minItems: 1, maxItems: 5, items: keywordSchema}
};

const analysisSchema = {
  type: "object",
  additionalProperties: false,
  required: Object.keys(analysisProperties),
  properties: analysisProperties
};

const translationProperties = {
  ...analysisProperties,
  translation: {type: "string"},
  backTranslation: {type: "string"},
  translatedKeywords: {type: "array", minItems: 1, maxItems: 5, items: translatedKeywordSchema}
};

const translationSchema = {
  type: "object",
  additionalProperties: false,
  required: Object.keys(translationProperties),
  properties: translationProperties
};

function setCors(req, res) {
  const origin = req.headers.origin;
  const allowed = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin || "");
  const isSameHost = origin && req.headers.host && origin === `https://${req.headers.host}`;

  if (origin && (allowed.includes(origin) || isLocal || isSameHost)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function isOriginAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const allowed = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  const isSameHost = req.headers.host && origin === `https://${req.headers.host}`;
  return allowed.includes(origin) || isLocal || isSameHost;
}

function isRateLimited(req) {
  const limit = Math.max(1, Number(process.env.MAX_REQUESTS_PER_MINUTE || 10));
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
  const now = Date.now();
  const current = requestWindows.get(ip);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    requestWindows.set(ip, {startedAt: now, count: 1});
    return false;
  }
  current.count += 1;
  return current.count > limit;
}

function validateBody(body) {
  const languages = new Set(["zh-TW", "vi", "en"]);
  if (!body || typeof body !== "object") return "請求內容格式不正確";
  if (!languages.has(body.sourceLanguage) || !languages.has(body.targetLanguage)) return "語言設定不正確";
  if (body.sourceLanguage === body.targetLanguage) return "來源與目標語言不可相同";
  if (!["analyze", "translate"].includes(body.phase)) return "處理階段不正確";
  if (typeof body.originalText !== "string" || !body.originalText.trim()) return "請輸入要翻譯的內容";
  if (body.originalText.length > MAX_TEXT_LENGTH) return `內容不可超過 ${MAX_TEXT_LENGTH} 字`;
  if (body.phase === "translate" && (!body.analysis || typeof body.analysis !== "object")) return "缺少已確認的原意";
  return "";
}

function getGeminiText(data) {
  const candidateText = data?.candidates?.[0]?.content?.parts
    ?.map(part => part?.text || "")
    .join("");
  if (candidateText) return candidateText;
  if (typeof data.output_text === "string") return data.output_text;
  for (const output of data.outputs || []) {
    if (typeof output.text === "string") return output.text;
    for (const part of output.content?.parts || []) {
      if (typeof part.text === "string") return part.text;
    }
  }
  return "";
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({error: "只接受 POST 請求"});
  if (!isOriginAllowed(req)) return res.status(403).json({error: "此網站來源未獲允許"});
  if (isRateLimited(req)) return res.status(429).json({error: "使用次數過多，請稍後再試"});
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({error: "Gemini 尚未完成安全設定"});

  const validationError = validateBody(req.body);
  if (validationError) return res.status(400).json({error: validationError});

  const {sourceLanguage, targetLanguage, originalText, phase, analysis} = req.body;
  const schema = phase === "analyze" ? analysisSchema : translationSchema;
  const task = {
    phase,
    sourceLanguage,
    targetLanguage,
    originalText: originalText.trim(),
    ...(phase === "translate" ? {confirmedAnalysis: analysis} : {})
  };

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": process.env.GEMINI_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{text: SYSTEM_PROMPT}]
        },
        contents: [{
          role: "user",
          parts: [{text: `目前任務：\n${JSON.stringify(task)}`}]
        }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 0.1
        }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Gemini request failed", response.status, data?.error?.status);
      return res.status(502).json({error: "Gemini 暫時無法處理，請稍後再試"});
    }

    const outputText = getGeminiText(data);
    if (!outputText) return res.status(502).json({error: "Gemini 沒有回傳翻譯內容"});

    try {
      return res.status(200).json(JSON.parse(outputText));
    } catch {
      return res.status(502).json({error: "Gemini 回傳格式不正確"});
    }
  } catch (error) {
    console.error("Gemini backend error", error?.message);
    return res.status(502).json({error: "Gemini 連線失敗，請稍後再試"});
  }
};
