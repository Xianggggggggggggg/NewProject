const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const supabase = require('../utils/supabase');
const OpenCC = require('opencc-js');
const convert = OpenCC.Converter({ from: 'cn', to: 'tw' });

const MODEL_NAME = "models/gemini-3.1-flash-live-preview";
const GEMINI_WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;

function setupWebSocket(server) {
    const wss = new WebSocket.Server({ server });

    const logDir = path.join(__dirname, '../interviews');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);

    wss.on('connection', (clientWs) => {
        console.log('\n🟢 [前端] 已連線');

        let currentSessionId = null;
        let interviewData = { transcript: [] };

        // 🌟 終極機制：唯一的發言權杖
        let currentInterviewer = 'HR'; // 'HR' 或 'MANAGER'
        let hrWs = null;
        let managerWs = null;

        let hrSpeechBuffer = "";
        let managerSpeechBuffer = "";
        let hrFlushTimeout = null;
        let managerFlushTimeout = null;

        const addLog = (role, text, type = "speech") => {
            if (!text || text.trim().length === 0) return;
            interviewData.transcript.push({
                timestamp: new Date().toISOString(),
                role: role,
                type: type,
                content: text
            });
        };

        const saveToDatabase = async () => {
            try {
                if (!currentSessionId) return;
                const fullConversationLog = interviewData.transcript
                    .filter(item => item.type === "speech")
                    .map(item => {
                        let speakerName = '應徵者';
                        if (item.role === 'ai_HR') speakerName = 'HR 面試官';
                        if (item.role === 'ai_MANAGER') speakerName = '部門主管';
                        return `${speakerName}：${item.content}`;
                    })
                    .join('\n\n');

                if (!fullConversationLog) return;

                const { error } = await supabase.from('transcripts').insert([{
                    session_id: currentSessionId,
                    speaker: 'FULL_CONVERSATION',
                    text_content: fullConversationLog,
                    created_at: new Date().toISOString()
                }]);
                if (error) throw error;
                console.log(`✅ 對話已存入 session: ${currentSessionId}`);
            } catch (err) { console.error('❌ 寫入失敗:', err.message); }
        };

        const startGeminiConnections = (resumeText, position, interview_type) => {
            // ==========================================
            // 👩‍💼 人資 (HR) 提示詞設定
            // ==========================================
            const hrPrompt = `
                你現在正與「部門主管」共同面試一位應徵「${position}」的候選人。
                
                【人格設定】：
                你是資深 HR 面試官。語氣專業、親切。
                
                【核心任務】：
                1. 負責面試開場，熱情地歡迎應徵者，並請他先簡單自我介紹。
                2. 針對履歷與自我介紹，提出 1 到 2 個「行為面試問題」（例如：團隊合作、壓力處理）。
                3. 你的對話對象「只有」應徵者，絕對不要與部門主管對話。
                
                【交接規則 (Baton Pass) - 🚨極度重要🚨】：
                1. 絕對不可以在「你提出問題」的同一次發言中交棒！你必須等應徵者「回答完」你的問題後，在下一次發言才能交棒。
                2. 準備交棒時，你的發言只能是一句純粹的過場陳述句，絕對不可包含任何問號。
                3. 請使用這句標準台詞交棒：「了解，謝謝你的分享。接下來的技術與專業問題，我想交給部門主管來瞭解。」（你的發言必須同時包含「交給」與「主管」兩個詞）。
                
                【🚨 系統強制限制】：
                絕對不要輸出任何「動作描述」！禁止輸出如「(點頭)」、「(保持沉默)」等字眼。如果還沒輪到你說話，請保持「零輸出」。
                
                應徵者履歷資料：
                ${resumeText}
            `;

            // ==========================================
            // 👨‍💻 部門主管 提示詞設定
            // ==========================================
            const managerPrompt = `
                你現在正與「HR(人資)」共同面試一位應徵「${position}」的候選人。面試類型為：${interview_type}。
                
                【人格設定】：
                你是的部門技術主管。語氣嚴謹、實事求是、直指核心。
                
                【核心任務】：
                1. 系統一開始不會給你聲音。當你收到「HR 已經交棒給你」的系統指令時，請立刻用語音開口。
                2. 針對應徵者的專題或履歷，提出專業技術問題。
                3. 每次發言【一次只能問一個問題】！絕對不可以一次丟出兩個以上的問號。
                4. 問完一個問題後，必須立刻閉嘴，等待應徵者回答。等他回答完，你再根據他的回答追問下一個問題。
                5. 你的對話對象「只有」應徵者，絕對不要與 HR 對話。   

                【交接規則 (Baton Pass)】：
                當你覺得技術能力評估完畢，請將主導權還給 HR 做結尾。
                請自然地對應徵者說出：「我的部分問完了，交還給人資。」（你的發言必須包含「交還」與「人資」兩個詞）。
                
                【🚨 系統強制限制】：
                絕對不要輸出任何「動作描述」！禁止輸出如「(保持沉默)」、「(專注聆聽)」等字眼。在系統叫你講話之前，你必須保持「零輸出」。
                
                應徵者履歷資料：
                ${resumeText}
            `;

            // --- 建立 HR AI ---
            hrWs = new WebSocket(GEMINI_WS_URL);
            hrWs.on('open', () => {
                hrWs.send(JSON.stringify({
                    setup: {
                        model: MODEL_NAME,
                        systemInstruction: { parts: [{ text: hrPrompt }] },
                        generationConfig: {
                            responseModalities: ["AUDIO"],
                            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } }
                        },
                        // 👇 加上這段：設定 AI 等待時間為 3000 毫秒 (3 秒)
                        realtime_input_config: {
                            automatic_activity_detection: { silence_duration_ms: 3000 }
                        }
                    }
                }));
            });

            // --- 建立 主管 AI ---
            managerWs = new WebSocket(GEMINI_WS_URL);
            managerWs.on('open', () => {
                managerWs.send(JSON.stringify({
                    setup: {
                        model: MODEL_NAME,
                        systemInstruction: { parts: [{ text: managerPrompt }] },
                        generationConfig: {
                            responseModalities: ["AUDIO"],
                            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } }
                        },
                        // 👇 同樣加上這段：讓主管也學會耐心等待 3 秒
                        realtime_input_config: {
                            automatic_activity_detection: { silence_duration_ms: 3000 }
                        }
                    }
                }));
            });

            // --- 處理 AI 回應的共用函數 ---
            const handleAiResponse = (role, data) => {
                const response = JSON.parse(data.toString());

                // 1. 開場白
                if (response.setupComplete && role === 'HR') {
                    clientWs.send(JSON.stringify({ setupComplete: true }));
                    hrWs.send(JSON.stringify({ realtimeInput: { text: "你好，我們是今天的面試官。我是人資，準備好的話請先簡單自我介紹一下。" } }));
                }

                // 2. 只有當前擁有權杖的人，聲音才能送給前端
                if (response.serverContent?.modelTurn?.parts && currentInterviewer === role) {
                    clientWs.send(data.toString());
                }

                // 3. 文字轉錄與交接邏輯
                if (response.serverContent?.outputTranscription) {
                    if (role === 'HR') hrSpeechBuffer += response.serverContent.outputTranscription.text;
                    else managerSpeechBuffer += response.serverContent.outputTranscription.text;

                    const currentTimeout = role === 'HR' ? hrFlushTimeout : managerFlushTimeout;
                    if (currentTimeout) clearTimeout(currentTimeout);

                    const newTimeout = setTimeout(() => {
                        const bufferText = role === 'HR' ? hrSpeechBuffer : managerSpeechBuffer;
                        const finalSentence = convert(bufferText.trim()).replace(/\s+/g, '');

                        if (finalSentence) {
                            // 🌟 強化版：攔截內心戲與舞台指示
                            const isStageDirection =
                                /^[（\(【\[].*[）\)】\]]$/.test(finalSentence) ||
                                finalSentence.includes("沉默") ||
                                finalSentence.includes("聆聽") ||
                                finalSentence.includes("我會保持") ||
                                finalSentence.includes("專注");

                            if (isStageDirection) {
                                console.log(`🛡️ [系統攔截] 成功阻擋 ${role} 的內心獨白: ${finalSentence}`);
                            } else {
                                addLog(`ai_${role}`, finalSentence, "speech");

                                // 傳給前端顯示對話泡泡
                                if (currentInterviewer === role) {
                                    clientWs.send(JSON.stringify({
                                        customType: 'ai_transcript_final',
                                        ai_role: role,
                                        text: finalSentence
                                    }));
                                }

                                // 🔄 🌟 核心交棒邏輯 (Baton Pass) 🌟 🔄

                                // 判斷條件：只要句子裡「同時」包含這兩個關鍵字，就算觸發
                                const isHandoverToManager = finalSentence.includes('交給') && finalSentence.includes('主管');
                                const isHandoverToHR = (finalSentence.includes('交還') || finalSentence.includes('交給')) && finalSentence.includes('人資');

                                if (role === 'HR' && currentInterviewer === 'HR' && isHandoverToManager) {
                                    console.log('🔄 [權限切換] 麥克風已交給：部門主管');
                                    currentInterviewer = 'MANAGER';

                                    // 打包前面的對話紀錄傳給沉睡中的主管，喚醒他
                                    const history = interviewData.transcript.map(t => {
                                        let speaker = '應徵者';
                                        if (t.role === 'ai_HR') speaker = 'HR 面試官';
                                        if (t.role === 'ai_MANAGER') speaker = '部門主管';
                                        return `${speaker}: ${t.content}`;
                                    }).join('\n');

                                    const promptToManager = `[系統強制指令] HR 已經結束提問並交棒給你。以下是你旁聽到的前半段紀錄：\n\n${history}\n\n請根據以上對話，立刻開口對應徵者提出你的第一個專業技術問題！`;

                                    if (managerWs && managerWs.readyState === WebSocket.OPEN) {
                                        managerWs.send(JSON.stringify({ realtimeInput: { text: promptToManager } }));
                                    }
                                }
                                else if (role === 'MANAGER' && currentInterviewer === 'MANAGER' && isHandoverToHR) {
                                    console.log('🔄 [權限切換] 麥克風已交回：人資');
                                    currentInterviewer = 'HR';

                                    const history = interviewData.transcript.map(t => {
                                        let speaker = '應徵者';
                                        if (t.role === 'ai_HR') speaker = 'HR 面試官';
                                        if (t.role === 'ai_MANAGER') speaker = '部門主管';
                                        return `${speaker}: ${t.content}`;
                                    }).join('\n');

                                    const promptToHR = `[系統強制指令] 部門主管已將時間交還給你。以下是剛剛主管與應徵者的對話：\n\n${history}\n\n請你接著做面試的收尾與感謝結語。`;

                                    if (hrWs && hrWs.readyState === WebSocket.OPEN) {
                                        hrWs.send(JSON.stringify({ realtimeInput: { text: promptToHR } }));
                                    }
                                }
                            }
                        }
                        if (role === 'HR') hrSpeechBuffer = ""; else managerSpeechBuffer = "";
                    }, 1000);

                    if (role === 'HR') hrFlushTimeout = newTimeout; else managerFlushTimeout = newTimeout;
                }

                // 4. 記錄應徵者語音
                if (response.serverContent?.inputTranscription && currentInterviewer === role) {
                    let userText = convert(response.serverContent.inputTranscription.text).replace(/\s+/g, '');
                    userText = userText.replace(/^[,，]+/, '').replace(/[,，]{2,}/g, '，');
                    addLog("user", userText, "speech");
                    clientWs.send(JSON.stringify({ customType: 'user_transcript', text: userText }));
                }
            };

            hrWs.on('message', (data) => handleAiResponse('HR', data));
            managerWs.on('message', (data) => handleAiResponse('MANAGER', data));
        };

        clientWs.on('message', async (msg) => {
            try {
                const parsedMsg = JSON.parse(msg.toString());

                if (parsedMsg.customType === 'init_interview') {
                    currentSessionId = parsedMsg.sessionId;
                    const { resumeId, position, interview_type } = parsedMsg;

                    await supabase.from('interview_sessions').update({ applied_position: position, interview_type: interview_type, resume_id: resumeId }).eq('session_id', currentSessionId);

                    let resumeText = "無資料";
                    const { data } = await supabase.from('resumes').select('*').eq('resume_id', resumeId).single();
                    if (data) resumeText = `學歷：${data.education}\n經歷：${data.work_experience}`;

                    startGeminiConnections(resumeText, position, interview_type);
                    return;
                }

                // 🎤 🌟 物理硬體路由：應徵者的麥克風聲音「只會」傳給當前持有權杖的面試官
                if (parsedMsg.realtimeInput) {
                    if (currentInterviewer === 'HR' && hrWs && hrWs.readyState === WebSocket.OPEN) {
                        hrWs.send(msg.toString());
                    } else if (currentInterviewer === 'MANAGER' && managerWs && managerWs.readyState === WebSocket.OPEN) {
                        managerWs.send(msg.toString());
                    }
                }
            } catch (e) { }
        });

        clientWs.on('close', async () => {
            if (hrFlushTimeout) clearTimeout(hrFlushTimeout);
            if (managerFlushTimeout) clearTimeout(managerFlushTimeout);
            console.log('🔴 [前端] 已斷線，啟動存檔...');
            await saveToDatabase();
            if (hrWs) hrWs.close();
            if (managerWs) managerWs.close();
        });
    });
}

module.exports = setupWebSocket;