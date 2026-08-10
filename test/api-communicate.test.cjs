const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/communicate.js");

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; }
  };
}

function createRequest(body, overrides = {}) {
  return {
    method: "POST",
    body,
    headers: {origin: "http://localhost:8080", host: "localhost:3000", "x-forwarded-for": "127.0.0.1"},
    socket: {remoteAddress: "127.0.0.1"},
    ...overrides
  };
}

test("沒有後端 API Key 時拒絕呼叫", async () => {
  const savedKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const res = createResponse();
  await handler(createRequest({}), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "AI 服務尚未完成安全設定");
  if (savedKey) process.env.OPENAI_API_KEY = savedKey;
});

test("有效分析請求只回傳結構化結果", async () => {
  const savedKey = process.env.OPENAI_API_KEY;
  const savedFetch = global.fetch;
  process.env.OPENAI_API_KEY = "test-key";
  const expected = {
    detectedLanguage: "zh-TW",
    originalText: "今天要加班嗎？",
    understoodMeaning: "詢問今天是否需要加班。",
    mainIntent: "確認加班安排",
    tone: "直接詢問",
    confidence: 0.98,
    uncertainParts: [],
    keywords: [{original: "加班", meaning: "超過正常工時工作", role: "工作安排"}]
  };
  global.fetch = async (_url, options) => {
    const requestBody = JSON.parse(options.body);
    assert.equal(requestBody.model, "gpt-5-mini");
    assert.equal(requestBody.store, false);
    assert.equal(requestBody.text.format.type, "json_schema");
    return new Response(JSON.stringify({output_text: JSON.stringify(expected)}), {
      status: 200,
      headers: {"Content-Type": "application/json"}
    });
  };

  const res = createResponse();
  await handler(createRequest({
    sourceLanguage: "zh-TW",
    targetLanguage: "vi",
    originalText: "今天要加班嗎？",
    phase: "analyze"
  }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, expected);

  global.fetch = savedFetch;
  if (savedKey) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});
