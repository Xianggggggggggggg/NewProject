const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const OpenCC = require('opencc-js');
const convert = OpenCC.Converter({ from: 'cn', to: 'tw' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));
// =====================================================================
// 🌟 面試結果報告生成 API 區塊 (對接 result.html)
// =====================================================================
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai/index.js');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY_REPORT);
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const REPORT_PROVIDER_PRIMARY = (process.env.REPORT_PROVIDER_PRIMARY || 'gemini').toLowerCase();
const REPORT_PROVIDER_FALLBACK = (process.env.REPORT_PROVIDER_FALLBACK || 'gpt').toLowerCase();
const GEMINI_REPORT_MODEL = process.env.GEMINI_REPORT_MODEL || 'gemini-2.5-flash';
const OPENAI_REPORT_MODEL = process.env.OPENAI_REPORT_MODEL || 'gpt-4o-mini';

app.use(express.json()); // 確保 Express 能解析 POST body 中的 JSON

function shouldFallbackByStatus(err) {
    return !!(err && (err.status === 401 || err.status === 429 || err.status === 503));
}

function buildReportPrompt(transcript) {
    return `
        你是一位嚴格且專業的 HR 招募專家與面試官。
        請深度分析以下的面試對話紀錄，並給出客觀的評估。

        【對話紀錄】：
        ${transcript}

        【任務要求】：
        請務必根據上述對話，嚴格按照以下 JSON 格式回傳報告（不要加上任何其他說明文字）：
        {
            "grade": "給予 A, B, C 或 D 的評等",
            "grade_title": "一句話總結表現 (如：表現優異、具備潛力、需加強經驗等)",
            "overall_score": 0到100的整數綜合評分,
            "summary": "150字以內的整體面試表現總結評語",
            "highlights": ["亮點1", "亮點2", "亮點3"],
            "concerns": ["待觀察或需加強的點1", "待觀察或需加強的點2"],
            "qa": [
                {
                    "question": "還原面試官當時問的具體問題",
                    "score": 0到10的整數 (該題回答的分數),
                    "feedback": "針對應徵者該題回答的具體分析與改進建議"
                }
            ]
        }
        `;
}

function parseJsonSafely(text) {
    const raw = (text || '').trim();
    if (!raw) throw new Error('模型未回傳內容');

    try {
        return JSON.parse(raw);
    } catch (e) {
        const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
        return JSON.parse(cleaned);
    }
}

async function generateReportByGemini(prompt) {
    if (!process.env.GEMINI_API_KEY_REPORT) {
        const err = new Error('缺少 GEMINI_API_KEY_REPORT');
        err.status = 401;
        throw err;
    }

    const model = genAI.getGenerativeModel({
        model: GEMINI_REPORT_MODEL,
        generationConfig: {
            responseMimeType: "application/json",
        }
    });

    const result = await model.generateContent(prompt);
    return parseJsonSafely(result.response.text());
}

async function generateReportByGpt(prompt) {
    if (!openai) {
        const err = new Error('缺少 OPENAI_API_KEY');
        err.status = 401;
        throw err;
    }

    const completion = await openai.chat.completions.create({
        model: OPENAI_REPORT_MODEL,
        messages: [
            { role: "system", content: "你是專業 HR 面試分析助理，請只輸出合法 JSON，不要任何多餘文字。" },
            { role: "user", content: prompt }
        ],
        temperature: 0.4,
        response_format: { type: "json_object" }
    });

    const text = completion.choices?.[0]?.message?.content || '';
    return parseJsonSafely(text);
}

