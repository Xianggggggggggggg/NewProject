const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// 1. 引入必要套件
const { createClient } = require('@supabase/supabase-js');
const OpenCC = require('opencc-js');
const convert = OpenCC.Converter({ from: 'cn', to: 'tw' });

// 2. 初始化 Supabase
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

    let aiSpeechBuffer = "";
    let aiFlushTimeout = null;
    let currentSessionId = null; // 用來儲存前端同學傳來的 Session ID

    // 初始化這場對話的暫存陣列
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    let interviewData = { transcript: [] };

    // 紀錄對話的輔助函式
    const addLog = (role, text, type = "speech") => {
        if (!text || text.trim().length === 0) return;
        interviewData.transcript.push({
            timestamp: new Date().toISOString(),
            role: role,     // ai, user
            type: type,     // speech, thought
            content: text
        });
    };

    // --- 核心：寫入資料庫 (只存入 transcripts) ---
    const saveToDatabase = async () => {
        try {
            console.log('⏳ 正在整合對話紀錄並上傳至 transcripts 表...');

            // 1. 防呆：檢查是否有 Session ID
            if (!currentSessionId) {
                console.warn('⚠️ 警告：沒收到前端傳來的 session_id，無法寫入資料庫！');
                throw new Error("Missing session_id from frontend");
            }

            // 2. 過濾 AI 內心戲，並將對話整合成一個大字串 (同學要的大檔案格式)
            const fullConversationLog = interviewData.transcript
                .filter(item => item.type === "speech") // 排除 AI 內心筆記
                .map(item => {
                    const speakerLabel = item.role === 'ai' ? 'AI 面試官' : '應徵者';
                    return `[${new Date(item.timestamp).toLocaleTimeString()}] ${speakerLabel}：${item.content}`;
                })
                .join('\n\n');

            if (!fullConversationLog) {
                console.log('沒有有效的對話內容，跳過存檔。');
                return;
            }

            // 3. 直接寫入一筆資料到 transcripts 表
            const { error: transErr } = await supabase
                .from('transcripts')
                .insert([{
                    session_id: currentSessionId, // 使用前端傳來的 ID
                    speaker: 'FULL_CONVERSATION', // 標註這是完整對話紀錄
                    text_content: fullConversationLog,
                    created_at: new Date().toISOString()
                }]);

            if (transErr) throw transErr;
            console.log(`✅ 成功！已將整場對話存入 session: ${currentSessionId}`);

        } catch (err) {
            console.error('❌ 資料庫寫入失敗:', err.message);
            // 失敗時存成本地 JSON 備份，確保心血不會白費
            const backupPath = path.join(logDir, `backup_${timestamp}.json`);
            fs.writeFileSync(backupPath, JSON.stringify(interviewData, null, 2));
            console.log(`💾 已建立本地備份檔案: ${backupPath}`);
        }
    };

    const geminiWs = new WebSocket(GEMINI_WS_URL);

    geminiWs.on('open', () => {
        const setupMessage = {
            setup: {
                model: MODEL_NAME,
                systemInstruction: {
                    parts: [{ text: "你是一個專業的台灣面試官。請用繁體中文。請根據回答進行追問。" }]
                },
                generationConfig: {
                    responseModalities: ["AUDIO"],
                    thinking_config: { thinking_level: "low", include_thoughts: true }
                },
                realtime_input_config: {
                    automatic_activity_detection: { silence_duration_ms: 1200 }
                },
                input_audio_transcription: {},
                output_audio_transcription: {}
            }
        };
        geminiWs.send(JSON.stringify(setupMessage));
    });

    geminiWs.on('message', (data) => {
        const response = JSON.parse(data.toString());
        clientWs.send(data.toString());

        if (response.setupComplete) {
            geminiWs.send(JSON.stringify({ realtimeInput: { text: "你好，我準備好了，請開始面試。" } }));
        }

        if (response.serverContent?.modelTurn?.parts) {
            response.serverContent.modelTurn.parts.forEach(part => {
                if (part.thought) addLog("ai", part.text, "thought");
            });
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

    // --- 關鍵修改：處理前端傳來的 Session ID ---
    clientWs.on('message', (msg) => {
        try {
            const parsedMsg = JSON.parse(msg.toString());
            // 攔截來自前端的 session_id 設定訊息
            if (parsedMsg.customType === 'set_session_id') {
                currentSessionId = parsedMsg.sessionId;
                console.log(`🔗 已掛載前端傳來的 Session ID: ${currentSessionId}`);
                return; // 不轉發給 Gemini
            }
        } catch (e) {
            // 非 JSON 格式則視為語音數據，繼續執行
        }

        if (geminiWs.readyState === WebSocket.OPEN) {
            geminiWs.send(msg.toString());
        }
    });

    clientWs.on('close', async () => {
        if (aiFlushTimeout) clearTimeout(aiFlushTimeout);
        console.log('🔴 [前端] 已斷線，啟動資料庫存檔流程...');
        await saveToDatabase();
        geminiWs.close();
    });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`🚀 伺服器啟動: http://localhost:${PORT}`));