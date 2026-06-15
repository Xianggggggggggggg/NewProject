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
        console.log('\n🟢 [前端] 已連線 (目前測試版本：AI 自主算題數 + 完美交接防打斷版 + WebRTC 真人連線)');

        let currentSessionId = null;
        let interviewData = { transcript: [] };

        // 🌟 核心控制變數
        let currentInterviewer = 'HR';
        let isInterviewEnded = false;
        let isAiSpeaking = false; // 🛡️ 核心防禦：記錄 AI 是否正在發言

        // 🎯 交接狀態鎖 (防止重複觸發交接)
        let hasHandedOverToManager = false;
        let hasHandedOverToHR = false;

        let hrWs = null;
        let managerWs = null;

        let hrSpeechBuffer = "";
        let managerSpeechBuffer = "";
        let hrFlushTimeout = null;
        let managerFlushTimeout = null;

        // ⚠️ 保留計數器印出 Log 方便觀測，但後端不再基於此發送強制指令
        let hrSpeakCount = 0;
        let managerSpeakCount = 0;

        const addLog = (role, text, type = "speech") => {
            if (!text || text.trim().length === 0) return;
            interviewData.transcript.push({ timestamp: new Date().toISOString(), role: role, type: type, content: text });
        };

        const saveToDatabase = async () => {
            try {
                if (!currentSessionId) return;

                // 🌟 修正 1：不管有沒有對話紀錄，先無條件把狀態改成「已結束」！
                const { error: updateErr } = await supabase.from('interview_sessions')
                    .update({ status: '已結束', end_time: new Date().toISOString() })
                    .eq('session_id', currentSessionId);
                
                if (updateErr) throw updateErr;

                // 🌟 修正 2：再來處理對話紀錄
                const fullConversationLog = interviewData.transcript
                    .filter(item => item.type === "speech")
                    .map(item => {
                        let speakerName = '應徵者';
                        if (item.role === 'ai_HR') speakerName = 'HR 面試官';
                        if (item.role === 'ai_MANAGER') speakerName = '部門主管';
                        return `${speakerName}：${item.content}`;
                    })
                    .join('\n\n');

                // 如果真的沒有講到話，就停在這裡，不要寫入 transcripts 表
                if (!fullConversationLog) {
                    console.log(`✅ 面試已標記結束 (無對話紀錄)`);
                    return; 
                }

                const { error: insertErr } = await supabase.from('transcripts')
                    .insert([{ session_id: currentSessionId, speaker: 'FULL_CONVERSATION', text_content: fullConversationLog, created_at: new Date().toISOString() }]);
                if (insertErr) throw insertErr;

                console.log(`✅ 面試已完美存檔 (含對話紀錄)`);
            } catch (err) { 
                console.error('❌ 寫入資料庫失敗:', err.message); 
            }
        };

        targetCount = 3;
        // 修改函數簽名，接受 targetCount 與 jobDetailsText
        const startGeminiConnections = (resumeText, position, interview_type, targetCount, jobDetailsText) => {

            // 🌟 將控制權完全還給 AI，用劇本指導它自己算題數，並加入負面提示詞
            const hrPrompt = `
                你現在正與「部門主管」共同面試一位應徵「${position}」的候選人。
                【人格設定】：你是資深 HR 面試官。語氣專業、親切。
                
                【🚨 面試流程與嚴格提問限制 (請你在心裡默默計數)】：
                1. 【開場】：熱情歡迎應徵者，並請他簡單自我介紹。
                2. 【提問階段】：聽完介紹後，只能提出「軟實力與行為面試問題 (Behavioral Questions)」，例如：團隊合作、溝通協調、壓力處理、或解決困難的經驗。
                3. 【提問額度】：你總共只能問【 ${targetCount} 】個問題！這非常重要！
                4. 【🚨強制交接🚨】：當你問完第 ${targetCount} 個問題，並且聽完應徵者的回答後，你【絕對不可以】再提問或給回饋！請立刻、直接唸出下方的交接標準台詞。
                
                【交接標準台詞】：
                「了解，謝謝你的分享。接下來的技術與專業問題，我想交給部門主管來瞭解。」
                
                【系統限制】：每次發言只能問一個問題。絕對不要輸出任何「(動作描述)」。你的對話對象只有應徵者。
                應徵者履歷：\n${resumeText}
                本職缺詳細需求：\n${jobDetailsText}
                `;

            const managerPrompt = `
                你現在正與「HR(人資)」共同面試一位應徵「${position}」的候選人。面試類型為：${interview_type}
                【人格設定】：你是部門技術主管。語氣嚴謹、實事求是。
                
                【🚨 面試流程與嚴格題數限制 (請你在心裡默默計數)】：
                系統一開始不會給你聲音。當你收到「HR已經交棒給你」的指令時，代表輪到你面試了。
                1. 【提問階段】：每次發言【只能問 1 個問題】。請緊扣職缺需求與履歷提問專業技術問題。
                2. 【提問額度】：你總共只能問【 ${targetCount} 】個問題！這非常重要！
                3. 【🚨強制交接🚨】：當你問完第 ${targetCount} 個問題，並且聽完應徵者的回答後，你【絕對不可以】再提出任何新問題，也【絕對不可以】針對他的回答給予任何技術評價或回饋！
                請你立刻、直接唸出下方的交接標準台詞，絕不允許增加任何其他字句。
                
                【交接標準台詞】：
                「我的部分問完了，交還給人資。」
                
                【系統限制】：每次發言只能問一個問題。絕對不要輸出任何「(動作描述)」。你的對話對象只有應徵者。
                應徵者履歷資料：\n${resumeText}
                本職缺詳細需求：\n${jobDetailsText}
            `;

            hrWs = new WebSocket(GEMINI_WS_URL);
            hrWs.on('open', () => hrWs.send(JSON.stringify({ setup: { model: MODEL_NAME, systemInstruction: { parts: [{ text: hrPrompt }] }, generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } } }, realtime_input_config: { automatic_activity_detection: { silence_duration_ms: 3000 } } } })));

            managerWs = new WebSocket(GEMINI_WS_URL);
            managerWs.on('open', () => managerWs.send(JSON.stringify({ setup: { model: MODEL_NAME, systemInstruction: { parts: [{ text: managerPrompt }] }, generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } } }, realtime_input_config: { automatic_activity_detection: { silence_duration_ms: 3000 } } } })));

            const handleAiResponse = (role, data) => {
                const response = JSON.parse(data.toString());

                if (response.setupComplete && role === 'HR') {
                    clientWs.send(JSON.stringify({ setupComplete: true }));
                    isAiSpeaking = true;
                    hrWs.send(JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text: `[系統指令] 面試正式開始。請立刻用語音進行開場歡迎，並請應徵者自我介紹。` }] }], turnComplete: true } }));
                }

                if (response.serverContent?.modelTurn?.parts && currentInterviewer === role) {
                    isAiSpeaking = true;
                    const audioData = JSON.parse(data.toString());
                    audioData.ai_role = role;
                    clientWs.send(JSON.stringify(audioData));
                }

                if (response.serverContent?.turnComplete) {
                    isAiSpeaking = false;
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
                                console.log(`🛡️ [系統攔截] 成功阻擋 ${role} 的內心獨白: ${finalSentence}`);
                            } else {
                                addLog(`ai_${role}`, finalSentence, "speech");
                                if (currentInterviewer === role) clientWs.send(JSON.stringify({ customType: 'ai_transcript_final', ai_role: role, text: finalSentence }));

                                // 🎯 單純印出 Log 觀測 AI 的自主提問次數，後端不再做任何強制干預
                                const isRealQuestion = (finalSentence.includes('？') || finalSentence.includes('?')) && finalSentence.length > 10;
                                if (role === 'HR' && currentInterviewer === 'HR' && isRealQuestion) {
                                    hrSpeakCount++;
                                    console.log(`📊 [觀測記錄] AI(HR) 自己決定問了第 ${hrSpeakCount} 個問題`);
                                }
                                if (role === 'MANAGER' && currentInterviewer === 'MANAGER' && isRealQuestion) {
                                    managerSpeakCount++;
                                    console.log(`📊 [觀測記錄] AI(主管) 自己決定問了第 ${managerSpeakCount} 個問題`);
                                }

                                // 🔄 當 AI 自主講出交接台詞時，後端執行麥克風切換與歷史紀錄打包
                                const isHandoverToManager = finalSentence.includes('交給') && finalSentence.includes('主管');
                                const isHandoverToHR = (finalSentence.includes('交還') || finalSentence.includes('交給')) && finalSentence.includes('人資');

                                if (role === 'HR' && currentInterviewer === 'HR' && isHandoverToManager && !hasHandedOverToManager) {
                                    hasHandedOverToManager = true;
                                    currentInterviewer = 'HANDOVER';
                                    const delayTime = 1000; // 1秒過場

                                    setTimeout(() => {
                                        currentInterviewer = 'MANAGER';
                                        isAiSpeaking = true;

                                        const recentHistory = interviewData.transcript.slice(-6).map(t => {
                                            let speaker = '應徵者';
                                            if (t.role === 'ai_HR') speaker = 'HR 面試官';
                                            if (t.role === 'ai_MANAGER') speaker = '部門主管';
                                            return `${speaker}: ${t.content}`;
                                        }).join('\n');

                                        const promptToManager = `[系統強制指令] HR 已交棒給你。以下是剛才的對話紀錄：\n\n${recentHistory}\n\n請立刻用語音開口，對應徵者提出你的第 1 個專業技術問題！絕對不能只輸出文字。`;

                                        if (managerWs && managerWs.readyState === WebSocket.OPEN) {
                                            managerWs.send(JSON.stringify({ realtimeInput: { text: promptToManager } }));
                                        }
                                    }, delayTime);
                                }
                                else if (role === 'MANAGER' && currentInterviewer === 'MANAGER' && isHandoverToHR && !hasHandedOverToHR) {
                                    hasHandedOverToHR = true;
                                    currentInterviewer = 'HANDOVER';
                                    const delayTime = 1000; // 1秒過場

                                    setTimeout(() => {
                                        currentInterviewer = 'HR';
                                        isAiSpeaking = true;

                                        const recentHistory = interviewData.transcript.slice(-6).map(t => {
                                            let speaker = '應徵者';
                                            if (t.role === 'ai_HR') speaker = 'HR 面試官';
                                            if (t.role === 'ai_MANAGER') speaker = '部門主管';
                                            return `${speaker}: ${t.content}`;
                                        }).join('\n');

                                        const promptToHR = `[系統強制指令] 部門主管已將時間交還給你。以下是剛才的對話：\n\n${recentHistory}\n\n請立刻用語音做面試結語，務必包含「今天的面試就到這邊結束，請按下結束面試按鈕」。絕對不可再問任何問題。`;

                                        if (hrWs && hrWs.readyState === WebSocket.OPEN) {
                                            hrWs.send(JSON.stringify({ realtimeInput: { text: promptToHR } }));
                                        }
                                    }, delayTime);
                                }

                                if (role === 'HR' && currentInterviewer === 'HR' && finalSentence.includes('結束面試按鈕')) {
                                    isInterviewEnded = true;
                                }
                            }
                        }
                        if (role === 'HR') hrSpeechBuffer = ""; else managerSpeechBuffer = "";
                    }, 2500);

                    if (role === 'HR') hrFlushTimeout = newTimeout; else managerFlushTimeout = newTimeout;
                }

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

                // 🌟 【綁定房號】：當收到初始化或 HR 加入的訊號時，把 sessionId 貼到這個連線物件上
                if (parsedMsg.sessionId) {
                    clientWs.sessionId = parsedMsg.sessionId;
                }

                // ==========================================
                // 🌟 新增：攔截並轉發 WebRTC (精準包廂制)
                // ==========================================
                if (parsedMsg.type === 'webrtc_offer' || 
                    parsedMsg.type === 'webrtc_answer' || 
                    parsedMsg.type === 'webrtc_ice_candidate' ||
                    parsedMsg.type === 'human_hr_joined') {
                    
                    console.log(`📡 [WebRTC] 房號 [${parsedMsg.sessionId}] 轉發訊號: ${parsedMsg.type}`);
                    
                    // 🎯 核心關鍵：只轉發給「同一個 session_id」的連線者！
                    wss.clients.forEach(client => {
                        if (client !== clientWs && 
                            client.readyState === WebSocket.OPEN && 
                            client.sessionId === parsedMsg.sessionId) { // 👈 檢查房號
                            client.send(msg.toString());
                        }
                    });
                    
                    return; // ⚠️ 轉發完立刻結束
                }
                // ==========================================

                // 👇 這裡開始接續你原本的邏輯
                if (parsedMsg.customType === 'init_interview') {
                    currentSessionId = parsedMsg.sessionId;
                    // 預設給予 2 題，若前端有傳遞則覆蓋
                    const { resumeId, position, interview_type, questionCount = 2, jobId } = parsedMsg;

                    await supabase.from('interview_sessions').update({ applied_position: position, interview_type: interview_type, resume_id: resumeId }).eq('session_id', currentSessionId);

                    let resumeText = "無資料";
                    const { data: resumeData } = await supabase.from('resumes').select('*').eq('resume_id', resumeId).single();
                    if (resumeData) resumeText = `學歷：${resumeData.education}\n經歷：${resumeData.work_experience}`;

                    let jobDetailsText = "無特定職缺資料";
                    if (jobId) {
                        const { data: jobData, error: jobErr } = await supabase.from('jobs').select('job_description, requirements').eq('job_id', jobId).single();
                        if (jobData && !jobErr) jobDetailsText = `【工作內容】：\n${jobData.job_description}\n\n【條件要求】：\n${jobData.requirements}`;
                    }

                    // 將題數與職缺資料帶入連線設定中
                    startGeminiConnections(resumeText, position, interview_type, questionCount, jobDetailsText);
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
                    if (isInterviewEnded || currentInterviewer === 'HANDOVER' || isAiSpeaking) {
                        return;
                    }

                    if (currentInterviewer === 'HR' && hrWs && hrWs.readyState === WebSocket.OPEN) hrWs.send(msg.toString());
                    else if (currentInterviewer === 'MANAGER' && managerWs && managerWs.readyState === WebSocket.OPEN) managerWs.send(msg.toString());
                }
            } catch (e) { 
                // 忽略解析錯誤或非 JSON 的封包
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