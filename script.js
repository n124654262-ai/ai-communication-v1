"use strict";

const SYSTEM_PROMPT = `你是一位精通繁體中文、越南文與英文的專業「多語隨行翻譯官」。你的職責是擔任主管與員工之間的溝通橋樑，專注於工廠與職場環境下的日常對話翻譯。

目的：提供高準確度且符合在地口語習慣的雙向翻譯；透過反向翻譯讓使用者確認譯意；提供職場關鍵詞語境說明。

核心規則：
1. 每一筆輸入都是完全獨立的翻譯任務。嚴禁參考、引用或受任何先前對話影響。
2. 僅根據當次 originalText 分析與翻譯。
3. 自動辨識輸入語言，支援中↔越、中↔英；sourceLanguage 與 targetLanguage 是本次指定方向。
4. 使用道地、母語者常用的職場白話，避免生硬書面語或過時字典定義。
5. 忠實保留原文態度與強度，包括命令、緊急提醒、客氣詢問、質疑、指責與否定。
6. 不得增加原文沒有的禮貌詞、客套話、理由、解釋或資訊；不得美化、弱化或加重語氣。
7. analyze 階段的 understoodMeaning 只能輸出原語言的整理後原句；保留原本說話方式與語氣，只修正明顯辨識錯字、贅詞、重複及標點。不得使用第三人稱解說、摘要、推測用途或加入原文沒有的資訊，也不得產生正式譯文。
8. translate 階段輸出自然譯文、將譯文翻回原語言的 backTranslation，以及關鍵詞語境釋義。
9. 每個關鍵詞說明限 30 個中文字或相當長度，不得輸出無意義客套話。
10. 不確定時明確列入 uncertainParts，不得猜測。
11. translation 必須完全使用 targetLanguage，不得混入來源語言、標籤、解釋或「示範翻譯」等字樣。
12. backTranslation 必須把 translation 重新翻回 sourceLanguage，不可直接複製 originalText；它的用途是揭露可能的語意偏差。
13. translatedKeywords 選出 1 至 5 個真正影響句意的詞組。translated 使用目標語言，original 保留原詞，meaning 以來源語言說明本句職場語境，限 30 字內。
14. 不輸出開場白、結語、Markdown 或 JSON 以外的文字。
15. 必須嚴格符合本次 responseSchema，所有必填欄位均須存在。`;

const RESPONSE_SCHEMAS = {
  analyze: {
    type: "object",
    required: ["detectedLanguage", "originalText", "understoodMeaning", "mainIntent", "tone", "confidence", "uncertainParts", "keywords"],
    properties: {
      detectedLanguage: {type: "string"}, originalText: {type: "string"}, understoodMeaning: {type: "string", description: "原語言的整理後原句，不得解說、摘要或推測用途"},
      mainIntent: {type: "string"}, tone: {type: "string"}, confidence: {type: "number", minimum: 0, maximum: 1},
      uncertainParts: {type: "array", items: {type: "string"}},
      keywords: {type: "array", items: {type: "object", required: ["original", "meaning", "role"], properties: {original: {type: "string"}, meaning: {type: "string"}, role: {type: "string"}}}}
    }
  },
  translate: {
    type: "object",
    required: ["detectedLanguage", "originalText", "understoodMeaning", "mainIntent", "tone", "confidence", "uncertainParts", "keywords", "translation", "backTranslation", "translatedKeywords"],
    properties: {
      detectedLanguage: {type: "string"}, originalText: {type: "string"}, understoodMeaning: {type: "string"}, mainIntent: {type: "string"}, tone: {type: "string"}, confidence: {type: "number"},
      uncertainParts: {type: "array", items: {type: "string"}}, keywords: {type: "array"}, translation: {type: "string"}, backTranslation: {type: "string"},
      translatedKeywords: {type: "array", minItems: 1, maxItems: 5, items: {type: "object", required: ["original", "translated", "meaning"], properties: {original: {type: "string"}, translated: {type: "string"}, meaning: {type: "string", maxLength: 60}}}}
    }
  }
};

