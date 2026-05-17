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

        // 🌟 核心控制變數
        let currentInterviewer = 'HR';
        let isInterviewEnded = false;

        let hrWs = null;
        let managerWs = null;

        let hrSpeechBuffer = "";
        let managerSpeechBuffer = "";
        let hrFlushTimeout = null;
        let managerFlushTimeout = null;

        // 🎯 後端計數器（狀態機）
        let hrSpeakCount = 0;
        let managerSpeakCount = 0;
        let isHRWrappingUp = false;
        let isManagerWrappingUp = false;

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

                const { error: insertErr } = await supabase.from('transcripts').insert([{
                    session_id: currentSessionId,
                    speaker: 'FULL_CONVERSATION',
                    text_content: fullConversationLog,
                    created_at: new Date().toISOString()
                }]);
                if (insertErr) throw insertErr;

                const { error: updateErr } = await supabase.from('interview_sessions')
                    .update({
                        status: '已結束',
                        end_time: new Date().toISOString()
                    })
                    .eq('session_id', currentSessionId);
                if (updateErr) throw updateErr;

                console.log(`✅ 面試已完美存檔，資料庫狀態已更新為「已結束」 (${currentSessionId})`);
            } catch (err) { console.error('❌ 寫入資料庫失敗:', err.message); }
        };

        const startGeminiConnections = (resumeText, position, interview_type) => {

            const hrPrompt = `
                你現在正與「部門主管」共同面試一位應徵「${position}」的候選人。
                
                【人格設定】：你是資深 HR 面試官。語氣專業、親切。
                
                【核心任務】：
                1. 負責面試開場，熱情地歡迎應徵者，並請他先簡單自我介紹。
                2. 針對履歷與自我介紹，提出「行為面試問題」（例如：團隊合作、壓力處理）。
                3. 每次發言【只能問一個問題】！
                4. 你的對話對象「只有」應徵者，絕對不要與部門主管對話。
                
                【交接規則 (🚨極度重要🚨)】：
                1. 在你尚未收到系統要求交接的指令前，請持續提問。
                2. 當系統發送強制指令要求你交棒時，你的發言只能是一句純粹的過場陳述句，絕對不可再問問題。
                3. 請使用這句標準台詞交棒：「了解，謝謝你的分享。接下來的技術與專業問題，我想交給部門主管來瞭解。」（必須包含「交給」與「主管」）。
                
                【🚨 系統強制限制】：絕對不要輸出任何「動作描述」！禁止輸出如「(點頭)」、「(保持沉默)」等字眼。
                應徵者履歷資料：${resumeText}
            `;

            const managerPrompt = `
                你現在正與「HR(人資)」共同面試一位應徵「${position}」的候選人。面試類型為：${interview_type}。
                
                【人格設定】：你是部門技術主管。語氣嚴謹、實事求是、直指核心。
                
                【核心任務】：
                1. 系統一開始不會給你聲音。當你收到「HR 已經交棒給你」的系統指令時，請立刻用語音開口。
                2. 針對應徵者的履歷或「回答」，提出專業技術問題。
                3. 每次發言【一次只能問一個問題】！絕對不可以一次丟出兩個以上的問號，問完立刻閉嘴等對方回答。
                4. 你的對話對象「只有」應徵者，絕對不要與 HR 對話。   

                【交接規則 (🚨極度重要🚨)】：
                1. 在你尚未收到系統要求交接的指令前，請持續提問。
                2. 當系統發送強制指令要求你交棒時，你的發言只能是一句過場陳述句，絕對不可再問問題。
                3. 請使用這句標準台詞交棒：「我的部分問完了，交還給人資。」（必須包含「交還」與「人資」）。
                
                【🚨 系統強制限制】：絕對不要輸出任何「動作描述」！禁止輸出如「(保持沉默)」等字眼。
                應徵者履歷資料：${resumeText}
            `;

            hrWs = new WebSocket(GEMINI_WS_URL);
            hrWs.on('open', () => {
                hrWs.send(JSON.stringify({
                    setup: {
                        model: MODEL_NAME,
                        systemInstruction: { parts: [{ text: hrPrompt }] },
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
                        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } } },
                        realtime_input_config: { automatic_activity_detection: { silence_duration_ms: 3000 } }
                    }
                }));
            });

            const handleAiResponse = (role, data) => {
                const response = JSON.parse(data.toString());

                if (response.setupComplete && role === 'HR') {
                    clientWs.send(JSON.stringify({ setupComplete: true }));
                    const kickstartPrompt = `[系統指令] 面試正式開始。請你立刻依照設定，用語音進行開場歡迎，並請應徵者簡單自我介紹。`;
                    hrWs.send(JSON.stringify({ realtimeInput: { text: kickstartPrompt } }));
                }

                if (response.serverContent?.modelTurn?.parts && currentInterviewer === role) {
                    const audioData = JSON.parse(data.toString());
                    audioData.ai_role = role;
                    clientWs.send(JSON.stringify(audioData));
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
                            // 🌟 改回乾淨版的括號攔截，不誤殺正常詞彙
                            const isStageDirection = /^[（\(【\[].*[）\)】\]]$/.test(finalSentence);

                            if (isStageDirection) {
                                console.log(`🛡️ [系統攔截] 成功阻擋 ${role} 的內心獨白: ${finalSentence}`);
                            } else {
                                addLog(`ai_${role}`, finalSentence, "speech");

                                if (currentInterviewer === role) {
                                    clientWs.send(JSON.stringify({ customType: 'ai_transcript_final', ai_role: role, text: finalSentence }));
                                }

                                // 🎯 紀錄發言次數 (單純累加，不再這裡發送交接指令)
                                const isRealQuestion = finalSentence.length > 15 || finalSentence.includes('？') || finalSentence.includes('?');

                                if (role === 'HR' && currentInterviewer === 'HR' && !isHRWrappingUp && !isInterviewEnded) {
                                    if (isRealQuestion) {
                                        hrSpeakCount++;
                                        console.log(`📊 [狀態機] HR 已提出第 ${hrSpeakCount} 個問題`);
                                    }
                                }

                                if (role === 'MANAGER' && currentInterviewer === 'MANAGER' && !isManagerWrappingUp) {
                                    if (isRealQuestion) {
                                        managerSpeakCount++;
                                        console.log(`📊 [狀態機] 部門主管已提出第 ${managerSpeakCount} 個問題`);
                                    }
                                }

                                // 🔄 核心交棒切換邏輯
                                const isHandoverToManager = finalSentence.includes('交給') && finalSentence.includes('主管');
                                const isHandoverToHR = (finalSentence.includes('交還') || finalSentence.includes('交給')) && finalSentence.includes('人資');

                                if (role === 'HR' && currentInterviewer === 'HR' && isHandoverToManager) {
                                    console.log('🔄 [權限切換] 麥克風已交給：部門主管');
                                    currentInterviewer = 'MANAGER';
                                    const promptToManager = `[系統指令] HR 已經交棒給你了。請立刻開口提出你的第 1 個技術問題。`;
                                    if (managerWs && managerWs.readyState === WebSocket.OPEN) managerWs.send(JSON.stringify({ realtimeInput: { text: promptToManager } }));
                                }
                                else if (role === 'MANAGER' && currentInterviewer === 'MANAGER' && isHandoverToHR) {
                                    console.log('🔄 [權限切換] 麥克風已交回：人資');
                                    currentInterviewer = 'HR';
                                    const promptToHR = `[系統指令] 部門主管已交還給你。請直接做面試結語，結語務必包含「今天的面試就到這邊結束，請按下結束面試按鈕」。絕對不可再問任何問題。`;
                                    if (hrWs && hrWs.readyState === WebSocket.OPEN) hrWs.send(JSON.stringify({ realtimeInput: { text: promptToHR } }));
                                }

                                // 🏁 狀態鎖定：判斷 HR 是否宣告面試結束
                                if (role === 'HR' && currentInterviewer === 'HR' && finalSentence.includes('結束面試按鈕')) {
                                    console.log('🏁 [流程控制] HR 已宣告面試結束，已鎖定麥克風，等待使用者點擊按鈕存檔。');
                                    isInterviewEnded = true;
                                }
                            }
                        }
                        if (role === 'HR') hrSpeechBuffer = ""; else managerSpeechBuffer = "";
                    }, 1000);

                    if (role === 'HR') hrFlushTimeout = newTimeout; else managerFlushTimeout = newTimeout;
                }

                // 🌟 最關鍵的修改：在這裡（應徵者講完話後）才發送交接指令！
                if (response.serverContent?.inputTranscription && currentInterviewer === role) {
                    let userText = convert(response.serverContent.inputTranscription.text).replace(/\s+/g, '');
                    userText = userText.replace(/^[,，]+/, '').replace(/[,，]{2,}/g, '，');
                    addLog("user", userText, "speech");
                    clientWs.send(JSON.stringify({ customType: 'user_transcript', text: userText }));

                    // 🎯 當應徵者回答完畢，且題數已滿時，才強迫 AI 交棒
                    if (role === 'HR' && hrSpeakCount >= 2 && !isHRWrappingUp) {
                        isHRWrappingUp = true;
                        console.log('⚠️ [狀態機] 應徵者回答完畢，發送【強制交棒】指令給 HR');
                        const wrapUpPrompt = `[系統強制指令] 應徵者已經回答完畢，你的提問額度已經用盡。請絕對不可再問任何問題，直接明確說出：「了解，謝謝你的分享。接下來的技術與專業問題，我想交給部門主管來瞭解。」`;
                        if (hrWs && hrWs.readyState === WebSocket.OPEN) hrWs.send(JSON.stringify({ realtimeInput: { text: wrapUpPrompt } }));
                    }

                    if (role === 'MANAGER' && managerSpeakCount >= 2 && !isManagerWrappingUp) {
                        isManagerWrappingUp = true;
                        console.log('⚠️ [狀態機] 應徵者回答完畢，發送【強制交棒】指令給主管');
                        const wrapUpPrompt = `[系統強制指令] 應徵者已經回答完畢，你的技術問題額度已經用盡。請絕對不可再問任何問題，直接明確說出：「我的部分問完了，交還給人資。」`;
                        if (managerWs && managerWs.readyState === WebSocket.OPEN) managerWs.send(JSON.stringify({ realtimeInput: { text: wrapUpPrompt } }));
                    }
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

                if (parsedMsg.client_content || parsedMsg.customType === 'window_switch') {
                    console.log(`⚠️ [系統提示] 偵測到切換視窗！已通知 ${currentInterviewer} 進行溫和提醒。`);
                    const gentlePrompt = `[系統強制指令] 系統偵測到應徵者剛剛切換了視窗。請你用友善語氣，簡單說一句：「小提醒喔，面試的時候請盡量讓畫面停留在我們的視窗」，然後直接繼續你原本要問的問題。`;
                    const warningMessage = JSON.stringify({ realtimeInput: { text: gentlePrompt } });

                    if (currentInterviewer === 'HR' && hrWs && hrWs.readyState === WebSocket.OPEN) {
                        hrWs.send(warningMessage);
                    } else if (currentInterviewer === 'MANAGER' && managerWs && managerWs.readyState === WebSocket.OPEN) {
                        managerWs.send(warningMessage);
                    }
                    return;
                }

                if (parsedMsg.realtimeInput) {
                    if (isInterviewEnded) return;

                    if (currentInterviewer === 'HR' && hrWs && hrWs.readyState === WebSocket.OPEN) hrWs.send(msg.toString());
                    else if (currentInterviewer === 'MANAGER' && managerWs && managerWs.readyState === WebSocket.OPEN) managerWs.send(msg.toString());
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