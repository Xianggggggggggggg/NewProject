const express = require('express');
const http = require('http');
const WebSocket = require('ws');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));

const MODEL_NAME = "models/gemini-3.1-flash-live-preview";
const GEMINI_WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;

wss.on('connection', (clientWs) => {
    console.log('\n🟢 [前端] 已連線');

    const geminiWs = new WebSocket(GEMINI_WS_URL);

    geminiWs.on('open', () => {
        console.log('🟢 [Gemini] 成功建立 WebSocket 連線');

        // 傳送設定檔
        const setupMessage = {
            setup: {
                model: MODEL_NAME,
                systemInstruction: {
                    parts: [{ text: "你是一個專業的技術面試官。請用簡短、口語的繁體中文與應徵者對話。" }]
                },
                generationConfig: {
                    // 🔥 關鍵修改：要求 AI「同時」回傳文字與語音
                    responseModalities: ["TEXT", "AUDIO"]
                }
            }
        };
        geminiWs.send(JSON.stringify(setupMessage));
    });

    geminiWs.on('message', (data) => {
        const responseStr = data.toString();
        const response = JSON.parse(responseStr);

        if (response.setupComplete) {
            console.log('✅ [Gemini] 設定完成 (SetupComplete)，可以開始說話了！');
        } else if (response.serverContent) {
            console.log('🔵 [Gemini] 收到 AI 回應 (ServerContent)');
        } else if (response.error) {
            console.error('❌ [Gemini] API 發生錯誤:', response.error);
        }

        // 轉發給前端
        clientWs.send(responseStr);
    });

    clientWs.on('message', (message) => {
        if (geminiWs.readyState === WebSocket.OPEN) {
            geminiWs.send(message.toString());
        }
    });

    clientWs.on('close', () => {
        console.log('🔴 [前端] 已斷線');
        geminiWs.close();
    });

    geminiWs.on('close', (code, reason) => {
        console.log(`🔴 [Gemini] 連線關閉 - Code: ${code}, 理由: ${reason.toString() || '正常關閉'}`);
    });

    geminiWs.on('error', (err) => console.error('❌ [Gemini] WebSocket 發生錯誤:', err));
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`🚀 測試伺服器已啟動: http://localhost:${PORT}`);
});