const LANGUAGES = {"zh-TW":{name:"繁體中文",speech:"zh-TW"},vi:{name:"越南文",speech:"vi-VN"},en:{name:"英文",speech:"en-US"}};
const UI_LABELS={vi:{language:"（Chọn ngôn ngữ dịch）",start:"（Bắt đầu nói）",recognized:"（Văn bản nhận diện）",translation:"（Bản dịch）",keywords:"（Từ ngữ quan trọng）",mic:"按下開始錄音",listening:"結束錄音並轉文字"},en:{language:"（Choose translation language）",start:"（Start speaking）",recognized:"（Recognized text）",translation:"（Translation）",keywords:"（Key terms）",mic:"按下開始錄音",listening:"結束錄音並轉文字"},"zh-TW":{language:"（目標語言）",start:"（錄音）",recognized:"（辨識文字）",translation:"（翻譯結果）",keywords:"（關鍵詞）",mic:"按下開始錄音",listening:"結束錄音並轉文字"}};
const $ = id => document.getElementById(id);
const ui = Object.fromEntries(["sourceLanguage","targetLanguage","provider","statusBanner","inputPanel","textInput","micBtn","micLabel","permissionHelp","originalPanel","originalText","analysisPanel","understoodMeaning","mainIntent","tone","keywords","confidenceBar","confidenceText","uncertainBlock","uncertainParts","translationPanel","targetLanguageLabel","translationText","backTranslation","translatedKeywords","historyPanel","historyList"].map(id=>[id,$(id)]));
let eventState = createEmptyEvent();
let recognition = null;
let isRecording = false;
let speechBuffer = "";
let speechConfidence = null;
let silenceTimer = null;
let runtimeConfig = {...(window.APP_CONFIG || {})};

function createEmptyEvent(){return {id:crypto.randomUUID?.() || String(Date.now()),originalText:"",analysis:null,result:null,confirmed:false,logged:false};}
function setStatus(message,isError=false){ui.statusBanner.textContent=message;ui.statusBanner.style.borderLeftColor=isError?"#b6362f":"#167d62";}
function show(el,visible=true){el.classList.toggle("hidden",!visible);}
function escapeHtml(value=""){const d=document.createElement("div");d.textContent=String(value);return d.innerHTML;}
function autoResizeTextInput(){ui.textInput.style.height="auto";ui.textInput.style.height=`${Math.min(ui.textInput.scrollHeight,160)}px`;ui.textInput.style.overflowY=ui.textInput.scrollHeight>160?"auto":"hidden";}
// 操作完成後保留使用者目前的捲動位置，避免手機畫面突然跳動。
function scrollToPanel(){/* intentionally disabled */}

function init(){
  Object.entries(LANGUAGES).forEach(([value,{name}])=>{ui.sourceLanguage.add(new Option(name,value));ui.targetLanguage.add(new Option(name,value));});
  ui.sourceLanguage.value="zh-TW";ui.targetLanguage.value="vi";ui.provider.value=runtimeConfig.defaultProvider || "gemini";
  ui.provider.options[0].textContent=runtimeConfig.apiBaseUrl?"Gemini 3.5 Flash-Lite":"Gemini 測試介面";
  updateLocalizedLabels();setupSpeechRecognition();bindEvents();
}
function updateLocalizedLabels(){const labels=UI_LABELS[ui.targetLanguage.value]||UI_LABELS.vi;$("startLocalized").textContent=labels.start;$("recognizedLocalized").textContent=labels.recognized;$("translationLocalized").textContent=labels.translation;$("keywordsLocalized").textContent=labels.keywords;if(!ui.micBtn.classList.contains("recording"))ui.micLabel.textContent=labels.mic;}

function bindEvents(){
  $("swapLanguages").onclick=()=>{};
  ui.targetLanguage.onchange=()=>{ui.sourceLanguage.value=ui.targetLanguage.value==="zh-TW"?"vi":"zh-TW";updateLocalizedLabels();setupSpeechRecognition();};
  ui.provider.onchange=()=>setStatus(runtimeConfig.apiBaseUrl?"Google Gemini 已連線":"Gemini 尚未連接安全後端");
  ui.textInput.addEventListener("input",autoResizeTextInput);
  ui.micBtn.onclick=toggleRecording;
  $("submitTextBtn").onclick=()=>acceptOriginal(ui.textInput.value);
  $("recordAgainBtn").onclick=resetCurrentInput;$("analyzeBtn").onclick=analyzeCurrent;
  $("confirmBtn").onclick=translateConfirmed;$("editBtn").onclick=editOriginal;
  $("nextBtn").onclick=resetAll;
  $("clearHistoryBtn").onclick=()=>{ui.historyList.replaceChildren();show(ui.historyPanel,false);};
}