// 1. 取得指定 session_id 的對話紀錄
app.get('/api/transcript', async (req, res) => {
    // 🌟 從網址參數抓取 session_id (例如：/api/transcript?session_id=xxxx)
    const { session_id } = req.query;

    // 防呆：如果前端沒有傳 session_id，直接擋掉並回傳錯誤
    if (!session_id) {
        return res.status(400).json({ error: "缺少 session_id 參數" });
    }

    try {
        // 從 Supabase 撈取特定場次的面試逐字稿
        const { data, error } = await supabase
            .from('transcripts')
            .select('text_content')
            .eq('session_id', session_id) // 🌟 核心：加入這行進行精準條件限制
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (error || !data) {
            return res.status(404).json({ error: "找不到該場次的對話紀錄" });
        }

        res.json({ transcript: data.text_content });
    } catch (err) {
        console.error('❌ 獲取對話紀錄失敗:', err);
        res.status(500).json({ error: "伺服器錯誤" });
    }
});
// 2. 取得指定場次的履歷與面試資訊
app.get('/api/resume', async (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: "缺少 session_id 參數" });

    try {
        // 先找面試場次資訊
        const { data: sessionData, error: sessionErr } = await supabase
            .from('interview_sessions')
            .select('resume_id, applied_position, start_time')
            .eq('session_id', session_id)
            .single();

        if (sessionErr || !sessionData) throw new Error("找不到面試場次");

        // 🚨 防呆機制：如果這場連線沒有綁定到履歷 ID，給予預設值讓系統繼續跑
        if (!sessionData.resume_id) {
            console.warn(`⚠️ 警告：Session ${session_id} 缺少 resume_id，使用預設值回傳。`);
            return res.json({
                name: "未綁定履歷",
                apply_role: sessionData.applied_position || "未指定",
                education: "未提供學歷",
                interview_date: new Date(sessionData.start_time).toLocaleDateString()
            });
        }

        // 去 Resumes 表找履歷細節
        const { data: resumeData, error: resumeErr } = await supabase
            .from('resumes')
            .select('resume_name, education')
            .eq('resume_id', sessionData.resume_id)
            .single();

        if (resumeErr) throw new Error("找不到對應履歷");

        res.json({
            name: resumeData.resume_name,
            apply_role: sessionData.applied_position || "未指定",
            education: resumeData.education || "未提供學歷",
            interview_date: new Date(sessionData.start_time).toLocaleDateString()
        });

    } catch (err) {
        console.error('❌ 獲取履歷失敗:', err);
        res.status(500).json({ error: "履歷讀取失敗" });
    }
});
// 3. 呼叫 Gemini 產生結構化面試報告 (強制輸出 JSON)
app.post('/api/generate-report', async (req, res) => {
    const { transcript } = req.body;

    if (!transcript) {
        return res.status(400).json({ error: "缺少對話紀錄" });
    }

    try {
        console.log("🧠 正在生成 AI 面試報告...");
        const prompt = buildReportPrompt(transcript);
        const providers = [REPORT_PROVIDER_PRIMARY];
        if (REPORT_PROVIDER_FALLBACK && REPORT_PROVIDER_FALLBACK !== REPORT_PROVIDER_PRIMARY) {
            providers.push(REPORT_PROVIDER_FALLBACK);
        }

        let lastError = null;
        for (let i = 0; i < providers.length; i++) {
            const provider = providers[i];
            const isLastProvider = i === providers.length - 1;
            try {
                const report = provider === 'gpt'
                    ? await generateReportByGpt(prompt)
                    : await generateReportByGemini(prompt);
                console.log(`✅ 報告生成完畢 (provider: ${provider})`);
                return res.json(report);
            } catch (err) {
                lastError = err;
                if (!isLastProvider && shouldFallbackByStatus(err)) {
                    console.warn(`⚠️ ${provider} 產生報告失敗 (${err.status || 'no-status'})，嘗試 fallback...`);
                    continue;
                }
                throw err;
            }
        }

        throw lastError || new Error('AI 報告生成失敗');

    } catch (error) {
        console.error("❌ 生成報告失敗:", error);
        if (error && error.status === 429) {
            return res.status(429).json({
                error: "AI 配額不足或已超過限制，請檢查 Gemini / GPT 的 API Key 與配額設定。"
            });
        }

        if (error && error.status === 401) {
            return res.status(401).json({
                error: "AI API Key 無效或缺失，請檢查 .env 的 GEMINI_API_KEY_REPORT 與 OPENAI_API_KEY。"
            });
        }

        res.status(500).json({ error: "AI 報告生成失敗，請檢查伺服器日誌。" });
    }
});

