"use strict";

(function exposeVoiceCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.VoiceCore = api;
})(typeof window !== "undefined" ? window : globalThis, function createVoiceCore() {
  const MODES = new Set(["verbatim", "clean", "structured"]);

  function normalizeTranscript(value, mode) {
    let text = String(value || "").normalize("NFC").trim();
    if (mode === "verbatim") return text.replace(/[ \t]+/g, " ");
    text = text.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n");
    return text;
  }

  function applyDictionary(text, entries, language) {
    const hits = [];
    const warnings = [];
    const active = (Array.isArray(entries) ? entries : [])
      .filter(entry => entry && entry.enabled !== false && (!entry.language || entry.language === language))
      .sort((a, b) => String(b.canonical || "").length - String(a.canonical || "").length);

    for (const entry of active) {
      const canonical = String(entry.canonical || "").trim();
      if (!canonical) continue;
      for (const variantValue of entry.variants || []) {
        const variant = String(variantValue || "").trim();
        if (!variant || variant === canonical || !text.includes(variant)) continue;
        const conflicting = active.some(other => other !== entry && (other.variants || []).includes(variant));
        if (conflicting) {
          warnings.push(`字典規則衝突：${variant}`);
          continue;
        }
        text = text.split(variant).join(canonical);
        hits.push({source: variant, canonical, category: entry.category || "term"});
      }
    }
    return {text, hits, warnings};
  }

  function fromTranscript(input = {}) {
    const requestId = input.request_id || `voice-${Date.now()}`;
    const rawTranscript = String(input.raw_transcript || input.transcript || "").trim();
    const mode = MODES.has(input.mode) ? input.mode : "clean";
    const language = input.language || "auto";
    if (!rawTranscript) {
      return {
        request_id: requestId, status: "error", text: "", raw_transcript: "", language, mode,
        uncertain_spans: [], dictionary_hits: [], changes: [], engines: {speech: input.speech_engine || null, cleanup: "browser-basic"},
        warnings: [], error: {code: "INVALID_INPUT", message: "沒有可用的語音逐字稿"}
      };
    }

    const normalized = normalizeTranscript(rawTranscript, mode);
    const dictionaryResult = applyDictionary(normalized, input.dictionary?.entries, language);
    const confidence = Number(input.confidence);
    const lowConfidence = Number.isFinite(confidence) && confidence > 0 && confidence < 0.55;
    const uncertainSpans = lowConfidence
      ? [{text: dictionaryResult.text, reason: "語音辨識信心偏低，請確認文字"}]
      : [];
    const warnings = [...dictionaryResult.warnings];
    if (lowConfidence) warnings.push("語音辨識信心偏低");

    return {
      request_id: requestId,
      status: warnings.length || uncertainSpans.length ? "needs_review" : "ok",
      text: dictionaryResult.text,
      raw_transcript: rawTranscript,
      language,
      mode,
      uncertain_spans: uncertainSpans,
      dictionary_hits: dictionaryResult.hits,
      changes: dictionaryResult.text === rawTranscript ? [] : [{type: "normalized", source: rawTranscript}],
      engines: {speech: input.speech_engine || "browser-web-speech", cleanup: "browser-basic"},
      warnings,
      error: null
    };
  }

  return Object.freeze({fromTranscript});
});