function setupSpeechRecognition(){
  const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SpeechRecognition){ui.micBtn.disabled=true;return;}
  recognition=new SpeechRecognition();recognition.lang=navigator.language||LANGUAGES[ui.sourceLanguage.value].speech;recognition.interimResults=true;recognition.continuous=true;
  recognition.onstart=()=>{ui.micBtn.classList.add("recording");ui.micLabel.textContent=(UI_LABELS[ui.targetLanguage.value]||UI_LABELS.vi).listening;setStatus("正在錄音；停頓不會停止，連續安靜 10 秒會自動結束。");};
  recognition.onresult=e=>{let interim="";let heardSpeech=false;for(let i=e.resultIndex;i<e.results.length;i++){const alternative=e.results[i][0];const part=alternative.transcript;if(part.trim())heardSpeech=true;if(Number.isFinite(alternative.confidence)&&alternative.confidence>0)speechConfidence=alternative.confidence;if(e.results[i].isFinal)speechBuffer=window.VoiceCore.mergeTranscriptSegments(speechBuffer,part);else interim=window.VoiceCore.mergeTranscriptSegments(interim,part);}const combined=window.VoiceCore.mergeTranscriptSegments(speechBuffer,interim);ui.textInput.value=combined;autoResizeTextInput();if(heardSpeech)scheduleSilenceStop();};
  recognition.onerror=e=>{if(e.error==="no-speech"&&isRecording)return;const denied=e.error==="not-allowed"||e.error==="service-not-allowed";isRecording=false;clearSilenceTimer();show(ui.permissionHelp,denied);setStatus(denied?"麥克風權限被拒絕，請依提示開啟權限，或改用文字輸入。":`語音辨識失敗（${e.error}），請改用文字輸入。`,true);finishRecordingUi();};
  recognition.onend=()=>{if(isRecording){setTimeout(()=>{try{recognition.start();}catch{}},150);}else finishRecordingUi();};ui.micBtn.disabled=false;
}
function toggleRecording(){if(isRecording)finishAndConvertRecording();else startRecording();}
function startRecording(){speechBuffer="";speechConfidence=null;ui.textInput.value="";autoResizeTextInput();isRecording=true;scheduleSilenceStop();try{recognition?.start();}catch{isRecording=false;clearSilenceTimer();setStatus("錄音尚未結束，請稍候再試。",true);}}
function scheduleSilenceStop(){clearSilenceTimer();silenceTimer=setTimeout(finishAndConvertRecording,10000);}
function clearSilenceTimer(){if(silenceTimer){clearTimeout(silenceTimer);silenceTimer=null;}}
function finishAndConvertRecording(){if(!isRecording)return;isRecording=false;clearSilenceTimer();try{recognition?.stop();}catch{}const rawTranscript=ui.textInput.value.trim();finishRecordingUi();if(!rawTranscript){setStatus("沒有辨識到文字，請重新錄音或直接輸入。",true);return;}if(!window.VoiceCore){setStatus("Voice Core 未載入，請重新整理頁面。",true);return;}const result=window.VoiceCore.fromTranscript({source:{type:"transcript",transcript:rawTranscript},raw_transcript:rawTranscript,language:"auto",mode:"clean",confidence:speechConfidence,speech_engine:"browser-web-speech",dictionary:{entries:[]}});if(result.status==="error"){setStatus(`Voice Core 轉文字失敗：${result.error?.message||"未知錯誤"}`,true);return;}ui.textInput.value=result.text;autoResizeTextInput();setStatus(result.status==="needs_review"?"Voice Core 已產出文字，辨識信心偏低，請先確認。":"Voice Core 已產出文字，正在交給 Gemini 理解原意。");acceptOriginal(result.text);}
function finishRecordingUi(){ui.micBtn.classList.remove("recording");ui.micLabel.textContent=(UI_LABELS[ui.targetLanguage.value]||UI_LABELS.vi).mic;}
function parseDirectionCommand(text){
  const rules={"*中越":["zh-TW","vi"],"*越中":["vi","zh-TW"],"*中英":["zh-TW","en"],"*英中":["en","zh-TW"]};
  const command=Object.keys(rules).find(key=>text.startsWith(key));
  if(!command)return{text:text.trim(),forced:false};
  [ui.sourceLanguage.value,ui.targetLanguage.value]=rules[command];
  updateLocalizedLabels();setupSpeechRecognition();
  return{text:text.slice(command.length).trim(),forced:true,command};
}
function detectInputLanguage(text){if(/[\u3400-\u9fff]/u.test(text))return "zh-TW";if(/[ăâđêôơưĂÂĐÊÔƠƯàáảãạèéẻẽẹìíỉĩịòóỏõọùúủũụỳýỷỹỵ]/iu.test(text)||/\b(tôi|bạn|không|có|là|hôm|nay|được|rồi|và|của|thì|phải)\b/iu.test(text))return "vi";return "en";}
function applyAutomaticDirection(text){const detected=detectInputLanguage(text);ui.sourceLanguage.value=detected;if(detected!=="zh-TW")ui.targetLanguage.value="zh-TW";else if(ui.targetLanguage.value==="zh-TW")ui.targetLanguage.value="vi";updateLocalizedLabels();setupSpeechRecognition();return detected;}
function acceptOriginal(text){const parsed=parseDirectionCommand(text.trim());text=parsed.text;if(!text){setStatus("語言指令後仍需輸入要翻譯的內容。",true);return;}const detected=parsed.forced?ui.sourceLanguage.value:applyAutomaticDirection(text);eventState=createEmptyEvent();eventState.originalText=text;ui.originalText.value=text;ui.textInput.value=text;show(ui.inputPanel);show(ui.originalPanel,false);show(ui.analysisPanel,false);resetTranslationPanel();setStatus(parsed.forced?`已依 ${parsed.command} 指定方向，正在理解這句話…`:`已辨識為${LANGUAGES[detected].name}，將翻譯成${LANGUAGES[ui.targetLanguage.value].name}。`);analyzeCurrent();}

