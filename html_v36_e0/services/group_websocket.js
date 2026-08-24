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
const activeRooms = new Map();

function setupGroupWebSocket(options) {
    const wss = new WebSocket.Server(options);

    const logDir = path.join(__dirname, '../interviews');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);

    wss.on('connection', (clientWs) => {
        console.log('\n🟢 [前端] 已連線 (多人 AI 面試官 websocket)');
        console.log("連線建立，目前有", wss.clients.size, "個客戶端連線中");

        let currentSessionId = null;

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

        const addLog = (sessionId, role, text, type = "speech") => {
            const room = activeRooms.get(sessionId);
            if (!room || !room.transcript) return;

            room.transcript.push({
                timestamp: new Date().toISOString(),
                role: role,
                type: type,
                content: text
            });
        };

        const saveToDatabase = async () => {
            try {
                if (!currentSessionId) return;
                const room = activeRooms.get(currentSessionId);
                if (!room || !room.transcript) return;

                const { error: updateErr } = await supabase.from('interview_sessions')
                    .update({ status: '已結束', end_time: new Date().toISOString() })
                    .eq('session_id', currentSessionId);
                if (updateErr) throw updateErr;

                const fullConversationLog = room.transcript
                    .filter(item => item.type === "speech")
                    .map(item => {
                        let speakerName = '應徵者';
                        if (item.role === 'ai_HR') speakerName = 'HR 面試官';
                        if (item.role === 'ai_MANAGER') speakerName = '部門主管';
                        if (item.role === 'human_HR') speakerName = '真人 HR';
                        if (item.role?.startsWith('candidate:')) speakerName = item.role.replace('candidate:', '');
                        return `${speakerName}：${item.content}`;
                    })
                    .join('\n\n');

                if (!fullConversationLog) return;

                const { error: insertErr } = await supabase.from('transcripts')
                    .insert([{ session_id: currentSessionId, speaker: 'FULL_CONVERSATION', text_content: fullConversationLog, created_at: new Date().toISOString() }]);
                if (insertErr) throw insertErr;

                console.log(`✅ 多人面試已完美存檔 (Session: ${currentSessionId})`);
                activeRooms.delete(currentSessionId);
            } catch (err) { console.error('❌ 寫入資料庫失敗:', err.message); }
        };

        const startGroupGeminiConnections = (roomState, candidatesInfoText, candidatesList, position, interview_type, jobDetailsText, companyContext) => {
            // 1. 初始化連線並存入 roomState
            roomState.hrWs = new WebSocket(GEMINI_WS_URL);
            roomState.managerWs = new WebSocket(GEMINI_WS_URL);

            // 2. 將所有狀態集中管理於 roomState，確保多人共享同一份狀態
            roomState.currentInterviewer = 'HR';
            roomState.isInterviewEnded = false;
            roomState.isAiSpeaking = false;
            roomState.hrRoundCount = 0;
            roomState.managerRoundCount = 0;
            roomState.isHRWrappingUp = false;
            roomState.isManagerWrappingUp = false;
            roomState.isFinalStage = false;
            roomState.hrPendingAction = null;
            roomState.hrSpeechBuffer = "";
            roomState.managerSpeechBuffer = "";
            roomState.hrFlushTimeout = null;
            roomState.managerFlushTimeout = null;

            // (Prompt 設定維持原樣...)
            const candidatesNamesStr = candidatesList.map(c => c.name).join('、');
            const orderedNamesList = candidatesList.map((c, i) => `${i + 1}. ${c.name}`).join('\n');
            const totalCandidates = candidatesList.length;

            const hrPrompt = `
                你現在正進行一場【多人團體面試】，應徵職缺為「${position}」。
                本次面試的應徵者共有 ${totalCandidates} 位，固定順序與名單如下（絕對不可隨意跳號）：
                ${orderedNamesList}
                
                【企業背景設定】：
                ${companyContext}

                【人格設定】：你是資深 HR 面試官。語氣專業、親切、控場能力強。
                
                【核心任務與絕對穩定規則 (極度重要)】：
                1. 負責團體面試開場，熱情歡迎大家。
                2. 🌟 **「所有人回答同一題」輪流機制**：
                   - 每次你提出一個問題時，**必須依序指定名單中的人「一個一個回答」同一道題目**。
                   - 例如：先問「請第 1 位 [${candidatesList[0]?.name}] 回答這個問題...」，等他回答完後，再問「接下來請第 2 位 [${candidatesList[1]?.name || ''}] 針對同一題發表看法」，以此類推，直到名單內所有人都在這道題發言完畢。
                   - 當所有人都在這一題回答完後，你才能提出「下一個新問題」，並再次從第 1 位開始依序點名！
                3. **禁止亂跳與搶答**：絕對不允許開放自由搶答，也絕對不能跳號。
                4. 每次發言【只能問一個問題】且【只能指定一個人】。
                5. 你的對話對象只有現場的應徵者們，絕對不要與部門主管對話。
                6. 【發言權切換固定句型，絕對不可違反】
                每次要指定某位應徵者開始回答時，你的最後一句必須「逐字」使用以下格式：
                「現在請完整姓名回答。」
                例如：「現在請王小明回答。」
                前面的回饋內容可以提到任何人的姓名，但只有「現在請完整姓名回答。」這個固定句型代表真正切換回答者。

                【交接規則】：
                - 在尚未收到系統交接指令前，請持續按照上述規則進行。收到指令後，做簡短回饋並做過場交接。
                - 絕對不要輸出任何「動作描述」（如 (點頭)）。
                - 只有部門主管完成技術面試並正式交還 HR 後，你才可以進行整場最終結語。
                
                【禁止問題】：
                「對我們公司或這個職缺，有沒有其他想了解的問題？」
                「有沒有問題想問我們？」
                「還有什麼想了解的？」
                或任何讓應徵者反過來向公司提問的問題。
                - HR 階段只負責自我介紹、求職動機、人格特質、職涯規劃、團隊合作、情境與行為問題。
                - HR 問題數完成後，必須直接交給部門主管，不可自行增加最後提問。

                【所有應徵者履歷資訊】：
                ${candidatesInfoText}

                【本職缺詳細需求】：
                ${jobDetailsText}
            `;

            const managerPrompt = `
                你現在正進行一場【多人團體面試】，應徵職缺為「${position}」，面試類型：${interview_type}。
                本次面試的應徵者共有 ${totalCandidates} 位，固定順序與名單如下（絕對不可隨意跳號）：
                ${orderedNamesList}
                
                【企業背景設定】：
                ${companyContext}

                【人格設定】：你是部門技術主管。語氣嚴謹、實事求是。
                
                【核心任務與絕對穩定規則 (極度重要)】：
                1. 當收到「HR 已經交棒給你」的系統指令時，立刻用語音開口。
                2. 🌟 **「所有人回答同一題」輪流機制**：
                   - 針對技術問題，提出一個專業考題後，**必須依序指定名單中的人「一個一個回答」同一道題目**。
                   - 必須等第 1 位講完 $\rightarrow$ 換第 2 位講同一題 $\rightarrow$ 以此類推，直到所有人輪完這題，才能出下一題。
                3. 禁止搶答與亂跳號。每次發言【一次只能問一個問題】且【只能指定一個人回答】。
                4. 絕對不要與 HR 對話。
                5. 【發言權切換固定句型，絕對不可違反】
                每次要指定某位應徵者開始回答時，你的最後一句必須「逐字」使用以下格式：
                「現在請完整姓名回答。」
                例如：「現在請王小明回答。」
                前面的回饋內容可以提到任何人的姓名，但只有「現在請完整姓名回答。」這個固定句型代表真正切換回答者。
                
                【交接規則】：
                - 未收到交接指令前持續依序點名提問。收到指令後不提問，做簡短總結並交還 HR。
                - 絕對不要輸出任何「動作描述」。

                【所有應徵者履歷資訊】：
                ${candidatesInfoText}

                【本職缺詳細需求】：
                ${jobDetailsText}
            `;

            roomState.hrWs.on('open', () => {
                roomState.hrWs.send(JSON.stringify({
                    setup: {
                        model: MODEL_NAME,
                        systemInstruction: { parts: [{ text: hrPrompt }] },
                        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } } },
                        inputAudioTranscription: {},
                        outputAudioTranscription: {},

                        realtimeInputConfig: {
                            automaticActivityDetection: {
                                silenceDurationMs: 3000
} }
                    }
                }));
            });

            roomState.managerWs.on('open', () => {
                roomState.managerWs.send(JSON.stringify({
                    setup: {
                        model: MODEL_NAME,
                        systemInstruction: { parts: [{ text: managerPrompt }] },
                        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Enceladus" } } } },
                        inputAudioTranscription: {},
                        outputAudioTranscription: {},

                        realtimeInputConfig: {
                            automaticActivityDetection: {
                                silenceDurationMs: 3000
} }
                    }
                }));
            });

            // 3. 定義處理 AI 回應的邏輯 (傳入 roomState 作為參數)
            const handleAiResponse = (role, data) => {
                const response = JSON.parse(data.toString());

                const targetWs = role === 'HR' ? roomState.hrWs : roomState.managerWs;

                // 處理 Function Call
                if (response.serverContent?.modelTurn?.parts) {
                    const functionCallPart = response.serverContent.modelTurn.parts.find(p => p.functionCall);
                    if (functionCallPart) {
                        targetWs.send(JSON.stringify({
                            toolResponse: { functionResponses: [{ id: functionCallPart.functionCall.id, name: functionCallPart.functionCall.name, response: { result: "success" } }] }
                        }));
                    }
                }

                if (roomState.isInterviewEnded) return;

                // ==========================================
                // ✅ Gemini HR 初始化完成
                // ==========================================
                if (response.setupComplete && role === 'HR') {
                    console.log("✅ [Gemini HR] Setup Complete，可以開始面試");

                    // ⭐ 告訴前端：Gemini 已經準備完成
                    wss.clients.forEach(c => {
                        if (
                            c.readyState === WebSocket.OPEN &&
                            c.sessionId === roomState.sessionId
                        ) {
                            c.send(JSON.stringify({
                                setupComplete: true
                            }));
                        }
                    });

                    // ⭐ Gemini 開場
                    const firstName = candidatesList[0]?.name || "應徵者";

                    roomState.hrWs.send(JSON.stringify({
                        realtimeInput: {
                            text: `[系統指令]
                            請語音開場歡迎大家（${candidatesNamesStr}），並請第一位應徵者做自我介紹。

                            你的最後一句必須逐字說：
                            「現在請${firstName}回答。」

                            不要使用其他點名句型。`                        }
                    }));
                }

                if (
                    response.serverContent?.modelTurn?.parts &&
                    roomState.currentInterviewer === role
                ) {
                    // ⭐ AI 正在講話，暫時不讓應徵者 PCM 回灌 Gemini
                    roomState.isAiSpeaking = true;

                    const audioMsg = JSON.stringify({
                        ...JSON.parse(data.toString()),
                        ai_role: role
                    });

                    wss.clients.forEach(c => {
                        if (
                            c.readyState === WebSocket.OPEN &&
                            c.sessionId === roomState.sessionId
                        ) {
                            c.send(audioMsg);
                        }
                    });
                }

                // 處理語音轉文字邏輯
                if (response.serverContent?.outputTranscription) {
                    if (role === 'HR') {
                        roomState.hrSpeechBuffer += response.serverContent.outputTranscription.text;
                    } else {
                        roomState.managerSpeechBuffer += response.serverContent.outputTranscription.text;
                    }
                    const currentSpeechBuffer = role === 'HR'
                        ? roomState.hrSpeechBuffer
                        : roomState.managerSpeechBuffer;

                    // ⭐ 先把 AI 逐字稿轉成統一格式
                    let candidateDetectText = convert(currentSpeechBuffer).replace(/\s+/g, '');

                    // ⭐ 姓名仍以資料庫原始姓名為準
                    for (const candidate of roomState.candidatesList || []) {
                        const convertedName = convert(candidate.name).replace(/\s+/g, '');

                        if (convertedName !== candidate.name) {
                            candidateDetectText = candidateDetectText.replaceAll(
                                convertedName,
                                candidate.name
                            );
                        }
                    }

                    let mentionedCandidate = null;

                    // ⭐ 只認唯一固定句型：「現在請XXX回答」
                    for (const candidate of roomState.candidatesList || []) {
                        const command = `現在請${candidate.name}回答`;

                        if (candidateDetectText.includes(command)) {
                            mentionedCandidate = candidate;
                            break;
                        }
                    }

                    if (
                        mentionedCandidate &&
                        roomState.currentCandidateResumeId !== mentionedCandidate.resumeId
                    ) {
                        roomState.currentCandidateResumeId =
                            mentionedCandidate.resumeId;

                        roomState.currentCandidateName =
                            mentionedCandidate.name;

                        console.log(
                            `🎯 AI 正式點名 → ${mentionedCandidate.name} (${mentionedCandidate.resumeId})`
                        );
                    }

                    // 1. 取得對應的舊計時器並直接清除
                    const currentTimeout = role === 'HR' ? roomState.hrFlushTimeout : roomState.managerFlushTimeout;
                    if (currentTimeout) {
                        clearTimeout(currentTimeout);
                    }

                    const newTimeout = setTimeout(() => {
                        const bufferText = role === 'HR' ? roomState.hrSpeechBuffer : roomState.managerSpeechBuffer;
                        let finalSentence = convert(bufferText.trim()).replace(/\s+/g, '');

                        // ⭐ 姓名以資料庫為準，避免 OpenCC 把「郁」變成「鬱」之類
                        for (const candidate of roomState.candidatesList || []) {
                            const convertedName = convert(candidate.name);

                            if (convertedName !== candidate.name) {
                                finalSentence = finalSentence.replaceAll(
                                    convertedName,
                                    candidate.name
                                );
                            }
                        }
                        if (finalSentence) {
                            const aiMsg = JSON.stringify({
                                customType: 'ai_transcript_final',
                                ai_role: role,
                                text: finalSentence
                            });
                            wss.clients.forEach(c => {
                                if (c.readyState === WebSocket.OPEN && c.sessionId === roomState.sessionId) {
                                    c.send(aiMsg);
                                }
                            });

                            if (
                                role === 'HR' &&
                                roomState.currentInterviewer === 'HR' &&
                                !roomState.isHRWrappingUp
                            ) {
                                const isRealQuestion =
                                    (finalSentence.includes('？') || finalSentence.includes('?')) &&finalSentence.length > 10;

                                if (isRealQuestion) {
                                    roomState.hrRoundCount++;

                                    console.log(
                                        `📊 HR 題數：${roomState.hrRoundCount}`
                                    );
                                }
                            }
                            if (
                                role === 'MANAGER' &&
                                roomState.currentInterviewer === 'MANAGER' &&
                                !roomState.isManagerWrappingUp
                            ) {
                                const isRealQuestion =
                                    (finalSentence.includes('？') || finalSentence.includes('?')) && finalSentence.length > 10;

                                if (isRealQuestion) {
                                    roomState.managerRoundCount++;

                                    console.log(
                                        `📊 主管題數：${roomState.managerRoundCount}`
                                    );
                                }
                            }


                            // 🔄 主管交還 HR (使用 roomState)
                            if (role === 'MANAGER' && roomState.isManagerWrappingUp && roomState.currentInterviewer === 'MANAGER') {
                                if (finalSentence.includes('交還') || finalSentence.includes('人資')) {
                                    roomState.currentInterviewer = 'HANDOVER';
                                    roomState.isManagerWrappingUp = false;
                                    setTimeout(() => {
                                        roomState.currentInterviewer = 'HR';
                                        roomState.isFinalStage = true;
                                        if (roomState.hrWs?.readyState === WebSocket.OPEN) {
                                            roomState.hrWs.send(JSON.stringify({
                                                realtimeInput: {
                                                    text: `
                                                    [系統指令]

                                                    部門主管的技術面試已經結束，現在是整場 AI 面試的最終結尾。
                                                    請只進行一次簡短結語，不可以再提出任何問題，
                                                    也絕對不可以再次交接給部門主管。

                                                    請明確告訴應徵者：

                                                    「非常感謝各位今天參與面試，AI 面試階段到此結束。
                                                    若目前沒有真人面試官需要追加提問，
                                                    請按下『結束面試』按鈕完成本次面試。
                                                    若稍後有真人面試官進行補充提問，
                                                    請依真人面試官的指示繼續作答。」

                                                    說完後請停止發言，不要再主動回應應徵者。
                                                    `.trim()
                                                    } }));
                                        }
                                    }, 3000);
                                }
                            }
                        }
                        if (role === 'HR') roomState.hrSpeechBuffer = ""; else roomState.managerSpeechBuffer = "";
                    }, 2000);

                    if (role === 'HR') roomState.hrFlushTimeout = newTimeout; else roomState.managerFlushTimeout = newTimeout;
                }
                // ==========================================
                // 👤 應徵者語音轉文字 → 傳到前端即時對話紀錄
                // ==========================================
                if (
                    response.serverContent?.inputTranscription &&
                    roomState.currentInterviewer === role
                ) {
                    const partialText =
                        response.serverContent.inputTranscription.text || "";

                    if (partialText) {

                        // ⭐ 這一段逐字稿第一次出現時，就把真正聲音來源鎖住
                        // 後面即使 AI 已經點名下一個人，也不能改掉
                        if (!roomState.userSpeechCandidateResumeId) {
                            roomState.userSpeechCandidateResumeId =
                                roomState.lastAudioCandidateResumeId;

                            roomState.userSpeechCandidateName =
                                roomState.lastAudioCandidateName ||
                                roomState.currentCandidateName ||
                                '應徵者';

                            console.log(
                                `🎙️ 逐字稿來源鎖定 → ${roomState.userSpeechCandidateName}`
                            );
                        }

                        roomState.userSpeechBuffer += partialText;

                        if (roomState.userFlushTimeout) {
                            clearTimeout(roomState.userFlushTimeout);
                        }

                        roomState.userFlushTimeout = setTimeout(() => {

                            const finalUserText = convert(
                                roomState.userSpeechBuffer.trim()
                            )
                                .replace(/([\u3400-\u9FFF])\s+(?=[\u3400-\u9FFF])/g, '$1')
                                .replace(/\s+([，。！？、,.!?])/g, '$1');

                            // ⭐ 在清空前，先把這段真正的講話者存起來
                            const speechCandidateName =
                                roomState.userSpeechCandidateName ||
                                roomState.lastAudioCandidateName ||
                                '應徵者';

                            roomState.userSpeechBuffer = "";

                            // ⭐ 這段話結束，解除鎖定
                            roomState.userSpeechCandidateResumeId = null;
                            roomState.userSpeechCandidateName = null;

                            if (!finalUserText) return;

                            console.log(
                                `👤 [${speechCandidateName}] ${finalUserText}`
                            );

                            addLog(
                                roomState.sessionId,
                                `candidate:${speechCandidateName}`,
                                finalUserText,
                                "speech"
                            );

                            const userMsg = JSON.stringify({
                                customType: 'user_transcript',
                                candidateName: speechCandidateName,
                                text: finalUserText
                            });

                            wss.clients.forEach(c => {
                                if (
                                    c.readyState === WebSocket.OPEN &&
                                    c.sessionId === roomState.sessionId
                                ) {
                                    c.send(userMsg);
                                }
                            });

                        }, 1000);
                    }
                }                // 應徵者發言邏輯
                if (
                    response.serverContent?.inputTranscription &&
                    roomState.currentInterviewer === role
                ) {
                    const userText =
                        response.serverContent.inputTranscription.text;

                    const isTargetReached =
                        (
                            role === 'HR' &&
                            roomState.hrRoundCount >=
                            (roomState.hrTargetRounds * candidatesList.length)
                        )
                        ||
                        (
                            role === 'MANAGER' &&
                            roomState.managerRoundCount >=
                            (roomState.managerTargetRounds * candidatesList.length)
                        );

                    // ⭐ 已經正在交接就不能再送第二次
                    const alreadyWrapping =
                        role === 'HR'
                            ? roomState.isHRWrappingUp
                            : roomState.isManagerWrappingUp;

                    // ⭐ 最後結尾階段也不能再次觸發 HR → Manager
                    if (
                        isTargetReached &&
                        !alreadyWrapping &&
                        !roomState.isFinalStage &&
                        !roomState.aiPhaseFinished
                    ) {
                        if (role === 'HR') {
                            roomState.isHRWrappingUp = true;
                        } else {
                            roomState.isManagerWrappingUp = true;
                        }

                        const handoverLine =
                            role === 'HR'
                                ? "非常感謝大家的精彩分享。接下來的專業技術環節，我將交給部門主管來主持。"
                                : "謝謝各位的詳細說明。我的技術提問部分就到這裡，交還給人資。";

                        const injectionMsg = {
                            clientContent: {
                                turns: [{
                                    role: "user",
                                    parts: [{
                                        text:
                                            `[系統指令] 應徵者說了: "${userText}"。` +
                                            `請簡短總結一次，並只說一次以下交接台詞：` +
                                            `「${handoverLine}」` +
                                            `交接完成後不要重複。`
                                    }]
                                }],
                                turnComplete: true
                            }
                        };

                        if (
                            role === 'HR' &&
                            roomState.hrWs?.readyState === WebSocket.OPEN
                        ) {
                            roomState.hrWs.send(
                                JSON.stringify(injectionMsg)
                            );
                        }

                        if (
                            role === 'MANAGER' &&
                            roomState.managerWs?.readyState === WebSocket.OPEN
                        ) {
                            roomState.managerWs.send(
                                JSON.stringify(injectionMsg)
                            );
                        }
                    }
                }
                // ⭐ AI 這輪真的講完了
                if (response.serverContent?.turnComplete) {

                    roomState.isAiSpeaking = false;

                    // ==========================================
                    // 🔄 HR 交接語講完 → 強制切到部門主管
                    // ==========================================
                    if (
                        role === 'HR' &&
                        roomState.isHRWrappingUp &&
                        roomState.currentInterviewer === 'HR' &&
                        !roomState.isFinalStage
                    ) {
                        console.log("🔄 HR 交接完成 → 準備啟動部門主管");

                        roomState.currentInterviewer = 'HANDOVER';
                        roomState.isHRWrappingUp = false;

                        const firstCandidate = roomState.candidatesList[0];

                        setTimeout(() => {

                            roomState.currentInterviewer = 'MANAGER';

                            roomState.currentCandidateResumeId =
                                firstCandidate.resumeId;

                            roomState.currentCandidateName =
                                firstCandidate.name;

                            if (
                                roomState.managerWs &&
                                roomState.managerWs.readyState === WebSocket.OPEN
                            ) {
                                console.log("👨‍💻 正式啟動部門主管");

                                roomState.managerWs.send(JSON.stringify({
                                    realtimeInput: {
                                        text: `[系統指令]
                                                HR 階段已經正式結束，現在由你接手技術面試。

                                                請立刻語音提出第一個完整的技術問題。
                                                問題必須與「${position}」職缺、應徵者履歷或實際技術能力相關。

                                                問題說完整之後，最後一句必須逐字說：
                                                「現在請${firstCandidate.name}回答。」

                                                禁止只說「現在請${firstCandidate.name}回答」而沒有問題內容。
                                                不要使用其他點名句型。`
                                    }
                                }));

                            } else {
                                console.error(
                                    "❌ 部門主管 Gemini WebSocket 尚未 OPEN",
                                    roomState.managerWs?.readyState
                                );
                            }

                        }, 800);

                        return;
                    }
                }
                
                if (
                    response.serverContent?.turnComplete &&
                    role === 'HR' &&
                    roomState.isFinalStage &&
                    !roomState.aiPhaseFinished
                ) {
                    // ⭐ AI 面試階段正式結束
                    roomState.aiPhaseFinished = true;
                    roomState.isAiSpeaking = false;
                    roomState.currentInterviewer = 'WAITING_HUMAN';

                    // ⭐ 清除 AI 發言權
                    // 後面任何應徵者講話都不再送進 Gemini
                    roomState.currentCandidateResumeId = null;
                    roomState.currentCandidateName = null;

                    console.log(
                        "🏁 AI 面試正式結束，Gemini 停止回應，保留真人對話與文字紀錄"
                    );

                    // ⭐ 告訴所有前端：AI 階段結束
                    // 前端之後可以繼續用 SpeechRecognition 記錄候選人的話
                    wss.clients.forEach(c => {
                        if (
                            c.readyState === WebSocket.OPEN &&
                            c.sessionId === roomState.sessionId
                        ) {
                            c.send(JSON.stringify({
                                customType: 'ai_phase_finished'
                            }));
                        }
                    });

                    // ⭐ 只關 Gemini HR / Manager
                    // 不關候選人的 WebSocket、PeerJS、麥克風
                    setTimeout(() => {
                        if (
                            roomState.hrWs &&
                            roomState.hrWs.readyState === WebSocket.OPEN
                        ) {
                            roomState.hrWs.close();
                        }

                        if (
                            roomState.managerWs &&
                            roomState.managerWs.readyState === WebSocket.OPEN
                        ) {
                            roomState.managerWs.close();
                        }

                        console.log("🔇 Gemini HR / Manager 已關閉，不再產生 AI 回覆");
                    }, 1500);
                }
            };

            roomState.hrWs.on('message', (data) => handleAiResponse('HR', data));
            roomState.managerWs.on('message', (data) => handleAiResponse('MANAGER', data));
            roomState.hrWs.on('close', (code, reason) => {
                console.error(
                    `🔴 [Gemini HR] WebSocket 關閉`,
                    {
                        code,
                        reason: reason.toString()
                    }
                );
            });

            roomState.hrWs.on('error', (err) => {
                console.error(
                    `❌ [Gemini HR] WebSocket 錯誤:`,
                    err.message
                );
            });

            roomState.managerWs.on('close', (code, reason) => {
                console.error(
                    `🔴 [Gemini Manager] WebSocket 關閉`,
                    {
                        code,
                        reason: reason.toString()
                    }
                );
            });

            roomState.managerWs.on('error', (err) => {
                console.error(
                    `❌ [Gemini Manager] WebSocket 錯誤:`,
                    err.message
                );
            });
        };

        clientWs.on('message', async (msg) => {
            try {
                const msgStr = msg.toString();
                // 音訊封包非常頻繁，不印出來，避免 Terminal 洗版
                if (!msgStr.includes('realtimeInput')) {
                    console.log(
                        `📩 [控制訊息]`,
                        msgStr.substring(0, 150)
                    );
                }
                const parsedMsg = JSON.parse(msg.toString());

                // 🌟 1. 如果訊息內有帶 sessionId，立刻綁定到 clientWs 上
                if (parsedMsg.sessionId) {
                    currentSessionId = parsedMsg.sessionId;
                    clientWs.sessionId = parsedMsg.sessionId;
                }

                // 🌟 2. 核心防線：如果變數掉了，強制從 clientWs 物件身上拿！
                if (!currentSessionId && clientWs.sessionId) {
                    currentSessionId = clientWs.sessionId;
                }

                // 👑 真人 HR 進入房間
                if (parsedMsg.type === 'hr_join_room') {
                    const room = activeRooms.get(parsedMsg.sessionId);

                    clientWs.clientType = 'hr';

                    if (room) {
                        clientWs.send(JSON.stringify({
                            type: 'room_ready_state',
                            candidates: room.candidatesList.map(c => c.name)
                        }));
                    }

                    return;
                }

                // 3. 處理語音輸入 (realtimeInput)
                if (parsedMsg.realtimeInput) {
                    // 如果到這裡還是沒有房間 ID，才報警
                    if (!currentSessionId) {
                        console.warn("⚠️ [嚴重] 收到語音但此連線完全未綁定任何 Session ID！");
                        return;
                    }

                    const room = activeRooms.get(currentSessionId);
                    if (room) {
                        // AI 還沒結束時，才把聲音送給 Gemini
                        if (!room.aiPhaseFinished && room.currentInterviewer !== 'WAITING_HUMAN') {

                            // ⭐ AI 自己正在講話時，不把麥克風聲音回送給 Gemini
                            // WebRTC 不受影響，其他真人仍然聽得到
                            if (
                                room.isAiSpeaking &&
                                parsedMsg.realtimeInput.audio
                            ) {
                                return;
                            }
                            // ⭐ 正常版 暫時更改
                            if (
                                clientWs.clientType === 'candidate' &&
                                room.currentCandidateResumeId &&
                                clientWs.resumeId !== room.currentCandidateResumeId
                            ) {
                                return;
                            }

                            let targetWs = null;
                            if (room.currentInterviewer === 'HR') targetWs = room.hrWs;
                            else if (room.currentInterviewer === 'MANAGER') targetWs = room.managerWs;

                            // ⭐ 只有「真的正在講話」的音訊，才記錄這個人的身分
                            if (
                                clientWs.clientType === 'candidate' &&
                                parsedMsg.realtimeInput.audio &&
                                parsedMsg.speakerActive === true
                            ) {
                                room.lastAudioCandidateResumeId = clientWs.resumeId;
                                room.lastAudioCandidateName =
                                    clientWs.candidateName || room.currentCandidateName;

                                // ⭐ 這一段回答一開始就把說話者鎖死
                                if (!room.userSpeechCandidateResumeId) {
                                    room.userSpeechCandidateResumeId = clientWs.resumeId;
                                    room.userSpeechCandidateName =
                                        clientWs.candidateName || room.currentCandidateName;

                                    console.log(
                                        `🎙️ 真正開始收音 → ${room.userSpeechCandidateName}`
                                    );
                                }
                            }
                            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                                targetWs.send(JSON.stringify({
                                    realtimeInput: parsedMsg.realtimeInput
                                }));
                            }
                        }

                        // 只有真的有文字時才記錄＋廣播
                        if (parsedMsg.realtimeInput.text) {
                            addLog(
                                currentSessionId,
                                'user',
                                parsedMsg.realtimeInput.text,
                                "speech"
                            );

                            const broadcastMsg = JSON.stringify({
                                customType: 'user_transcript',
                                text: parsedMsg.realtimeInput.text
                            });

                            wss.clients.forEach(c => {
                                if (
                                    c.readyState === WebSocket.OPEN &&
                                    c.sessionId === currentSessionId
                                ) {
                                    c.send(broadcastMsg);
                                }
                            });
                        }                    } else {
                        console.warn(`⚠️ 找不到對應的 activeRoom: ${currentSessionId}`);
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
                    const room = activeRooms.get(currentSessionId);
                    if (room) {
                        if (room.currentInterviewer !== 'HANDOVER' && room.currentInterviewer !== 'HUMAN_INTERVENING') {
                            room.previousInterviewer = room.currentInterviewer;
                        }
                        room.currentInterviewer = 'HUMAN_INTERVENING';
                    }
                    return;
                }

                if (parsedMsg.customType === 'execute_backend_resume') {
                    const room = activeRooms.get(currentSessionId);
                    if (!room) return;

                    // 確保狀態切回原本的面試官（建議 previousInterviewer 也存放在 room 裡面）
                    room.currentInterviewer = room.previousInterviewer || 'HR';

                    const resumeMsg = JSON.stringify({
                        clientContent: {
                            turns: [{
                                role: "user", parts: [{
                                    text: `[系統指令]
                                            真人面試官插話結束，請繼續原本的團體面試流程。
                                            如果你要指定某位應徵者回答，最後一句必須嚴格使用：「現在請完整姓名回答。」
                                            (例如：「現在請王小明回答。」)
                                            不得使用任何其他點名方式。` }] }],
                            turnComplete: true
                        }
                    });

                    // 🌟 修改處：使用 room 中的 ws
                    if (room.currentInterviewer === 'HR' && room.hrWs?.readyState === WebSocket.OPEN) {
                        room.hrWs.send(resumeMsg);
                    }
                    if (room.currentInterviewer === 'MANAGER' && room.managerWs?.readyState === WebSocket.OPEN) {
                        room.managerWs.send(resumeMsg);
                    }
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
                    addLog(
                        parsedMsg.sessionId,
                        "human_HR",
                        parsedMsg.text,
                        "speech"
                    );                    return;
                }
                // ==========================================
                // 🌟 接收應徵者在「暫停期間」講的話 (備用打字員傳來的)
                // ==========================================
                if (parsedMsg.customType === 'user_human_speech') {
                    console.log(`🎤 [應徵者插話文字] ${parsedMsg.text}`);

                    const textMsg = JSON.stringify({
                        customType: 'user_transcript',
                        candidateName: clientWs.candidateName || '應徵者',
                        text: parsedMsg.text
                    });

                    // 廣播給房間裡的所有人（包含戰情室）
                    wss.clients.forEach(c => {
                        if (c.readyState === WebSocket.OPEN && c.sessionId === parsedMsg.sessionId) {
                            c.send(textMsg);
                        }
                    });
                    addLog(
                        parsedMsg.sessionId,
                        `candidate:${clientWs.candidateName || '應徵者'}`,
                        parsedMsg.text,
                        "speech"
                    );                    return;
                }

                // ==========================================
                // 🌟 初始化「多人團體面試」或加入現有房間
                // ==========================================
                if (parsedMsg.type === 'candidate_ready') {
                    const { sessionId, resumeId, position, interview_type, jobId } = parsedMsg;

                    currentSessionId = sessionId;
                    clientWs.sessionId = sessionId;
                    clientWs.clientType = 'candidate';
                    clientWs.resumeId = resumeId;

                    let room = activeRooms.get(sessionId);

                    if (!room) {
                        room = {
                            sessionId,
                            hrWs: null,
                            managerWs: null,
                            currentInterviewer: 'WAITING_START',
                            previousInterviewer: 'HR',
                            isInterviewEnded: false,
                            aiStarted: false,
                            aiPhaseFinished: false,
                            isAiSpeaking: false,

                            position,
                            interview_type,
                            jobId,
                            candidatesList: [],
                            currentCandidateResumeId: null,
                            currentCandidateName: null,

                            // ⭐ 真正送進 Gemini 的聲音來源
                            lastAudioCandidateResumeId: null,
                            lastAudioCandidateName: null,

                            // ⭐ 目前這一段逐字稿屬於誰
                            userSpeechCandidateResumeId: null,
                            userSpeechCandidateName: null,

                            hrRoundCount: 0,                            managerRoundCount: 0,
                            hrTargetRounds: 2,
                            managerTargetRounds: 3,

                            isHRWrappingUp: false,
                            isManagerWrappingUp: false,
                            isFinalStage: false,

                            transcript: [],
                            hrSpeechBuffer: "",
                            managerSpeechBuffer: "",
                            userSpeechBuffer: "",
                            hrFlushTimeout: null,
                            managerFlushTimeout: null,
                            userFlushTimeout: null
                        };

                        activeRooms.set(sessionId, room);
                    }

                    // AI 已經開始就不再自動加進正式 AI 名單
                    if (room.aiStarted) {
                        clientWs.send(JSON.stringify({ type: 'candidate_late_join' }));
                        return;
                    }

                    if (resumeId && !room.candidatesList.some(c => c.resumeId === resumeId)) {
                        const { data: resume, error } = await supabase
                            .from('resumes')
                            .select(`*, applicants ( name )`)
                            .eq('resume_id', resumeId)
                            .single();

                        if (!error && resume) {
                            const candidate = {
                                resumeId: resume.resume_id,
                                id: resume.applicant_id,
                                name: resume.applicants?.name || '應徵者',
                                education: resume.education || '無',
                                workExperience: resume.work_experience || '無'
                            };

                            room.candidatesList.push(candidate);
                            clientWs.candidateName = candidate.name;

                            console.log(`✅ ${candidate.name} 已準備`);
                        }
                    }

                    const candidate = room.candidatesList.find(c => c.resumeId === resumeId);
                    if (candidate) clientWs.candidateName = candidate.name;

                    await supabase.from('interview_sessions')
                        .update({ status: '進行中' })
                        .eq('session_id', sessionId);

                    const readyNames = room.candidatesList.map(c => c.name);

                    wss.clients.forEach(c => {
                        if (c.readyState === WebSocket.OPEN && c.sessionId === sessionId) {
                            c.send(JSON.stringify({
                                type: 'room_ready_state',
                                candidates: readyNames
                            }));
                        }
                    });

                    clientWs.send(JSON.stringify({
                        type: 'candidate_ready_confirmed',
                        candidateName: clientWs.candidateName || '應徵者'
                    }));

                    return;
                }
                if (parsedMsg.type === 'start_ai_interview') {
                    const room = activeRooms.get(parsedMsg.sessionId);

                    if (!room || room.candidatesList.length === 0) {
                        clientWs.send(JSON.stringify({
                            type: 'start_ai_error',
                            message: '目前沒有已準備的應徵者'
                        }));
                        return;
                    }

                    if (room.aiStarted) return;

                    room.aiStarted = true;
                    room.currentInterviewer = 'HR';

                    const candidatesList = room.candidatesList;

                    const candidatesInfoText = candidatesList.map((c, index) =>
                        `【應徵者 ${index + 1}】：${c.name}\n學歷：${c.education}\n經歷：${c.workExperience}\n`
                    ).join('\n');

                    // ⭐ 第一位先取得 AI 發言權
                    room.currentCandidateResumeId = candidatesList[0].resumeId;
                    room.currentCandidateName = candidatesList[0].name;

                    let jobDetailsText = "無特定職缺資料";

                    if (room.jobId) {
                        const { data: jobData } = await supabase
                            .from('jobs')
                            .select('job_title, job_description, requirements')
                            .eq('job_id', room.jobId)
                            .single();

                        if (jobData) {
                            jobDetailsText =
                                `【工作內容】：\n${jobData.job_description}\n\n【條件要求】：\n${jobData.requirements}`;
                        }
                    }

                    let companyContext = "無特定公司資料";

                    const { data: companyData } = await supabase
                        .from('Company_Profile')
                        .select('company_name, company_info')
                        .eq('id', 1)
                        .single();

                    if (companyData) {
                        companyContext =
                            `【公司名稱】：${companyData.company_name}\n【公司簡介】：${companyData.company_info}`;
                    }

                    startGroupGeminiConnections(
                        room,
                        candidatesInfoText,
                        candidatesList,
                        room.position,
                        room.interview_type,
                        jobDetailsText,
                        companyContext
                    );

                    // ⭐ 告訴整個房間：AI 面試正式啟動
                    wss.clients.forEach(c => {
                        if (c.readyState === WebSocket.OPEN && c.sessionId === room.sessionId) {
                            c.send(JSON.stringify({
                                type: 'ai_interview_started',
                                candidates: candidatesList.map(x => x.name)
                            }));
                        }
                    });

                    return;
                }

            } catch (err) {
                console.error('❌ 解析訊息失敗:', err);
            }
        });

        clientWs.on('close', () => {
            console.log('🔴 [前端] 連線已中斷 (多人模式)');

            const remainingClients = [...wss.clients].filter(c =>
                c.readyState === WebSocket.OPEN &&
                c.sessionId === currentSessionId
            );

            console.log(`👥 房間剩餘 ${remainingClients.length} 個連線`);

            // 房間還有人，就不要關 AI
            if (remainingClients.length > 0) return;

            // 最後一個人離開才存檔＋關 Gemini
            saveToDatabase();

            const room = activeRooms.get(currentSessionId);
            if (room) {
                if (room.hrWs) room.hrWs.close();
                if (room.managerWs) room.managerWs.close();
            }
        });
    });
    return wss;
}

module.exports = setupGroupWebSocket;