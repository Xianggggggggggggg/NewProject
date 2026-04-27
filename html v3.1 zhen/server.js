const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// 引入繁簡轉換工具
const OpenCC = require('opencc-js');
const convert = OpenCC.Converter({ from: 'cn', to: 'tw' });

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));

const MODEL_NAME = "models/gemini-3.1-flash-live-preview";
const GEMINI_WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;

const logDir = path.join(__dirname, 'interviews');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

wss.on('connection', (clientWs) => {
    console.log('\n🟢 [前端] 已連線');

    let aiSpeechBuffer = "";
    let aiFlushTimeout = null; // 防碎裂的計時器

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFilePath = path.join(logDir, `transcript_${timestamp}.txt`);
    fs.writeFileSync(logFilePath, `=== AI 面試紀錄 (${new Date().toLocaleString()}) ===\n\n`);

    const geminiWs = new WebSocket(GEMINI_WS_URL);

    geminiWs.on('open', () => {
        console.log('🟢 [Gemini] 建立連線');
        const setupMessage = {
            setup: {
                model: MODEL_NAME,
                systemInstruction: {
                    parts: [{
                        text: `你是一個專業的台灣面試官。
                        1. 所有的輸出與對應理解必須使用「繁體中文」(Traditional Chinese, zh-TW)。
                        2. 嚴禁使用簡體字。
                        3. 說話語氣要自然，像在台灣職場對話一樣。
                        4. 當應徵者回答太隨便時，請專業地引導回面試主題。`
                    }]
                },
                generationConfig: {
                    responseModalities: ["AUDIO"],
                    thinking_config: {
                        thinking_level: "low",
                        include_thoughts: true
                    }
                },
                realtime_input_config: {
                    automatic_activity_detection: {
                        start_of_speech_sensitivity: "START_SENSITIVITY_HIGH",
                        silence_duration_ms: 1200,
                    }
                },
                input_audio_transcription: {},
                output_audio_transcription: {}
            }
        };
        geminiWs.send(JSON.stringify(setupMessage));
    });

    geminiWs.on('message', (data) => {
        const responseStr = data.toString();
        const response = JSON.parse(responseStr);

        // 1. 第一時間轉發音訊，讓聲音不卡頓
        clientWs.send(responseStr);

        // 2. 🌟 關鍵修正：連線完成後，主動發送文字請 AI 開口
        if (response.setupComplete) {
            console.log('✅ [Gemini] 設定完成，引導 AI 開始提問');
            geminiWs.send(JSON.stringify({
                realtimeInput: {
                    text: "你好，我已經準備好面試了，請直接開始並向我提問第一題。"
                }
            }));
        }

        // 3. 處理 AI 的思考過程
        if (response.serverContent?.modelTurn?.parts) {
            response.serverContent.modelTurn.parts.forEach(part => {
                if (part.thought) {
                    fs.appendFileSync(logFilePath, `[AI 內心筆記]: ${part.text}\n`);
                }
            });
        }

        // 4. 處理應徵者的說話文字 (強制轉繁體 + 去除空格)
        if (response.serverContent?.inputTranscription) {
            const rawUserText = response.serverContent.inputTranscription.text;
            const userText = convert(rawUserText).replace(/\s+/g, '');

            console.log("👤 應徵者:", userText);
            fs.appendFileSync(logFilePath, `[應徵者]: ${userText}\n`);
            clientWs.send(JSON.stringify({ customType: 'user_transcript', text: userText }));
        }

        // 5. 處理 AI 逐字稿 (加入防碎裂緩衝機制)
        if (response.serverContent?.outputTranscription) {
            const aiPartText = response.serverContent.outputTranscription.text;
            aiSpeechBuffer += aiPartText;

            if (aiFlushTimeout) clearTimeout(aiFlushTimeout);

            aiFlushTimeout = setTimeout(() => {
                const finalSentence = convert(aiSpeechBuffer.trim()).replace(/\s+/g, '');

                if (finalSentence) {
                    console.log("🎙️ AI 面試官:", finalSentence);
                    fs.appendFileSync(logFilePath, `[AI面試官]: ${finalSentence}\n\n`);
                    clientWs.send(JSON.stringify({
                        customType: 'ai_transcript_final',
                        text: finalSentence
                    }));
                }
                aiSpeechBuffer = "";
            }, 800);
        }
    });

    clientWs.on('message', (message) => {
        if (geminiWs.readyState === WebSocket.OPEN) {
            geminiWs.send(message.toString());
        }
    });

    clientWs.on('close', () => {
        if (aiFlushTimeout) clearTimeout(aiFlushTimeout);
        console.log('🔴 [前端] 已斷線');
        geminiWs.close();
    });

    geminiWs.on('close', (code, reason) => {
        console.log(`🔴 [Gemini] 關閉 - ${reason}`);
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`🚀 伺服器啟動: http://localhost:${PORT}`);
});