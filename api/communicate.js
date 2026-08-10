const MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
const MAX_TEXT_LENGTH = 2000;
const WINDOW_MS = 60_000;
const requestWindows = new Map();

const SYSTEM_PROMPT = `你是一位精通繁體中文、越南文與英文的專業多語隨行翻譯官，負責工廠與職場環境的主管與員工溝通。

規則：
1. 每次請求都是獨立任務，不得使用或推測先前對話。
2. 僅根據本次 originalText 分析，支援繁中、越南文、英文互譯。
3. 使用母語者常用的職場白話，忠實保留命令、提醒、詢問、質疑或指責的語氣強度。
4. 不得增加原文沒有的客套話、理由或資訊，也不得美化、弱化或加重原意。
5. analyze 階段只說明說話者原意、主要語意、語氣、不確定內容與關鍵詞，不產生正式譯文。
6. translate 階段產生目標語言譯文、把譯文重新翻回來源語言的反向翻譯，以及 1 至 5 個真正影響句意的關鍵詞。
7. 不確定時列入 uncertainParts，不得猜測。
8. translation 只能使用 targetLanguage；backTranslation 只能使用 sourceLanguage。
9. 關鍵詞 meaning 使用 sourceLanguage，限 30 個中文字或相當長度。
10. 嚴格依指定 JSON Schema 回覆，不輸出 Markdown、開場白或結語。`;

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

function getOutputText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

function validateBody(body) {
  const languages = new Set(["zh-TW", "vi", "en"]);
  if (!body || typeof body !== "object") return "請求內容不正確";
  if (!languages.has(body.sourceLanguage) || !languages.has(body.targetLanguage)) return "語言設定不正確";
  if (body.sourceLanguage === body.targetLanguage) return "來源語言與目標語言不可相同";
  if (!['analyze', 'translate'].includes(body.phase)) return "處理階段不正確";
  if (typeof body.originalText !== "string" || !body.originalText.trim()) return "沒有要處理的文字";
  if (body.originalText.length > MAX_TEXT_LENGTH) return `文字不可超過 ${MAX_TEXT_LENGTH} 字`;
  if (body.phase === "translate" && (!body.analysis || typeof body.analysis !== "object")) return "缺少已確認的原意";
  return "";
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({error: "只接受 POST 請求"});
  if (!isOriginAllowed(req)) return res.status(403).json({error: "此網站沒有使用權限"});
  if (isRateLimited(req)) return res.status(429).json({error: "操作太頻繁，請一分鐘後再試"});
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({error: "AI 服務尚未完成安全設定"});

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
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        store: false,
        instructions: SYSTEM_PROMPT,
        input: JSON.stringify(task),
        text: {
          format: {
            type: "json_schema",
            name: phase === "analyze" ? "workplace_message_analysis" : "workplace_translation",
            strict: true,
            schema
          }
        }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("OpenAI request failed", response.status, data?.error?.code, response.headers.get("x-request-id"));
      return res.status(502).json({error: "AI 暫時無法處理，請稍後再試"});
    }

    const outputText = getOutputText(data);
    if (!outputText) return res.status(502).json({error: "AI 沒有回傳翻譯結果"});

    let result;
    try {
      result = JSON.parse(outputText);
    } catch {
      return res.status(502).json({error: "AI 回傳格式不正確"});
    }
    return res.status(200).json(result);
  } catch (error) {
    console.error("AI backend error", error?.message);
    return res.status(502).json({error: "AI 連線失敗，請稍後再試"});
  }
};
