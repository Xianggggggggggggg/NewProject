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
                // 系統設定完畢後，發送一句隱形的話讓 AI 開口
                geminiWs.send(JSON.stringify({ realtimeInput: { text: "你好，我準備好了，請直接針對我的履歷問我第一題。" } }));
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
                        interview_type: interview_type 
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

server.listen(3000, () => console.log(`🚀 伺服器啟動: http://localhost:3000`));