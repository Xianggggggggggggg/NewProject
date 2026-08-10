const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const supabase = require('../utils/supabase');
const OpenCC = require('opencc-js');
const convert = OpenCC.Converter({ from: 'cn', to: 'tw' });

const MODEL_NAME = "models/gemini-3.1-flash-live-preview";
const GEMINI_WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;

// 🌟 記憶體中管理所有房間的成員與狀態
const groupRooms = new Map();

function setupGroupWebSocket(options) {
    const wss = new WebSocket.Server(options);

    const logDir = path.join(__dirname, '../interviews');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);

    wss.on('connection', (clientWs) => {
        console.log('\n🟢 [前端] 已連線 (多人 AI 面試官 websocket)');

        let currentSessionId = null;
        let interviewData = { transcript: [] };

        // 🌟 核心控制變數
        let currentInterviewer = 'HR';
        let isInterviewEnded = false;
        let isAiSpeaking = false;
        let previousInterviewer = 'HR';
        let isHumanPresent = false;

        let hrWs = null;
        let managerWs = null;

        let hrSpeechBuffer = "";
        let managerSpeechBuffer = "";
        let hrFlushTimeout = null;
        let managerFlushTimeout = null;

        // 🎯 多人面試題數與輪流狀態
        let hrRoundCount = 0;          // HR 已完成幾輪問題 (每輪包含所有人)
        let managerRoundCount = 0;     // 主管已完成幾輪問題
        let hrTargetRounds = 2;        // HR 預計問幾輪 (每人皆答)
        let managerTargetRounds = 3;   // 主管預計問幾輪 (每人皆答)

        let isHRWrappingUp = false;
        let isManagerWrappingUp = false;
        let isFinalStage = false;
        let hrPendingAction = null;

        // 🛠️ 工具宣告
        const hrTools = [{
            functionDeclarations: [{
                name: "handover_to_manager",
                description: "當你完成人資的多人面試開場與行為提問，準備將面試交接給部門主管進行技術面試時，呼叫此函式。"
            }]
        }];

        const managerTools = [{
            functionDeclarations: [{
                name: "handover_to_hr",
                description: "當你的技術問題問完，準備將面試交還給人資來做結語時，呼叫此函式。"
            }]
        }];

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

                const { error: updateErr } = await supabase.from('interview_sessions')
                    .update({ status: '已結束', end_time: new Date().toISOString() })
                    .eq('session_id', currentSessionId);
                if (updateErr) throw updateErr;

                const fullConversationLog = interviewData.transcript
                    .filter(item => item.type === "speech")
                    .map(item => {
                        let speakerName = '應徵者';
                        if (item.role === 'ai_HR') speakerName = 'HR 面試官';
                        if (item.role === 'ai_MANAGER') speakerName = '部門主管';
                        if (item.role === 'human_HR') speakerName = '真人 HR';
                        return `${speakerName}：${item.content}`;
                    })
                    .join('\n\n');

                if (!fullConversationLog) return;

                const { error: insertErr } = await supabase.from('transcripts')
                    .insert([{ session_id: currentSessionId, speaker: 'FULL_CONVERSATION', text_content: fullConversationLog, created_at: new Date().toISOString() }]);
                if (insertErr) throw insertErr;

                console.log(`✅ 多人面試已完美存檔 (Session: ${currentSessionId})`);
            } catch (err) { console.error('❌ 寫入資料庫失敗:', err.message); }
        };

        // 🌟 多人 Prompt 設定與 Gemini 啟動
        const startGroupGeminiConnections = (candidatesInfoText, candidatesList, position, interview_type, jobDetailsText, companyContext) => {

            const candidatesNamesStr = candidatesList.map(c => c.name).join('、');

            const hrPrompt = `
                你現在正進行一場【多人團體面試】，應徵職缺為「${position}」。
                本次面試的應徵者共有以下成員：${candidatesNamesStr}。
                
                【企業背景設定】：
                ${companyContext}

                【人格設定】：你是資深 HR 面試官。語氣專業、親切、控場能力強。
                
                【核心任務與多人規則 (極度重要)】：
                1. 負責團體面試開場，熱情歡迎大家。
                2. 🌟 **必須點名**：因為是多人面試，你每次提問【務必明確指定一位應徵者的名字】（例如：「請張小明先進行自我介紹」、「接下來想請李美麗回答...」）。
                3. 開場的自我介紹階段，你必須【讓每位應徵者都依序進行自我介紹】後，才能進入下一個問題。
                4. 針對履歷與回答追問團隊合作、職涯動機或文化適應。
                5. 每次發言【只能問一個問題】且【只能指定一個人回答】！
                6. 你的對話對象只有現場的應徵者們，絕對不要與部門主管對話。

                【對話節奏控制】：
                - 如果被點名的應徵者回答簡短或需要準備，請友善鼓勵：「沒問題，準備好隨時可以開始喔！」
                - 若明確表示不知道，自然切換或邀請下一位：「沒關係，那我們聽聽看其他人的想法...」

                【交接規則】：
                - 在尚未收到系統交接指令前，請持續點名提問。收到指令後，做簡短回饋並做過場交接。
                - 絕對不要輸出任何「動作描述」（如 (點頭)）。

                【所有應徵者履歷資訊】：
                ${candidatesInfoText}

                【本職缺詳細需求】：
                ${jobDetailsText}
            `;

            const managerPrompt = `
                你現在正進行一場【多人團體面試】，應徵職缺為「${position}」，面試類型：${interview_type}。
                本次面試的應徵者共有以下成員：${candidatesNamesStr}。
                
                【企業背景設定】：
                ${companyContext}

                【人格設定】：你是部門技術主管。語氣嚴謹、實事求是。
                
                【核心任務與多人規則 (極度重要)】：
                1. 當收到「HR 已經交棒給你」的系統指令時，立刻用語音開口。
                2. 🌟 **必須點名**：針對【本職缺需求】與【應徵者履歷】，提問專業技術問題。每次提問【務必明確指定一位應徵者的名字】。
                3. 確保問題公平分派給不同的應徵者，測試大家的技術實力與解決問題思路。
                4. 每次發言【一次只能問一個問題】且【只能指定一個人回答】！
                5. 絕對不要與 HR 對話。

                【交接規則】：
                - 未收到交接指令前持續點名提問。收到指令後不提問，做簡短總結並交還 HR。
                - 絕對不要輸出任何「動作描述」。

                【所有應徵者履歷資訊】：
                ${candidatesInfoText}

                【本職缺詳細需求】：
                ${jobDetailsText}
            `;

            hrWs = new WebSocket(GEMINI_WS_URL);
            hrWs.on('open', () => {
                hrWs.send(JSON.stringify({
                    setup: {
                        model: MODEL_NAME,
                        systemInstruction: { parts: [{ text: hrPrompt }] },
                        tools: hrTools,
                        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } } },
                        realtime_input_config: { automatic_activity_detection: { silence_duration_ms: 3000 } }
                    }
                }));
            });

            managerWs = new WebSocket(GEMINI_WS_URL);
            managerWs.on('open', () => {
                managerWs.send(JSON.stringify({
                    setup: {
                        model: MODEL_NAME,
                        systemInstruction: { parts: [{ text: managerPrompt }] },
                        tools: managerTools,
                        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Enceladus" } } } },
                        realtime_input_config: { automatic_activity_detection: { silence_duration_ms: 3000 } }
                    }
                }));
            });

            const handleAiResponse = (role, data) => {
                const response = JSON.parse(data.toString());

                if (response.serverContent?.modelTurn?.parts) {
                    const parts = response.serverContent.modelTurn.parts;
                    const functionCallPart = parts.find(p => p.functionCall);
                    if (functionCallPart) {
                        const toolResponseMsg = JSON.stringify({
                            toolResponse: {
                                functionResponses: [{
                                    id: functionCallPart.functionCall.id || "",
                                    name: functionCallPart.functionCall.name,
                                    response: { result: "success", status: "ok" }
                                }]
                            }
                        });
                        if (role === 'HR') hrWs.send(toolResponseMsg);
                        else managerWs.send(toolResponseMsg);
                    }
                }

                if (isInterviewEnded) return;

                if (response.setupComplete && role === 'HR') {
                    clientWs.send(JSON.stringify({ setupComplete: true }));
                    isAiSpeaking = true;
                    // 開場廣播：要求點名第一個應徵者自我介紹
                    const firstName = candidatesList[0]?.name || "第一位應徵者";
                    hrWs.send(JSON.stringify({
                        realtimeInput: { text: `[系統指令] 多人面試正式開始。請你用語音進行熱情開場，歡迎所有人（${candidatesNamesStr}），並請第一位應徵者「${firstName}」先開始自我介紹。` }
                    }));
                }

                if (response.serverContent?.modelTurn?.parts && currentInterviewer === role) {
                    isAiSpeaking = true;
                    const audioData = JSON.parse(data.toString());
                    audioData.ai_role = role;

                    // 廣播給同房間內的所有求職者與戰情室
                    const audioMsg = JSON.stringify(audioData);
                    wss.clients.forEach(c => {
                        if (c.readyState === WebSocket.OPEN && c.sessionId === currentSessionId) {
                            c.send(audioMsg);
                        }
                    });
                }

                if (response.serverContent?.turnComplete) {
                    isAiSpeaking = false;

                    if (role === 'HR' && currentInterviewer === 'HR' && isFinalStage) {
                        if (hrPendingAction === 'HANDOVER_TO_HUMAN') {
                            console.log('👥 [多人流程] AI HR 移交控制權給真人！');
                            currentInterviewer = 'HUMAN_INTERVENING';
                            clientWs.send(JSON.stringify({ customType: 'ai_finished_handover_to_human' }));
                            hrPendingAction = null;
                        } else if (hrPendingAction === 'FORCE_END') {
                            console.log('🏁 [多人流程] AI HR 正式宣告面試結束！');
                            isInterviewEnded = true;
                            clientWs.send(JSON.stringify({ customType: 'force_end_interview' }));
                            hrPendingAction = null;
                        }
                    }
                }

                if (response.serverContent?.outputTranscription) {
                    if (role === 'HR') hrSpeechBuffer += response.serverContent.outputTranscription.text;
                    else managerSpeechBuffer += response.serverContent.outputTranscription.text;

                    const currentTimeout = role === 'HR' ? hrFlushTimeout : managerFlushTimeout;
                    if (currentTimeout) clearTimeout(currentTimeout);

                    const newTimeout = setTimeout(() => {
                        const bufferText = role === 'HR' ? hrSpeechBuffer : managerSpeechBuffer;
                        const finalSentence = convert(bufferText.trim()).replace(/\s+/g, '');

                        if (finalSentence) {
                            const isStageDirection = /^[（\(【\[].*[）\)】\]]$/.test(finalSentence);
                            if (!isStageDirection) {
                                addLog(`ai_${role}`, finalSentence, "speech");
                                if (currentInterviewer === role) {
                                    const aiMsg = JSON.stringify({ customType: 'ai_transcript_final', ai_role: role, text: finalSentence });
                                    wss.clients.forEach(c => {
                                        if (c.readyState === WebSocket.OPEN && c.sessionId === currentSessionId) c.send(aiMsg);
                                    });
                                }

                                const isRealQuestion = (finalSentence.includes('？') || finalSentence.includes('?')) && finalSentence.length > 10;

                                if (role === 'HR' && currentInterviewer === 'HR' && !isHRWrappingUp && !isInterviewEnded && isRealQuestion) {
                                    hrRoundCount++;
                                    console.log(`📊 [多人狀態機] HR 完成第 ${hrRoundCount} 次提問`);
                                }
                                if (role === 'MANAGER' && currentInterviewer === 'MANAGER' && !isManagerWrappingUp && isRealQuestion) {
                                    managerRoundCount++;
                                    console.log(`📊 [多人狀態機] 主管完成第 ${managerRoundCount} 次提問`);
                                }

                                // 🔄 HR 交棒主管
                                if (role === 'HR' && isHRWrappingUp && currentInterviewer === 'HR') {
                                    if (finalSentence.includes('部門主管') || finalSentence.includes('交給')) {
                                        console.log('🔄 [多人權限切換] HR 唸出交接台詞，準備交接給部門主管');
                                        currentInterviewer = 'HANDOVER';
                                        isHRWrappingUp = false;
                                        setTimeout(() => {
                                            currentInterviewer = 'MANAGER';
                                            const firstName = candidatesList[0]?.name || "第一位應徵者";
                                            if (managerWs && managerWs.readyState === WebSocket.OPEN) {
                                                managerWs.send(JSON.stringify({
                                                    realtimeInput: { text: `[系統指令] HR 已交棒給你。請立刻開口歡迎大家，並點名「${firstName}」提出第一個技術問題。` }
                                                }));
                                            }
                                        }, 3000);
                                    }
                                }

                                // 🔄 主管交還 HR
                                if (role === 'MANAGER' && isManagerWrappingUp && currentInterviewer === 'MANAGER') {
                                    if (finalSentence.includes('交還') || finalSentence.includes('人資')) {
                                        if (currentInterviewer === 'HANDOVER') return;
                                        console.log('🔄 [多人權限切換] 主管交還給 HR');
                                        currentInterviewer = 'HANDOVER';
                                        isManagerWrappingUp = false;
                                        setTimeout(() => {
                                            currentInterviewer = 'HR';
                                            isFinalStage = true;

                                            if (hrWs && hrWs.readyState === WebSocket.OPEN) {
                                                let hrEndingPrompt = isHumanPresent
                                                    ? `[系統指令] 部門主管已交還給你。因為稍後有真人面試官接手，請你直接做團體面試過場結語，說明：「感謝各位應徵者與部門主管，接下來將由線上真人面試官與大家交流，請大家稍等一下喔。」絕對不可再問問題。`
                                                    : `[系統指令] 部門主管已交還給你。請做團體面試結語，包含：「今天的團體面試就到這邊結束，請大家按下結束面試按鈕」。絕對不可再問問題。`;
                                                hrWs.send(JSON.stringify({ realtimeInput: { text: hrEndingPrompt } }));
                                            }
                                        }, 3000);
                                    }
                                }

                                // 🏁 判定 AI 人資是否已經講完結語
                                if (role === 'HR' && currentInterviewer === 'HR' && isFinalStage) {
                                    if (isHumanPresent) {
                                        if (finalSentence.includes('真人') || finalSentence.includes('移交') || finalSentence.includes('交流')) {
                                            hrPendingAction = 'HANDOVER_TO_HUMAN';
                                        }
                                    } else {
                                        if (finalSentence.includes('結束面試按鈕')) {
                                            hrPendingAction = 'FORCE_END';
                                        }
                                    }
                                }
                            }
                        }
                        if (role === 'HR') hrSpeechBuffer = ""; else managerSpeechBuffer = "";
                    }, 2000);

                    if (role === 'HR') hrFlushTimeout = newTimeout; else managerFlushTimeout = newTimeout;
                }

                // 🌟 接收應徵者發言並進行多人點名切換邏輯
                if (response.serverContent?.inputTranscription && currentInterviewer === role) {
                    let userText = convert(response.serverContent.inputTranscription.text).replace(/\s+/g, '');
                    addLog("user", userText, "speech");

                    const userMsg = JSON.stringify({ customType: 'user_transcript', text: userText });
                    wss.clients.forEach(c => {
                        if (c.readyState === WebSocket.OPEN && c.sessionId === currentSessionId) c.send(userMsg);
                    });

                    // 檢查是否達到目標發問輪數
                    const totalRequiredHRQuestions = hrTargetRounds * candidatesList.length;
                    const totalRequiredManagerQuestions = managerTargetRounds * candidatesList.length;

                    const isTargetReached =
                        (role === 'HR' && hrRoundCount >= totalRequiredHRQuestions && !isHRWrappingUp) ||
                        (role === 'MANAGER' && managerRoundCount >= totalRequiredManagerQuestions && !isManagerWrappingUp);

                    if (isTargetReached) {
                        console.log(`🚀 [多人預先注入] 階段發問達標，啟動轉場 (${role})`);

                        if (role === 'HR') isHRWrappingUp = true;
                        else isManagerWrappingUp = true;

                        const handoverLine = role === 'HR'
                            ? "非常感謝大家的精彩分享。接下來的專業技術環節，我將交給部門主管來主持。"
                            : "謝謝各位的詳細說明。我的技術提問部分就到這裡，交還給人資。";

                        const injectionPrompt = `
                            [系統核心指令] 
                            1. 應徵者剛剛回答："${userText}"
                            2. 請簡短給予一句禮貌的總結。
                            3. 隨後【必須】直接朗讀這句台詞：「${handoverLine}」。
                            4. 執行完成後絕對禁止再點名或詢問任何新問題。
                        `;

                        const injectionMsg = {
                            clientContent: {
                                turns: [{ role: "user", parts: [{ text: injectionPrompt }] }],
                                turnComplete: true
                            }
                        };

                        if (role === 'HR') hrWs.send(JSON.stringify(injectionMsg));
                        else managerWs.send(JSON.stringify(injectionMsg));
                        return;
                    }
                }
            };

            hrWs.on('message', (data) => handleAiResponse('HR', data));
            managerWs.on('message', (data) => handleAiResponse('MANAGER', data));
        };

        clientWs.on('message', async (msg) => {
            try {
                const parsedMsg = JSON.parse(msg.toString());

                if (parsedMsg.sessionId) {
                    clientWs.sessionId = parsedMsg.sessionId;
                }
                if (parsedMsg.realtimeInput) {
                    if (currentInterviewer === 'HR' && hrWs && hrWs.readyState === WebSocket.OPEN) {
                        hrWs.send(msg.toString());
                    } else if (currentInterviewer === 'MANAGER' && managerWs && managerWs.readyState === WebSocket.OPEN) {
                        managerWs.send(msg.toString());
                    }
                    return;
                }

                // ==========================================
                // 🌟 多人 WebRTC & PeerJS 房號廣播機制
                // ==========================================
                if (parsedMsg.type === 'webrtc_offer' ||
                    parsedMsg.type === 'webrtc_answer' ||
                    parsedMsg.type === 'webrtc_ice_candidate' ||
                    parsedMsg.type === 'hr_joined_group') {

                    isHumanPresent = true;
                    console.log(`📡 [多人WebRTC] 房號 [${parsedMsg.sessionId}] 轉發訊號: ${parsedMsg.type}`);

                    wss.clients.forEach(client => {
                        if (client !== clientWs && client.readyState === WebSocket.OPEN && client.sessionId === parsedMsg.sessionId) {
                            client.send(msg.toString());
                        }
                    });
                    return;
                }

                // 多人房間成員加入
                if (parsedMsg.type === 'join_group_room') {
                    console.log(`👥 [多人模式] 成員加入房間 [${parsedMsg.sessionId}], PeerID: ${parsedMsg.peerId}`);
                    clientWs.peerId = parsedMsg.peerId;

                    wss.clients.forEach(client => {
                        if (client !== clientWs && client.readyState === WebSocket.OPEN && client.sessionId === parsedMsg.sessionId) {
                            client.send(JSON.stringify({
                                type: 'user_joined_group',
                                newPeerId: parsedMsg.peerId
                            }));
                        }
                    });
                    return;
                }

                // 戰情室控制指令
                if (parsedMsg.type === 'pause_ai') {
                    wss.clients.forEach(c => {
                        if (c.readyState === WebSocket.OPEN && c.sessionId === parsedMsg.sessionId) {
                            c.send(JSON.stringify({ customType: 'kill_ai_audio' }));
                        }
                    });
                    return;
                }

                if (parsedMsg.type === 'resume_ai') {
                    wss.clients.forEach(c => {
                        if (c.readyState === WebSocket.OPEN && c.sessionId === parsedMsg.sessionId) {
                            c.send(JSON.stringify({ customType: 'resume_ai_audio' }));
                        }
                    });
                    return;
                }

                if (parsedMsg.customType === 'execute_backend_pause') {
                    if (currentInterviewer !== 'HANDOVER' && currentInterviewer !== 'HUMAN_INTERVENING') {
                        previousInterviewer = currentInterviewer;
                    }
                    currentInterviewer = 'HUMAN_INTERVENING';
                    return;
                }

                if (parsedMsg.customType === 'execute_backend_resume') {
                    currentInterviewer = previousInterviewer;
                    const resumeMsg = JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text: `[系統指令] 真人面試官插話結束，請繼續團體面試流程，點名下一位應徵者提問。` }] }], turnComplete: true } });
                    if (currentInterviewer === 'HR' && hrWs && hrWs.readyState === WebSocket.OPEN) hrWs.send(resumeMsg);
                    if (currentInterviewer === 'MANAGER' && managerWs && managerWs.readyState === WebSocket.OPEN) managerWs.send(resumeMsg);
                    return;
                }

                if (parsedMsg.type === 'hr_human_speech') {
                    const textMsg = JSON.stringify({
                        customType: 'ai_transcript_final',
                        ai_role: '真人HR',
                        text: parsedMsg.text
                    });
                    wss.clients.forEach(c => {
                        if (c.readyState === WebSocket.OPEN && c.sessionId === parsedMsg.sessionId) c.send(textMsg);
                    });
                    addLog("human_HR", parsedMsg.text, "speech");
                    return;
                }
                // ==========================================
                // 🌟 接收應徵者在「暫停期間」講的話 (備用打字員傳來的)
                // ==========================================
                if (parsedMsg.customType === 'user_human_speech') {
                    console.log(`🎤 [應徵者插話文字] ${parsedMsg.text}`);

                    const textMsg = JSON.stringify({
                        customType: 'user_transcript', // 標記為應徵者講的話
                        text: parsedMsg.text
                    });

                    // 廣播給房間裡的所有人（包含戰情室）
                    wss.clients.forEach(c => {
                        if (c.readyState === WebSocket.OPEN && c.sessionId === parsedMsg.sessionId) {
                            c.send(textMsg);
                        }
                    });

                    // 存入對話紀錄
                    addLog("user", parsedMsg.text, "speech");
                    return;
                }

                // ==========================================
                // 🌟 初始化「多人團體面試」
                // ==========================================
                // ✅ 修改後：正確結合 applicants 資料表與動態人數
                if (parsedMsg.customType === 'init_group_interview') {
                    currentSessionId = parsedMsg.sessionId;
                    const { candidateIds, applicantIds, position, interview_type, jobId } = parsedMsg;

                    await supabase.from('interview_sessions').update({
                        applied_position: position,
                        interview_type: interview_type,
                        status: '進行中'
                    }).eq('session_id', currentSessionId);

                    // 1. 優先從 applicants 資料表抓取真實姓名 (applicants.name)
                    let candidatesList = [];
                    let candidatesInfoText = "";

                    const targetApplicantIds = applicantIds || candidateIds;

                    if (Array.isArray(targetApplicantIds) && targetApplicantIds.length > 0) {
                        // 🌟 透過 Supabase 的 JOIN，拿履歷 ID 的同時，把對應的求職者姓名抓出來！
                        const { data: resumesData, error: resumeErr } = await supabase
                            .from('resumes')
                            .select(`
                                *,
                                applicants ( name )
                            `)
                            .in('resume_id', targetApplicantIds);

                        if (resumeErr) {
                            console.error("❌ 撈取履歷發生錯誤:", resumeErr);
                        }

                        if (resumesData && resumesData.length > 0) {
                            candidatesList = resumesData.map((r, index) => ({
                                name: r.applicants?.name || `應徵者${index + 1}`,
                                id: r.applicant_id
                            }));

                            candidatesInfoText = resumesData.map((r, index) =>
                                `【應徵者 ${index + 1}】：${r.applicants?.name || '未提供姓名'}\n學歷：${r.education || '無'}\n經歷：${r.work_experience || '無'}\n`
                            ).join('\n');
                        }
                    }

                    // 如果沒有傳入任何 ID 或資料庫沒撈到，改為動態根據目前上線的真人人數或預設處理
                    if (candidatesList.length === 0) {
                        candidatesList = [{ name: "應徵者" }];
                        candidatesInfoText = "目前線上僅有一位應徵者進行面試。";
                    }

                    console.log(`👥 [多人面試初始化] 成功載入實際應徵者人數: ${candidatesList.length} 人，名單:`, candidatesList.map(c => c.name));
                    // 2. 抓取職缺資訊
                    let jobDetailsText = "無特定職缺資料";
                    if (jobId) {
                        const { data: jobData } = await supabase.from('jobs').select('job_title, job_description, requirements').eq('job_id', jobId).single();
                        if (jobData) {
                            jobDetailsText = `【工作內容】：\n${jobData.job_description}\n\n【條件要求】：\n${jobData.requirements}`;
                        }
                    }

                    // 3. 抓取公司資料
                    let companyContext = "無特定公司資料";
                    const { data: companyData } = await supabase.from('Company_Profile').select('company_name, company_info').eq('id', 1).single();
                    if (companyData) {
                        companyContext = `【公司名稱】：${companyData.company_name}\n【公司簡介】：${companyData.company_info}`;
                    }

                    // 4. 啟動多人專用 Gemini 連線
                    startGroupGeminiConnections(candidatesInfoText, candidatesList, position, interview_type, jobDetailsText, companyContext);
                }

            } catch (err) {
                console.error('❌ 解析訊息失敗:', err);
            }
        });

        clientWs.on('close', () => {
            console.log('🔴 [前端] 連線已中斷 (多人模式)');
            saveToDatabase();
            if (hrWs) hrWs.close();
            if (managerWs) managerWs.close();
        });
    });
    return wss;
}

module.exports = setupGroupWebSocket;