async function analyzeCurrent(){
  const text=ui.originalText.value.trim();if(!text){setStatus("原始內容不可空白。",true);return;}
  eventState=createEmptyEvent();eventState.originalText=text;toggleBusy($("analyzeBtn"),true,"AI 理解中…");
  try{eventState.analysis=await analyzeAndTranslate({provider:ui.provider.value,sourceLanguage:ui.sourceLanguage.value,targetLanguage:ui.targetLanguage.value,originalText:text,phase:"analyze"});validateAnalysis(eventState.analysis);renderAnalysis(eventState.analysis);show(ui.analysisPanel);setStatus("AI 理解完成。請說話者確認內容是否正確。");scrollToPanel(ui.analysisPanel);}catch(error){setStatus(`AI 理解失敗：${error.message}`,true);}finally{toggleBusy($("analyzeBtn"),false,"開始 AI 理解");}
}

async function translateConfirmed(){
  if(!eventState.analysis)return;eventState.confirmed=true;toggleBusy($("confirmBtn"),true,"正式翻譯中…");
  try{const data=await analyzeAndTranslate({provider:ui.provider.value,sourceLanguage:ui.sourceLanguage.value,targetLanguage:ui.targetLanguage.value,originalText:eventState.originalText,phase:"translate",analysis:eventState.analysis});validateTranslation(data);eventState.result=data;renderTranslation(data);if(!eventState.logged){appendHistory(data.understoodMeaning,data.translation);eventState.logged=true;}show(ui.translationPanel);setStatus("正式翻譯已完成。請手動播放給接收者。");scrollToPanel(ui.translationPanel);}catch(error){eventState.confirmed=false;setStatus(`翻譯失敗：${error.message}`,true);}finally{toggleBusy($("confirmBtn"),false,"YES");}
}

async function analyzeAndTranslate({provider,sourceLanguage,targetLanguage,originalText,phase,analysis}){
  const adapter=providers[provider];if(!adapter)throw new Error("不支援所選 AI 模型");
  return adapter({sourceLanguage,targetLanguage,originalText,phase,analysis});
}
const providers={gemini:payload=>proxyProvider("gemini",payload)};
async function proxyProvider(provider,payload){
  if(!runtimeConfig.apiBaseUrl)return demoProvider(payload);
  const response=await fetch(runtimeConfig.apiBaseUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({provider,...payload})});
  if(!response.ok){let detail="";try{detail=(await response.json()).error||"";}catch{}throw new Error(detail||`API 回應錯誤 ${response.status}`);}let data;try{data=await response.json();}catch{throw new Error("模型未回傳有效 JSON");}return data;
}