const MODEL_NAME = "models/gemini-3.1-flash-live-preview";
const GEMINI_WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;

const logDir = path.join(__dirname, 'interviews');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);

wss.on('connection', (clientWs) => {
    console.log('\n🟢 [前端] 已連線');

    let geminiWs = null; // 延遲初始化 Gemini
    let aiSpeechBuffer = "";
    let aiFlushTimeout = null;
    let currentSessionId = null;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    let interviewData = { transcript: [] };

    const addLog = (role, text, type = "speech") => {
        if (!text || text.trim().length === 0) return;
        interviewData.transcript.push({
            timestamp: new Date().toISOString(),
            role: role,
            type: type,
            content: text
        });
    };

    // --- 寫入逐字稿到資料庫 ---
    const saveToDatabase = async () => {
        try {
            if (!currentSessionId) return console.warn('⚠️ 無 session_id，跳過資料庫存檔');

            const fullConversationLog = interviewData.transcript
                .filter(item => item.type === "speech")
                .map(item => `${item.role === 'ai' ? 'AI 面試官' : '應徵者'}：${item.content}`)
                .join('\n\n');

            if (!fullConversationLog) return;

            const { error } = await supabase.from('transcripts').insert([{
                session_id: currentSessionId,
                speaker: 'FULL_CONVERSATION',
                text_content: fullConversationLog,
                created_at: new Date().toISOString()
            }]);

            if (error) throw error;
            console.log(`✅ 已將整場對話存入 session: ${currentSessionId}`);
        } catch (err) {
            console.error('❌ 資料庫寫入失敗:', err.message);
        }
    };

    // --- 🚀 啟動 Gemini 連線 (帶上動態提示詞) ---
    const startGeminiConnection = (dynamicSystemPrompt) => {
        geminiWs = new WebSocket(GEMINI_WS_URL);

        geminiWs.on('open', () => {
            console.log('🤖 正在把履歷與職位注入 AI 系統...');
            geminiWs.send(JSON.stringify({
                setup: {
                    model: MODEL_NAME,
                    systemInstruction: { parts: [{ text: dynamicSystemPrompt }] },
                    generationConfig: {
                        responseModalities: ["AUDIO"],
                        thinking_config: { thinking_level: "low", include_thoughts: true }
                    },
                    realtime_input_config: { automatic_activity_detection: { silence_duration_ms: 1200 } }
                }
            }));
        });

        geminiWs.on('message', (data) => {
            const response = JSON.parse(data.toString());
            clientWs.send(data.toString());

            if (response.setupComplete) {
                // 🌟 3. 第一句話的引導詞也稍微調整得更自然
                geminiWs.send(JSON.stringify({ realtimeInput: { text: "你好，我準備好開始面試了，請直接針對我的履歷問我第一題。" } }));
            }

            if (response.serverContent?.modelTurn?.parts) {
                response.serverContent.modelTurn.parts.forEach(p => { if (p.thought) addLog("ai", p.text, "thought"); });
            }

            if (response.serverContent?.inputTranscription) {
                let userText = convert(response.serverContent.inputTranscription.text).replace(/\s+/g, '');
                userText = userText.replace(/^[,，]+/, '').replace(/[,，]{2,}/g, '，');
                addLog("user", userText, "speech");
                clientWs.send(JSON.stringify({ customType: 'user_transcript', text: userText }));
            }

            if (response.serverContent?.outputTranscription) {
                aiSpeechBuffer += response.serverContent.outputTranscription.text;
                if (aiFlushTimeout) clearTimeout(aiFlushTimeout);
                aiFlushTimeout = setTimeout(() => {
                    const finalSentence = convert(aiSpeechBuffer.trim()).replace(/\s+/g, '');
                    if (finalSentence) {
                        addLog("ai", finalSentence, "speech");
                        clientWs.send(JSON.stringify({ customType: 'ai_transcript_final', text: finalSentence }));
                    }
                    aiSpeechBuffer = "";
                }, 800);
            }
        });
    };

    // --- 關鍵：處理前端傳來的初始化資訊 ---
    clientWs.on('message', async (msg) => {
        try {
            const parsedMsg = JSON.parse(msg.toString());

            // 🌟 攔截初始化請求，並從資料庫抓履歷
            if (parsedMsg.customType === 'init_interview') {
                currentSessionId = parsedMsg.sessionId;
                const { resumeId, position, interview_type } = parsedMsg; // 🌟 新增解構 interview_type
                console.log(`\n⏳ 正在準備面試 [類型: ${interview_type}, 職位: ${position}]`);

                // 🌟 新增資料庫寫入動作：將前端傳來的職位與類型更新到該場次
                // 注意：前端已經先 Insert 了 session_id，所以這裡用 Update
                const { error: updateError } = await supabase
                    .from('interview_sessions')
                    .update({
                        applied_position: position,
                        interview_type: interview_type,
                        resume_id: resumeId
                    })
                    .eq('session_id', currentSessionId);

                if (updateError) {
                    console.error('❌ 更新職位與類型到資料庫失敗:', updateError.message);
                } else {
                    console.log('✅ 職位與類型已成功更新至資料庫！');
                }

                // 1. 去資料庫抓履歷
                let resumeText = "無詳細履歷資料。";
                const { data: resumeData, error } = await supabase
                    .from('resumes')
                    .select('*')
                    .eq('resume_id', resumeId)
                    .single();

                if (resumeData && !error) {
                    resumeText = `
                    學歷：${resumeData.education || '未提供'}
                    語言能力：${resumeData.language_skills || '未提供'}
                    工作經歷：${resumeData.work_experience || '未提供'}
                    自傳與摘要：${resumeData.autobiography || '未提供'}
                    `;
                    console.log('✅ 履歷抓取成功！');
                } else {
                    console.warn('⚠️ 履歷抓取失敗或無資料。');
                }

                // 2. 組裝超級 AI 提示詞
                const systemPrompt = `
                你是一個專業、親切的台灣企業面試官。請全程使用繁體中文（zh-TW）。
                應徵者正在應徵的職位是：【${position}】。
                這是一場【${interview_type}】。 // 🌟 新增這行：告訴 AI 面試的類型

                以下是應徵者的履歷資料：
                ${resumeText}
                
                【你的任務】：
                1. 第一句話請熱情地打招呼，並「直接」根據他的履歷或應徵職位提出第一題（不要只是寒暄）。
                2. 🌟 如果是技術面試，請著重詢問專業工具、框架經驗與解決問題的邏輯；如果是行為面試，請著重詢問團隊合作、危機處理與個人特質。 (新增這行規則)
                3. 接下來的面試中，請緊扣他的履歷內容（如工作經驗、學歷）以及該職位所需的能力進行追問。
                4. 如果應徵者回答簡短，請引導他多講一些具體案例。
                `;

                // 3. 萬事俱備，正式啟動 AI！
                startGeminiConnection(systemPrompt);
                return;
            }
        } catch (e) { }

        // 一般語音轉發
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
            geminiWs.send(msg.toString());
        }
    });

    clientWs.on('close', async () => {
        if (aiFlushTimeout) clearTimeout(aiFlushTimeout);
        console.log('🔴 [前端] 已斷線，啟動存檔...');
        await saveToDatabase();
        if (geminiWs) geminiWs.close();
    });

});

server.listen(3001, () => console.log(`🚀 伺服器啟動: http://localhost:3001`));