const test = require("node:test");
const assert = require("node:assert/strict");
const VoiceCore = require("../voice-core.js");

test("Voice Core 保留語言與原意，只整理空白", () => {
  const result = VoiceCore.fromTranscript({
    raw_transcript: "  Hôm nay   bạn có tăng ca không?  ",
    language: "vi",
    mode: "clean",
    confidence: 0.9
  });
  assert.equal(result.status, "ok");
  assert.equal(result.text, "Hôm nay bạn có tăng ca không?");
  assert.equal(result.raw_transcript, "Hôm nay   bạn có tăng ca không?");
  assert.equal(result.language, "vi");
});

test("Voice Core 不替低信心逐字稿猜答案", () => {
  const result = VoiceCore.fromTranscript({raw_transcript: "型號是一點三八", confidence: 0.3});
  assert.equal(result.status, "needs_review");
  assert.equal(result.text, "型號是一點三八");
  assert.equal(result.uncertain_spans.length, 1);
});

test("Voice Core 拒絕空白逐字稿", () => {
  const result = VoiceCore.fromTranscript({raw_transcript: "   "});
  assert.equal(result.status, "error");
  assert.equal(result.error.code, "INVALID_INPUT");
});