function demoProvider({sourceLanguage,targetLanguage,originalText,phase,analysis}){
  const normalizedText=originalText.replace(/[。！？?!，,]/g," ").replace(/\s+/g," ").trim();
  const examples={
    "HOW ARE YOU":{meaning:"說話者詢問對方目前是否安好。",intent:"問候並關心對方近況",tone:"友善詢問",confidence:.99,uncertain:[],keywords:[q("HOW ARE YOU","你好嗎","日常問候")],translations:{"zh-TW":"你好嗎？"},translatedKeywords:{"zh-TW":[{original:"HOW ARE YOU",translated:"你好嗎",meaning:"關心對方目前狀況的問候語"}]}},
    "你明天不用來上班了":{meaning:"說話者直接通知對方明天不需要出勤。",intent:"通知對方明天不用上班",tone:"直接通知",confidence:.96,uncertain:[],keywords:[q("你","被通知的對象","對象"),q("明天","下一天；此句中的時間","時間"),q("不用來上班","明天不需要到工作場所出勤","核心訊息")],translations:{vi:"Ngày mai bạn không cần đến làm việc.",en:"You don't need to come to work tomorrow."}},
    "我覺得你不誠實 你都亂打卡":{meaning:"說話者判斷對方不誠實，並指責對方的打卡行為不正確。",intent:"指責對方誠信與打卡行為",tone:"指責",confidence:.94,uncertain:[],keywords:[q("我覺得","說話者的判斷","立場"),q("你不誠實","對對方誠信的負面評價","指責"),q("亂打卡","打卡行為被認為不正確或不符合實際狀況","核心指控")],translations:{vi:"Tôi thấy bạn không trung thực, bạn chấm công lung tung.",en:"I think you're dishonest. You clock in and out improperly."}},
    "這個先不要做":{meaning:"說話者要求暫時停止執行某件未明確指出的事情。",intent:"暫時停止執行",tone:"直接指示",confidence:.82,uncertain:["「這個」的指涉對象不明確，無法只從本次輸入判斷。"],keywords:[q("這個","指涉對象不明","對象"),q("先不要做","暫時停止執行","核心指示")],translations:{vi:"Tạm thời đừng làm việc này.",en:"Don't do this for now."}},
    "你今天有加班嗎 加班事先申請單有送給我嗎":{meaning:"說話者詢問對方今天是否加班，以及是否已把加班事先申請單交給說話者。",intent:"確認加班情況與申請單是否送達",tone:"直接詢問",confidence:.97,uncertain:[],keywords:[q("今天有加班嗎","詢問今天是否安排或進行加班","詢問"),q("加班事先申請單","加班前必須提交的申請文件","文件"),q("有送給我嗎","確認文件是否已交給說話者","確認")],translations:{vi:"Hôm nay bạn có tăng ca không? Bạn đã gửi phiếu đăng ký tăng ca trước cho tôi chưa?",en:"Are you working overtime today? Have you sent me the advance overtime request form?"},translatedKeywords:{vi:[{original:"今天有加班嗎",translated:"Hôm nay bạn có tăng ca không?",meaning:"詢問今天是否有加班"},{original:"加班事先申請單",translated:"phiếu đăng ký tăng ca trước",meaning:"加班前須提交的申請文件"},{original:"有送給我嗎",translated:"đã gửi cho tôi chưa?",meaning:"確認文件是否已送達"}]}}
  };
  const e=examples[normalizedText];
  if(!e){
    const mockTranslation={vi:"Đây là nội dung dịch mô phỏng để kiểm tra giao diện.",en:"This is simulated translation content for interface testing.","zh-TW":"這是用來測試介面的模擬翻譯內容。"}[targetLanguage];
    if(phase==="analyze")return Promise.resolve({detectedLanguage:sourceLanguage,originalText,understoodMeaning:originalText,mainIntent:"判斷說話者原意後進行翻譯",tone:"模擬資料",confidence:1,uncertainParts:[],keywords:[q("介面測試","用於驗證畫面及操作流程","測試資料")]});
    return Promise.resolve({...analysis,translation:mockTranslation,backTranslation:"這是介面測試用模擬資料，並非真正翻譯。",translatedKeywords:[{original:"介面測試",translated:targetLanguage==="vi"?"kiểm tra giao diện":targetLanguage==="en"?"interface testing":"介面測試",meaning:"模擬重點用詞，並非 AI 擷取"}]});
  }
  if(phase==="analyze")return Promise.resolve({detectedLanguage:sourceLanguage,originalText,understoodMeaning:e.meaning,mainIntent:e.intent,tone:e.tone,confidence:e.confidence,uncertainParts:e.uncertain,keywords:e.keywords});
  const translation=e.translations[targetLanguage];
  if(!translation)return Promise.reject(new Error("示範模式沒有這個語言方向的譯文，請連接 AI API。"));
  const translatedKeywords=e.translatedKeywords?.[targetLanguage]||e.keywords.map(k=>({original:k.original,translated:k.original,meaning:k.meaning}));
  return Promise.resolve({...analysis,translation,backTranslation:originalText,translatedKeywords});
}
function q(original,meaning,role){return{original,meaning,role};}
function validateAnalysis(d){if(!d||typeof d!=="object"||!d.understoodMeaning||!d.mainIntent||!d.tone||!Number.isFinite(Number(d.confidence))||!Array.isArray(d.keywords)||!Array.isArray(d.uncertainParts))throw new Error("AI 回傳的理解 JSON 欄位不完整");}
function validateTranslation(d){validateAnalysis(d);if(!d.translation||!d.backTranslation||!Array.isArray(d.translatedKeywords))throw new Error("AI 回傳的翻譯 JSON 欄位不完整");}
function renderAnalysis(d){ui.understoodMeaning.textContent=d.understoodMeaning;ui.mainIntent.textContent=d.mainIntent;ui.tone.textContent=d.tone;renderKeywords(ui.keywords,d.keywords,false);const pct=Math.round(Math.max(0,Math.min(1,Number(d.confidence)))*100);ui.confidenceBar.style.width=`${pct}%`;ui.confidenceText.textContent=`AI 理解信心：${pct}%`;ui.uncertainParts.innerHTML=d.uncertainParts.map(x=>`<li>${escapeHtml(x)}</li>`).join("");show(ui.uncertainBlock,d.uncertainParts.length>0);}
function renderTranslation(d){ui.targetLanguageLabel.textContent=LANGUAGES[ui.targetLanguage.value].name;ui.translationText.classList.remove("output-placeholder");ui.translationText.textContent=d.translation;ui.backTranslation.textContent=d.backTranslation;ui.translatedKeywords.innerHTML=d.translatedKeywords.map(k=>`<li><strong>${escapeHtml(k.translated||k.original)} / ${escapeHtml(k.original)}</strong><p><strong>說明：</strong>${escapeHtml(k.meaning)}</p></li>`).join("");}
function resetTranslationPanel(){show(ui.translationPanel);ui.translationText.textContent="等待翻譯內容…";ui.translationText.classList.add("output-placeholder");ui.backTranslation.textContent="";ui.translatedKeywords.innerHTML='<li class="output-placeholder">尚未產生重點用詞</li>';}
function appendHistory(recognizedText,translation){const entry=document.createElement("article");entry.className="history-entry";const source=document.createElement("p");source.className="history-recognized";source.textContent=recognizedText;const arrow=document.createElement("span");arrow.className="history-arrow";arrow.textContent="→";arrow.setAttribute("aria-hidden","true");const target=document.createElement("p");target.className="history-ai-translation";target.textContent=translation;entry.append(source,arrow,target);ui.historyList.append(entry);show(ui.historyPanel);}
function renderKeywords(container,items,translated){container.innerHTML=items.map(k=>`<div class="keyword-item"><strong>${escapeHtml(k.original)}${translated&&k.translated?` → ${escapeHtml(k.translated)}`:""}</strong><span>${escapeHtml(k.meaning)}</span>${!translated&&k.role?`<br><small>作用：${escapeHtml(k.role)}</small>`:""}</div>`).join("");}
function toggleBusy(button,busy,label){button.disabled=busy;button.textContent=label;}
function editOriginal(){show(ui.analysisPanel,false);show(ui.originalPanel,false);show(ui.inputPanel);eventState.analysis=null;eventState.confirmed=false;ui.textInput.value=eventState.originalText;resetTranslationPanel();setStatus("請修改後重新送出。");}
function resetCurrentInput(){eventState=createEmptyEvent();ui.textInput.value="";autoResizeTextInput();ui.originalText.value="";show(ui.inputPanel);show(ui.originalPanel,false);show(ui.analysisPanel,false);resetTranslationPanel();setStatus("請重新說話或輸入文字。");scrollToPanel(ui.inputPanel);}
function resetAll(){resetCurrentInput();setStatus("上一個事件已完全清除，可以開始下一次溝通。");}
init();

