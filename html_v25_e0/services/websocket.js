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
        console.log('\n🟢 [前端] 已連線 (終極縫合版：WebRTC戰情室 + 嚴格交接狀態機)');

        let currentSessionId = null;
        let interviewData = { transcript: [] };

        // 🌟 核心控制變數 (融合你的防打斷與組員的狀態機)
        let currentInterviewer = 'HR';
        let isInterviewEnded = false;
        let isAiSpeaking = false; // 你的防護機制
        let previousInterviewer = 'HR'

        let hrWs = null;
        let managerWs = null;

        let hrSpeechBuffer = "";
        let managerSpeechBuffer = "";
        let hrFlushTimeout = null;
        let managerFlushTimeout = null;

        // 🎯 組員的後端計數器與狀態
        let hrSpeakCount = 0;
        let managerSpeakCount = 0;
        let isHRWrappingUp = false;
        let isManagerWrappingUp = false;

        // 🎯 目標題數 (改為動態變數，可由前端決定，預設為 2)
        let hrtargetCount = 2;
        let managertargetCount = 2;

        // 🛠️ 組員給 HR 用的交接工具
        const hrTools = [{
            functionDeclarations: [{
                name: "handover_to_manager",
                description: "當你完成人資的面試開場與行為提問，準備將面試交接給部門主管進行技術面試時，必須呼叫此函式。"
            }]
        }];

        // 🛠️ 組員給主管用的交接工具
        const managerTools = [{
            functionDeclarations: [{
                name: "handover_to_hr",
                description: "當你的技術問題問完，準備將面試交還給人資來做結語時，必須呼叫此函式。"
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

                // 🌟 你的完美存檔機制
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
                        return `${speakerName}：${item.content}`;
                    })
                    .join('\n\n');

                if (!fullConversationLog) {
                    console.log(`✅ 面試已標記結束 (無對話紀錄)`);
                    return; 
                }

                const { error: insertErr } = await supabase.from('transcripts')
                    .insert([{ session_id: currentSessionId, speaker: 'FULL_CONVERSATION', text_content: fullConversationLog, created_at: new Date().toISOString() }]);
                if (insertErr) throw insertErr;

                console.log(`✅ 面試已完美存檔 (含對話紀錄)`);
            } catch (err) { console.error('❌ 寫入資料庫失敗:', err.message); }
        };

        // 🌟 融合了組員的新版 Prompt 與你的 JobDetails
        const startGeminiConnections = (resumeText, position, interview_type, jobDetailsText) => {

            const hrPrompt = `
                你現在正與「部門主管」共同面試一位應徵「${position}」的候選人。
                
                【人格設定】：你是資深 HR 面試官。語氣專業、親切。
                
                【核心任務】：
                1. 負責面試開場，熱情地歡迎應徵者，並請他先簡單自我介紹。
                2. 針對履歷與自我介紹，提出「行為面試問題」（例如：團隊合作、壓力處理）。
                3. 每次發言【只能問一個問題】！
                4. 你的對話對象「只有」應徵者，絕對不要與部門主管對話。
                5. 【對話節奏控制】：
                - 當你請應徵者自我介紹或回答問題時，如果對方只回答「好」、「沒問題」、「嗯嗯」等簡短的確認語氣，請理解為他們正在思考或準備開口。
                - 此時請保持親切，不要急著進入下一個問題，你可以友善地引導：「沒問題，準備好隨時可以開始喔！」或是「好的，請說。」
                - 如果對方明確表示不知道或沒有經驗（例如：「沒有處理」、「不知道」），請自然地切換話題：「沒關係，那我們換個方向...」
                
                【交接規則 (極度重要)】：
                1. 在你尚未收到系統要求交接的指令前，請持續提問。
                2. 當系統發送強制指令要求你交棒時，請你講出這句標準台詞：「了解，謝謝你的分享。接下來的技術與專業問題，我想交給部門主管來瞭解。」

                【🚨 系統強制限制】：絕對不要輸出任何「動作描述」！禁止輸出如「(點頭)」、「(保持沉默)」等字眼。
                
                應徵者履歷資料：\n${resumeText}
                本職缺詳細需求：\n${jobDetailsText}
            `;

            const managerPrompt = `
                你現在正與「HR(人資)」共同面試一位應徵「${position}」的候選人。面試類型為：${interview_type}。
                
                【人格設定】：你是部門技術主管。語氣嚴謹、實事求是、直指核心。
                
                【核心任務】：
                1. 系統一開始不會給你聲音。當你收到「HR 已經交棒給你」的系統指令時，請立刻用語音開口。
                2. 針對應徵者的履歷或「回答」，提出專業技術問題。
                3. 每次發言【一次只能問一個問題】！絕對不可以一次丟出兩個以上的問號，問完立刻閉嘴等對方回答。
                4. 你的對話對象「只有」應徵者，絕對不要與 HR 對話。   
                5. 【對話節奏控制】：
                - 當你請應徵者自我介紹或回答問題時，如果對方只回答「好」、「沒問題」、「嗯嗯」等簡短的確認語氣，請理解為他們正在思考或準備開口。
                - 此時請保持親切，不要急著進入下一個問題，你可以友善地引導：「沒問題，準備好隨時可以開始喔！」或是「好的，請說。」
                - 如果對方明確表示不知道或沒有經驗（例如：「沒有處理」、「不知道」），請自然地切換話題：「沒關係，那我們換個方向...」

                【交接規則 (極度重要)】：
                1. 在你尚未收到系統要求交接的指令前，請持續提問。
                2. 當系統發送強制指令要求你交棒時，請你講出這句標準台詞：「我的部分問完了，交還給人資。」

                【🚨 系統強制限制】：絕對不要輸出任何「動作描述」！禁止輸出如「(保持沉默)」等字眼。
                
                應徵者履歷資料：\n${resumeText}
                本職缺詳細需求：\n${jobDetailsText}
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
                if (isInterviewEnded) return;
                const response = JSON.parse(data.toString());

                // 🎬 組員寫的專屬交接函數 (後端發動)
                const executeHandover = (targetRole) => {
                    console.log(`🚀 [系統強制介入] 啟動 ${targetRole} 的交接函數`);
                    if (targetRole === 'HR') {
                        isHRWrappingUp = true;
                        const strictPrompt = `[系統指令] 你的階段提問任務已完成，準備交接。請先判斷應徵者最後的回答：1. 如果是有意義的內容，請給予 1 句話的自然回饋。2. 如果是無意義短句或亂碼，請「完全忽略」。判斷完後，請務必直接朗讀這句交接台詞：「了解，謝謝你的分享。接下來的技術與專業問題，我想交給部門主管來瞭解。」絕對不可再問新問題。`;
                        if (hrWs && hrWs.readyState === WebSocket.OPEN) hrWs.send(JSON.stringify({ realtimeInput: { text: strictPrompt } }));
                    } else if (targetRole === 'MANAGER') {
                        isManagerWrappingUp = true;
                        const strictPrompt = `[系統指令] 你的階段提問任務已完成，準備交接。請先判斷應徵者最後的回答：1. 如果是有意義的內容，請給予 1 句話的自然回饋。2. 如果是無意義短句或亂碼，請「完全忽略」。判斷完後，請務必直接朗讀這句交接台詞：「好的，謝謝你的說明。我的部分問完了，交還給人資。」絕對不可再問新問題。`;
                        if (managerWs && managerWs.readyState === WebSocket.OPEN) managerWs.send(JSON.stringify({ realtimeInput: { text: strictPrompt } }));
                    }
                };

                if (response.setupComplete && role === 'HR') {
                    clientWs.send(JSON.stringify({ setupComplete: true }));
                    isAiSpeaking = true;
                    hrWs.send(JSON.stringify({ realtimeInput: { text: `[系統指令] 面試正式開始。請你立刻依照設定，用語音進行開場歡迎，並請應徵者簡單自我介紹。` } }));
                }

                if (response.serverContent?.modelTurn?.parts && currentInterviewer === role) {
                    isAiSpeaking = true; // 你的防護機制
                    const audioData = JSON.parse(data.toString());
                    audioData.ai_role = role;
                    clientWs.send(JSON.stringify(audioData));
                }

                if (response.serverContent?.turnComplete) {
                    isAiSpeaking = false; // 你的防護機制
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
                            if (isStageDirection) {
                                console.log(`🛡️ [系統攔截] 成功阻擋 ${role} 內心獨白: ${finalSentence}`);
                            } else {
                                addLog(`ai_${role}`, finalSentence, "speech");
                                if (currentInterviewer === role) {
                                    const aiMsg = JSON.stringify({ customType: 'ai_transcript_final', ai_role: role, text: finalSentence });
                                    wss.clients.forEach(c => { 
                                        if (c.readyState === WebSocket.OPEN && c.sessionId === currentSessionId) c.send(aiMsg); 
                                    });
                                }

                                const isRealQuestion = (finalSentence.includes('？') || finalSentence.includes('?')) && finalSentence.length > 10;

                                // 📊 組員的狀態機與題數控制
                                if (role === 'HR' && currentInterviewer === 'HR' && !isHRWrappingUp && !isInterviewEnded && isRealQuestion) {
                                    hrSpeakCount++;
                                    console.log(`📊 [狀態機] HR 已提出第 ${hrSpeakCount} 個問題`);
                                }
                                if (role === 'MANAGER' && currentInterviewer === 'MANAGER' && !isManagerWrappingUp && isRealQuestion) {
                                    managerSpeakCount++;
                                    console.log(`📊 [狀態機] 部門主管已提出第 ${managerSpeakCount} 個問題`);
                                }

                                // 🔄 HR 交棒給主管 (融合你的 HANDOVER 防護與組員的 3 秒過場)
                                if (role === 'HR' && isHRWrappingUp && currentInterviewer === 'HR') {
                                    if (finalSentence.includes('部門主管') || finalSentence.includes('交給')) {
                                        console.log('🔄 [權限切換] HR 唸出交接台詞，準備交接給：部門主管');
                                        currentInterviewer = 'HANDOVER'; // 鎖住麥克風防干擾
                                        isHRWrappingUp = false;
                                        setTimeout(() => {
                                            currentInterviewer = 'MANAGER';
                                            if (managerWs && managerWs.readyState === WebSocket.OPEN) {
                                                managerWs.send(JSON.stringify({ realtimeInput: { text: `[系統指令] HR 已經交棒給你了。請立刻開口提出你的第 1 個技術問題。` } }));
                                            }
                                        }, 3000);
                                    }
                                }

                                // 🔄 主管交還給 HR
                                if (role === 'MANAGER' && isManagerWrappingUp && currentInterviewer === 'MANAGER') {
                                    if (finalSentence.includes('交還') || finalSentence.includes('人資')) {
                                        console.log('🔄 [權限切換] 部門主管唸出交接台詞，準備交還給：人資');
                                        currentInterviewer = 'HANDOVER'; // 鎖住麥克風防干擾
                                        isManagerWrappingUp = false;
                                        setTimeout(() => {
                                            currentInterviewer = 'HR';
                                            if (hrWs && hrWs.readyState === WebSocket.OPEN) {
                                                hrWs.send(JSON.stringify({ realtimeInput: { text: `[系統指令] 部門主管已交還給你。請直接做面試結語，結語務必包含「今天的面試就到這邊結束，請按下結束面試按鈕」。絕對不可再問任何問題。` } }));
                                            }
                                        }, 3000);
                                    }
                                }

                                if (role === 'HR' && currentInterviewer === 'HR' && finalSentence.includes('結束面試按鈕')) {
                                    console.log('🏁 [流程控制] HR 已宣告面試結束');
                                    isInterviewEnded = true;
                                    clientWs.send(JSON.stringify({ customType: 'force_end_interview' }));
                                }
                            }
                        }
                        if (role === 'HR') hrSpeechBuffer = ""; else managerSpeechBuffer = "";
                    }, 1000);

                    if (role === 'HR') hrFlushTimeout = newTimeout; else managerFlushTimeout = newTimeout;
                }

                if (response.serverContent?.inputTranscription && currentInterviewer === role) {
                    let userText = convert(response.serverContent.inputTranscription.text).replace(/\s+/g, '');
                    userText = userText.replace(/^[,，]+/, '').replace(/[,，]{2,}/g, '，');
                    addLog("user", userText, "speech");
                    const userMsg = JSON.stringify({ customType: 'user_transcript', text: userText });
                    wss.clients.forEach(c => { 
                        if (c.readyState === WebSocket.OPEN && c.sessionId === currentSessionId) c.send(userMsg); 
                    });

                    // 🎯 只要達標，觸發組員寫的交接函數
                    if (role === 'HR' && hrSpeakCount >= hrtargetCount && !isHRWrappingUp) executeHandover('HR');
                    if (role === 'MANAGER' && managerSpeakCount >= managertargetCount && !isManagerWrappingUp) executeHandover('MANAGER');
                }
            };

            hrWs.on('message', (data) => handleAiResponse('HR', data));
            managerWs.on('message', (data) => handleAiResponse('MANAGER', data));
        };

        clientWs.on('message', async (msg) => {
            try {
                const parsedMsg = JSON.parse(msg.toString());

                // 🌟 【綁定房號】：把 sessionId 貼到這個連線物件上
                if (parsedMsg.sessionId) {
                    clientWs.sessionId = parsedMsg.sessionId;
                }

                // ==========================================
                // 🌟 你的核心：攔截並轉發 WebRTC (戰情室專用)
                // ==========================================
                if (parsedMsg.type === 'webrtc_offer' || 
                    parsedMsg.type === 'webrtc_answer' || 
                    parsedMsg.type === 'webrtc_ice_candidate' ||
                    parsedMsg.type === 'human_hr_joined') {
                    
                    console.log(`📡 [WebRTC] 房號 [${parsedMsg.sessionId}] 轉發訊號: ${parsedMsg.type}`);
                    wss.clients.forEach(client => {
                        if (client !== clientWs && client.readyState === WebSocket.OPEN && client.sessionId === parsedMsg.sessionId) { 
                            client.send(msg.toString());
                        }
                    });
                    return; 
                }

                // ==========================================
                // 🌟 新增：戰情室「真人插話」控制指令攔截
                // ==========================================
                // ==========================================
                // 🌟 修改：戰情室「真人插話」廣播 (只負責傳令給求職者)
                // ==========================================
                if (parsedMsg.type === 'pause_ai') {
                    console.log(`⏸️ [戰情室指令] 廣播暫停訊號...`);
                    wss.clients.forEach(c => { 
                        if (c.readyState === WebSocket.OPEN && c.sessionId === parsedMsg.sessionId) {
                            c.send(JSON.stringify({ customType: 'kill_ai_audio' }));
                        }
                    });
                    return;
                }

                if (parsedMsg.type === 'resume_ai') {
                    console.log(`▶️ [戰情室指令] 廣播恢復訊號...`);
                    wss.clients.forEach(c => { 
                        if (c.readyState === WebSocket.OPEN && c.sessionId === parsedMsg.sessionId) {
                            c.send(JSON.stringify({ customType: 'resume_ai_audio' }));
                        }
                    });
                    return;
                }

                // ==========================================
                // 🌟 新增：求職者專屬連線接收端 (真正在後端拔掉 AI 網路線的地方)
                // ==========================================
                if (parsedMsg.customType === 'execute_backend_pause') {
                    console.log(`🛑 [求職者連線] 真正執行：封印 AI 的聽覺與嘴巴`);
                    
                    if (currentInterviewer !== 'HANDOVER' && currentInterviewer !== 'HUMAN_INTERVENING') {
                        previousInterviewer = currentInterviewer;
                    }
                    currentInterviewer = 'HUMAN_INTERVENING'; // 🌟 這行生效後，求職者的麥克風就不會再傳給 Gemini 了！
                    
                    // 發送待機指令給 Gemini
                    const stopMsg = JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text: `[系統強制指令] 真人面試官現在要親自插話。請你立刻停止發言，並進入待機狀態。` }] }], turnComplete: true } });
                    if (previousInterviewer === 'HR' && hrWs && hrWs.readyState === WebSocket.OPEN) hrWs.send(stopMsg);
                    if (previousInterviewer === 'MANAGER' && managerWs && managerWs.readyState === WebSocket.OPEN) managerWs.send(stopMsg);
                    return;
                }

                if (parsedMsg.customType === 'execute_backend_resume') {
                    console.log(`▶️ [求職者連線] 真正執行：解開 AI 的封印`);
                    currentInterviewer = previousInterviewer; 
                    
                    // 喚醒 Gemini 繼續面試
                    const resumeMsg = JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text: `[系統指令] 真人面試官已結束插話對話。請你直接繼續你原本的面試流程，提出下一個問題。` }] }], turnComplete: true } });
                    if (currentInterviewer === 'HR' && hrWs && hrWs.readyState === WebSocket.OPEN) hrWs.send(resumeMsg);
                    if (currentInterviewer === 'MANAGER' && managerWs && managerWs.readyState === WebSocket.OPEN) managerWs.send(resumeMsg);
                    return;
                }
                // ==========================================
                // 🌟 新增：接收應徵者在「暫停期間」講的話 (備用打字員傳來的)
                // ==========================================
                if (parsedMsg.customType === 'user_human_speech') {
                    console.log(`🎤 [應徵者插話文字] ${parsedMsg.text}`);
                    
                    const textMsg = JSON.stringify({ 
                        customType: 'user_transcript', 
                        text: parsedMsg.text 
                    });
                    
                    // 廣播給所有人 (戰情室跟應徵者的對話框都會出現)
                    wss.clients.forEach(c => {
                        if (c.readyState === WebSocket.OPEN && c.sessionId === parsedMsg.sessionId) {
                            c.send(textMsg);
                        }
                    });
                    
                    // 存入資料庫紀錄
                    addLog("user", parsedMsg.text, "speech");
                    return;
                }

                // ==========================================
                // 🌟 新增：接收戰情室傳來的「真人語音轉文字」，並廣播到對話紀錄！
                // ==========================================
                if (parsedMsg.type === 'hr_human_speech') {
                    console.log(`🎤 [真人插話文字] ${parsedMsg.text}`);
                    // 偽裝成 AI 的格式，這樣前端現有的對話框渲染器就能直接把它畫出來
                    const textMsg = JSON.stringify({ 
                        customType: 'ai_transcript_final', 
                        ai_role: '真人HR', 
                        text: parsedMsg.text 
                    });
                    
                    // 廣播給這個房號裡的所有人 (求職者端跟戰情室都會收到)
                    wss.clients.forEach(c => {
                        if (c.readyState === WebSocket.OPEN && c.sessionId === parsedMsg.sessionId) {
                            c.send(textMsg);
                        }
                    });
                    
                    // 偷偷把真人的對話紀錄存進資料庫用的陣列裡 (確保最後生報告時有這段紀錄)
                    addLog("human_HR", parsedMsg.text, "speech");
                    return;
                }

                if (parsedMsg.customType === 'init_interview') {
                    currentSessionId = parsedMsg.sessionId;
                    // 加入動態題數設定 (預設每人問 2 題)
                    const { resumeId, position, interview_type, questionCount = 2, jobId } = parsedMsg;
                    
                    hrtargetCount = questionCount;
                    managertargetCount = questionCount;

                    // 🌟 你補上的關鍵狀態： status: '進行中'
                    await supabase.from('interview_sessions').update({ 
                        applied_position: position, 
                        interview_type: interview_type, 
                        resume_id: resumeId,
                        status: '進行中' 
                    }).eq('session_id', currentSessionId);

                    let resumeText = "無資料";
                    const { data: resumeData } = await supabase.from('resumes').select('*').eq('resume_id', resumeId).single();
                    if (resumeData) resumeText = `學歷：${resumeData.education}\n經歷：${resumeData.work_experience}`;

                    // 🌟 你的職缺詳情抓取邏輯
                    let jobDetailsText = "無特定職缺資料";
                    if (jobId) {
                        const { data: jobData, error: jobErr } = await supabase.from('jobs').select('job_description, requirements').eq('job_id', jobId).single();
                        if (jobData && !jobErr) jobDetailsText = `【工作內容】：\n${jobData.job_description}\n\n【條件要求】：\n${jobData.requirements}`;
                    }

                    startGeminiConnections(resumeText, position, interview_type, jobDetailsText);
                    return;
                }

                if (parsedMsg.client_content || parsedMsg.customType === 'window_switch') {
                    if (currentInterviewer === 'HANDOVER') return;
                    const gentlePrompt = `[系統強制指令] 系統偵測到應徵者剛剛切換了視窗。請你用友善語氣，簡單說一句：「小提醒喔，面試的時候請盡量讓畫面停留在我們的視窗」，然後直接繼續你原本要問的問題。`;
                    const warningMessage = JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text: gentlePrompt }] }], turnComplete: true } });
                    if (currentInterviewer === 'HR' && hrWs && hrWs.readyState === WebSocket.OPEN) hrWs.send(warningMessage);
                    else if (currentInterviewer === 'MANAGER' && managerWs && managerWs.readyState === WebSocket.OPEN) managerWs.send(warningMessage);
                    return;
                }

                if (parsedMsg.realtimeInput) {
                    // 🌟 關鍵修改：加上 currentInterviewer === 'HUMAN_INTERVENING'，讓 AI 暫時變成聾子！
                    if (isInterviewEnded || currentInterviewer === 'HANDOVER' || currentInterviewer === 'HUMAN_INTERVENING' || isAiSpeaking) return;

                    if (currentInterviewer === 'HR' && hrWs && hrWs.readyState === WebSocket.OPEN) hrWs.send(msg.toString());
                    else if (currentInterviewer === 'MANAGER' && managerWs && managerWs.readyState === WebSocket.OPEN) managerWs.send(msg.toString());
                }
            } catch (e) { 
                // 忽略解析錯誤
            }
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