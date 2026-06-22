// ================= 1. 辨識閾值與數據設定 =================
const EAR_THRESHOLD = 0.20;
const SMILE_THRESHOLD = 1.45;
const FROWN_THRESHOLD = 0.015;

// 全域錯誤處理 - 捕獲 WebGL 相關錯誤
window.addEventListener('error', (event) => {
    if (event.error && event.error.message && event.error.message.includes('WebGL')) {
        console.warn('⚠️ 偵測到 WebGL 錯誤，臉部偵測功能將被停用');
        faceMesh = null;
        event.preventDefault();
    }
});

window.addEventListener('unhandledrejection', (event) => {
    if (event.reason && event.reason.message && event.reason.message.includes('WebGL')) {
        console.warn('⚠️ 偵測到未處理的 WebGL 錯誤，臉部偵測功能將被停用');
        faceMesh = null;
        event.preventDefault();
    }
});

// 🌟 傳給 app.js 儲存的數據核心
window.interviewSessionData = {
    total_frames: 0, blink_count: 0, happy_frames: 0, neutral_frames: 0,
    sad_frames: 0, emotion_joy: 0, emotion_neutral: 0, emotion_anxiety: 0,
    eye_contact_rate: 0.85, confidence_score: 100
};

// ================= 2. Gemini & WebRTC 通訊變數 =================
let ws;
let audioContext;
let processor;
let isSetupComplete = false;
let nextPlayTime = 0;
let activeSources = [];
let avatarMesh = null; 
let aiModelElement = null;
let iceCandidateQueue = []; // 新增：路徑排隊區

// 🌟 WebRTC 專屬變數 (新增)
let peerConnection;
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

window.isVisualMonitorRunning = false;
window.lastSpeakEndTime = 0; 

// 聲音播放排班表 (時間軸佇列)
window.audioAnimationQueue = [];              
window.facialMeshesMap = {};                  

let faceMesh = null;
let cameraUtil = null;
let isEyeClosed = false;

// 🎬 C. 雙面試官接力賽與對嘴排程狀態
let currentSpeakerId = null;                  
window.currentAiRole = 'HR';                  
window.currentInterviewStage = 'HR_OPENING';  

let tabSwitchCount = 0;
let cheatWarningDiv = null;
let isCheatReporting = false;

// 🌟 D. 對嘴動畫專用計數器
let mouthFrameCount = 0;                      
let currentMouthStrength = 0;                 

document.addEventListener('DOMContentLoaded', () => {
    ['aiModel_HR', 'aiModel_Tech'].forEach(id => {
        const model = document.getElementById(id);
        if (!model) return;

        model.addEventListener('load', () => {
            console.log(`📦 [系統] 模型 ${id} 真正載入完成！強制沖刷舊快取...`);
            if (window.facialMeshesMap) {
                window.facialMeshesMap[id] = []; 
            }
        });
    });
});

// ================= 3. 核心計算工具 =================
function calcDistance(p1, p2) { return Math.hypot(p1.x - p2.x, p1.y - p2.y); }

function calculateEAR(landmarks, eyeIndices) {
    const p1 = landmarks[eyeIndices[0]], p2 = landmarks[eyeIndices[1]];
    const p3 = landmarks[eyeIndices[2]], p4 = landmarks[eyeIndices[3]];
    const p5 = landmarks[eyeIndices[4]], p6 = landmarks[eyeIndices[5]];
    return (calcDistance(p2, p6) + calcDistance(p3, p5)) / (2.0 * calcDistance(p1, p4));
}

function calculateSmile(landmarks) {
    const mouthWidth = calcDistance(landmarks[61], landmarks[291]);
    const eyeDist = calcDistance(landmarks[133], landmarks[362]);
    return eyeDist !== 0 ? (mouthWidth / eyeDist) : 0;
}

function calculateFrown(landmarks) {
    return ((landmarks[61].y + landmarks[291].y) / 2.0) - landmarks[14].y;
}

// ================= 4. MediaPipe 初始化 =================
function setupFaceMesh() {
    if (faceMesh) return;

    function checkWebGLSupport() {
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            return !!gl;
        } catch (e) {
            return false;
        }
    }

    if (!checkWebGLSupport()) {
        console.warn('⚠️ 瀏覽器不支援 WebGL，臉部偵測功能將被停用');
        return;
    }

    try {
        faceMesh = new FaceMesh({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });

        faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });
    } catch (error) {
        console.error('❌ 初始化 FaceMesh 失敗:', error);
        return;
    }

    let no_face_counter = 0;

    faceMesh.onResults((results) => {
        if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
            no_face_counter++;
            if (no_face_counter % 30 === 0) {
                console.warn("⚠️ AI 正在運行，但畫面中找不到臉！");
            }
            return;
        }
        no_face_counter = 0;

        const landmarks = results.multiFaceLandmarks[0];
        const data = window.interviewSessionData;

        data.total_frames++;

        const smile_ratio = calculateSmile(landmarks);
        const frown_score = calculateFrown(landmarks);
        const left_ear = calculateEAR(landmarks, [33, 160, 158, 133, 153, 144]);
        const right_ear = calculateEAR(landmarks, [362, 385, 387, 263, 373, 380]);
        const avg_ear = (left_ear + right_ear) / 2.0;

        let is_blinking_now = false;
        if (avg_ear < EAR_THRESHOLD) {
            is_blinking_now = true;
            if (!isEyeClosed) {
                data.blink_count++;
                isEyeClosed = true;
            }
        } else {
            isEyeClosed = false;
        }

        let current_frame_emotion = "Neutral (平靜)";
        if (smile_ratio > SMILE_THRESHOLD) {
            data.happy_frames++;
            current_frame_emotion = "Happy (自信/微笑)";
        } else if (frown_score > FROWN_THRESHOLD && smile_ratio <= SMILE_THRESHOLD) {
            data.sad_frames++;
            current_frame_emotion = "Sad (缺乏自信)";
        } else {
            data.neutral_frames++;
        }

        if (is_blinking_now) current_frame_emotion = "Fear (緊張眨眼)";

        if (data.total_frames > 0) {
            const base_joy = (data.happy_frames / data.total_frames) * 1.5;
            const base_sad = (data.sad_frames / data.total_frames) * 1.5;

            data.emotion_joy = parseFloat(Math.min(1.0, base_joy).toFixed(2));
            data.emotion_anxiety = parseFloat(Math.min(1.0, base_sad).toFixed(2));
            data.emotion_neutral = parseFloat(Math.max(0, 1.0 - data.emotion_joy - data.emotion_anxiety).toFixed(2));

            let score = 100 - (data.emotion_anxiety * 80) - (data.blink_count * 0.5);
            data.confidence_score = Math.max(0, Math.min(100, Math.round(score)));

            if (data.emotion_anxiety > 0.2 || data.blink_count > 30) {
                data.ai_feedback = "偵測到您在過程中顯露較多緊張，建議深呼吸。";
            } else if (data.emotion_joy > 0.3) {
                data.ai_feedback = "表現非常自信，笑容具感染力！";
            } else {
                data.ai_feedback = "整體表現平穩專業。";
            }
        }

        if (data.total_frames % 15 === 0) {
            console.log(`%c[即時偵測] %c${current_frame_emotion} %c| 總分:${data.confidence_score} | EAR:${avg_ear.toFixed(3)}`,
                "color: #aaa;",
                current_frame_emotion.includes("Happy") ? "color: #e6c200; font-weight: bold;" :
                current_frame_emotion.includes("Sad") ? "color: #e74c3c; font-weight: bold;" : "color: #2ecc71;",
                "color: #fff;"
            );
        }
    });
}

// ================= 5. Gemini 語音與 UI 處理工具 =================
function appendTranscript(role, text, ai_role = 'HR') {
    if (!text.trim()) return;
    const box = document.getElementById('transcriptBox');

    const msgDiv = document.createElement('div');
    msgDiv.className = role === 'ai' ? 'ai-msg' : 'user-msg';

    msgDiv.style.margin = "10px 0";
    msgDiv.style.padding = "10px";
    msgDiv.style.borderRadius = "8px";

    if (role === 'ai') {
        if (ai_role === 'HR') {
            msgDiv.style.backgroundColor = "#f0f0f0"; 
            msgDiv.style.color = "#333";
            msgDiv.innerText = '👩‍💼 人資 (HR)：\n' + text;
        } else {
            msgDiv.style.backgroundColor = "#ffebee"; 
            msgDiv.style.color = "#c62828";
            msgDiv.innerText = '👨‍💻 部門主管：\n' + text;
        }
        msgDiv.style.textAlign = "left";
    } else {
        msgDiv.style.backgroundColor = "#e8f0fe"; 
        msgDiv.style.color = "#1a73e8";
        msgDiv.style.textAlign = "right";
        msgDiv.innerText = '👤 你：\n' + text;
    }

    box.appendChild(msgDiv);
    box.scrollTop = box.scrollHeight;
}

window.isAIPaused = false; // 🌟 新增：全域暫停標記

function stopAllAudio() {
    activeSources.forEach(source => { try { source.stop(); } catch (e) { } });
    activeSources = [];
    
    window.audioAnimationQueue = []; // 🌟 核心：徹底清空對嘴動畫的排隊區！
    if (audioContext) nextPlayTime = audioContext.currentTime;

    // 瞬間強制關閉正在動嘴巴的影片
    const talkTech = document.getElementById('talkVideo_Tech');
    const talkHR = document.getElementById('talkVideo_HR');
    if (talkTech) talkTech.classList.remove('active');
    if (talkHR) talkHR.classList.remove('active');
}

function initAntiCheatSystem() {
    cheatWarningDiv = document.createElement('div');
    cheatWarningDiv.style.position = 'fixed';
    cheatWarningDiv.style.top = '20px';
    cheatWarningDiv.style.left = '50%';
    cheatWarningDiv.style.transform = 'translateX(-50%)';
    cheatWarningDiv.style.backgroundColor = 'rgba(255, 0, 0, 0.9)';
    cheatWarningDiv.style.color = 'white';
    cheatWarningDiv.style.padding = '15px 30px';
    cheatWarningDiv.style.borderRadius = '8px';
    cheatWarningDiv.style.fontWeight = 'bold';
    cheatWarningDiv.style.fontSize = '20px';
    cheatWarningDiv.style.zIndex = '9999';
    cheatWarningDiv.style.boxShadow = '0 4px 15px rgba(0,0,0,0.3)';
    cheatWarningDiv.style.display = 'none';
    cheatWarningDiv.style.pointerEvents = 'none';
    document.body.appendChild(cheatWarningDiv);

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            handleCheatEvent('切換分頁 / 最小化視窗');
        }
    });

    window.addEventListener('blur', () => {
        handleCheatEvent('點擊了其他視窗');
    });
}

function handleCheatEvent(reason) {
    tabSwitchCount++;

    if (cheatWarningDiv) {
        cheatWarningDiv.innerText = `⚠️ 系統警告：偵測到 ${reason}！ (違規 ${tabSwitchCount} 次)`;
        cheatWarningDiv.style.display = 'block';
        setTimeout(() => { cheatWarningDiv.style.display = 'none'; }, 3500);
    }

    const currentRole = window.currentAiRole || '面試官';

    if (ws && ws.readyState === WebSocket.OPEN) {
        if (!isCheatReporting) {
            isCheatReporting = true;

            const googleLiveMessage = {
                client_content: {
                    turns: [{
                        role: "user",
                        parts: [{
                            text: `[系統通知：應徵者剛剛切換分頁作弊了！] 
                            現在你是 ${currentRole}，請立刻中斷所有話題，
                            用非常嚴厲且不滿的語氣質問應徵者為什麼要離開畫面？
                            警告他誠信很重要。質問完後，再叫他繼續回答。`
                        }]
                    }],
                    turn_complete: true
                }
            };

            console.log(`🤫 [神經走私] 已向當前角色 ${currentRole} 告密！`);
            ws.send(JSON.stringify(googleLiveMessage));

            setTimeout(() => { isCheatReporting = false; }, 15000);
        }
    }
}

async function playAudio(base64Data, targetId) {
    try {
        if (!targetId) targetId = 'aiModel_Tech';

        if (!window.audioContext) {
            window.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
        }
        if (window.audioContext.state === 'suspended') await window.audioContext.resume();

        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
        const int16Array = new Int16Array(bytes.buffer);
        
        const audioBuffer = window.audioContext.createBuffer(1, int16Array.length, 24000);
        audioBuffer.getChannelData(0).set(Array.from(int16Array).map(v => v / 32768.0));

        const source = window.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(window.audioContext.destination);
        activeSources.push(source);

        const now = window.audioContext.currentTime;
        if (nextPlayTime < now) nextPlayTime = now;

        window.audioAnimationQueue.push({
            targetId: targetId,
            startTime: nextPlayTime,
            endTime: nextPlayTime + audioBuffer.duration
        });

        window.lastSpeakEndTime = nextPlayTime + audioBuffer.duration + 0.3;

        source.start(nextPlayTime);
        nextPlayTime += audioBuffer.duration;

    } catch (err) {
        console.error("❌ [音訊系統] playAudio 發生錯誤:", err);
    }
}

// ================= 6. 核心啟動函數 =================
async function startInterviewAI() {
    const videoElement = document.getElementById('localVideo');
    const transcriptBox = document.getElementById('transcriptBox');

    // 🌟 將 URL 參數提取拉到最外層，讓 WebRTC 回傳時也能拿到 sessionId
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session_id');
    const resumeId = urlParams.get('resume_id');
    const position = urlParams.get('position');
    const interviewType = urlParams.get('type') || '行為面試';

    console.log("⏳ 正在初始化 FaceMesh 模型...");
    setupFaceMesh();

    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        }
        await audioContext.resume();

        console.log("⏳ 正在請求攝影機與麥克風權限...");
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 },
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });

        videoElement.srcObject = stream;

        videoElement.onloadeddata = async () => {
            await videoElement.play();
            console.log(`✅ 影片畫面準備完畢！解析度: ${videoElement.videoWidth}x${videoElement.videoHeight}`);
            console.log("🚀 啟動自定義 AI 影像傳輸迴圈...");

            let isDetecting = false;
            async function detectionLoop() {
                if (!videoElement.paused && !videoElement.ended && videoElement.videoWidth > 0) {
                    if (!isDetecting && faceMesh) {
                        isDetecting = true;
                        try {
                            await faceMesh.send({ image: videoElement });
                        } catch (err) {
                            console.error("❌ FaceMesh 處理影像時發生錯誤:", err);
                            if (err.message && err.message.includes('WebGL')) {
                                console.warn('⚠️ WebGL 錯誤，臉部偵測功能已停用');
                                faceMesh = null;
                                return;
                            }
                        }
                        isDetecting = false;
                    }
                }
                requestAnimationFrame(detectionLoop);
            }
            detectionLoop();
        };

        const backendUrl = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
            ? 'ws://localhost:3001'
            : `wss://${window.location.host}`;

        ws = new WebSocket(backendUrl);

        ws.onopen = () => {
            console.log("✅ WebSocket 連線成功");
            document.getElementById('transcriptBox').innerHTML = '';
            transcriptBox.innerHTML += '<div class="ai-msg" style="padding:10px; background:#f0f0f0; border-radius:8px;">系統：連線成功，正在讀取履歷資料與生成考題...<br><small style="color:#666;">💡 提示：AI 正在分析您的面部表情與語音，請確保鏡頭清晰。</small></div>';

            if (sessionId && resumeId) {
                ws.send(JSON.stringify({
                    customType: 'init_interview',
                    sessionId: sessionId,
                    resumeId: resumeId,
                    position: position || '未指定',
                    interview_type: interviewType
                }));
                console.log(`🔗 已發送面試初始化資料：職位 [${position}], 類型 [${interviewType}]`);
            } else {
                console.warn("⚠️ 警告：網址列缺乏必要參數！");
            }
        };

        ws.onmessage = async (event) => {
            const data = JSON.parse(event.data);

            // ==========================================
            // 🌟 處理 WebRTC 視訊接收邏輯 (專屬包廂版)
            // ==========================================
            
            // 1. 收到通知：HR 潛入包廂了！
            if (data.type === 'human_hr_joined') {
                console.log("🔔 真人 HR 準備連線！切換畫面...");
                const waitingText = document.getElementById('waiting-text');
                if(waitingText) waitingText.style.display = 'none';
                
                const hrVideo = document.getElementById('remoteHrVideo');
                if(hrVideo) hrVideo.style.display = 'block';
            }

            // 2. 收到企業端的連線邀請 (Offer)
            if (data.type === 'webrtc_offer') {
                peerConnection = new RTCPeerConnection(rtcConfig);

                const localStream = document.getElementById('localVideo').srcObject;
                if (localStream) {
                    localStream.getTracks().forEach(track => {
                        peerConnection.addTrack(track, localStream);
                    });
                }

                // 🌟 暴力解鎖真人聲音：強制播放 + 外掛純聲音播放器
                peerConnection.ontrack = (event) => {
                    console.log("📡 [WebRTC] 收到真人面試官的影音軌道！");
                    const hrVideo = document.getElementById('remoteHrVideo');
                    if(hrVideo) {
                        hrVideo.srcObject = event.streams[0];
                        hrVideo.muted = false;
                        hrVideo.volume = 1.0;
                        hrVideo.play().catch(e => console.warn("影像被阻擋:", e));
                    }

                    let superAudio = document.getElementById('hrSuperAudio');
                    if (!superAudio) {
                        superAudio = document.createElement('audio');
                        superAudio.id = 'hrSuperAudio';
                        superAudio.autoplay = true;
                        document.body.appendChild(superAudio);
                    }
                    superAudio.srcObject = event.streams[0];
                    superAudio.play().catch(e => console.warn("聲音被阻擋:", e));
                };

                peerConnection.onicecandidate = (event) => {
                    if (event.candidate) {
                        ws.send(JSON.stringify({ 
                            type: 'webrtc_ice_candidate', 
                            candidate: event.candidate,
                            sessionId: sessionId 
                        }));
                    }
                };

                // 等待名片讀取完成
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));

                // 將剛剛卡在門外的 ICE 路徑封包全部放行！
                iceCandidateQueue.forEach(c => peerConnection.addIceCandidate(c));
                iceCandidateQueue = [];

                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);

                ws.send(JSON.stringify({ 
                    type: 'webrtc_answer', 
                    answer: answer,
                    sessionId: sessionId 
                }));
            }

            // 3. 接收企業端的網路路徑
            if (data.type === 'webrtc_ice_candidate') {
                if (peerConnection) {
                    // 如果名片還沒讀完，先讓路徑封包去排隊
                    if (peerConnection.remoteDescription) {
                        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                    } else {
                        iceCandidateQueue.push(new RTCIceCandidate(data.candidate));
                    }
                }
            }
            // ==========================================

            if (data.setupComplete) isSetupComplete = true;

            // ==========================================
            // 🌟 攔截指令區：處理戰情室的暫停與恢復
            // ==========================================
            if (data.customType === 'kill_ai_audio') {
                console.log("🛑 [系統] 真人插話，強制中斷 AI 語音！");
                window.isAIPaused = true; // 鎖住接收器
                stopAllAudio();           // 瞬間殺掉所有庫存聲音
            }
            if (data.customType === 'resume_ai_audio') {
                console.log("▶️ [系統] 恢復 AI 語音接收！");
                window.isAIPaused = false; // 解鎖接收器
            }

            if (data.customType === 'user_transcript') {
                appendTranscript('user', data.text);
            }

            if (data.customType === 'ai_transcript_final') {
                const finalRole = data.ai_role || window.currentAiRole || '技術主管';
                appendTranscript('ai', data.text, finalRole);
            }

            if (data.serverContent?.modelTurn?.parts) {
                // 🛑 核心防護網：只要在暫停中，所有 AI 傳來的殘餘聲音通通丟進垃圾桶！
                if (window.isAIPaused) return; 

                window.currentAiRole = data.ai_role || window.currentAiRole || '技術主管';
                
                let roleStr = window.currentAiRole.toUpperCase();
                let targetId = roleStr.includes('HR') ? 'aiModel_HR' : 'aiModel_Tech';

                const checkModel = document.getElementById(targetId);
                if (!checkModel) {
                    console.error(`❌ [偵測失敗] 找不到 "${targetId}"！`);
                }

                for (const part of data.serverContent.modelTurn.parts) {
                    if (part.inlineData && part.inlineData.data) {
                        if (audioContext.state === 'suspended') await audioContext.resume();
                        playAudio(part.inlineData.data, targetId); 
                    }
                }
            }
            
            if (data.serverContent?.interrupted) {
                stopAllAudio();
                window.lastSpeakEndTime = 0;
            }
        };

        processor = audioContext.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (e) => {
            if (ws && ws.readyState === WebSocket.OPEN && isSetupComplete) {
                const inputData = e.inputBuffer.getChannelData(0);
                const pcmData = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 32767;
                }
                const base64Audio = btoa(String.fromCharCode.apply(null, new Uint8Array(pcmData.buffer)));
                
                ws.send(JSON.stringify({
                    realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: base64Audio } }
                }));
            }
        };
        
        const sourceNode = audioContext.createMediaStreamSource(stream);
        sourceNode.connect(processor);
        processor.connect(audioContext.destination);

    } catch (err) {
        console.error("❌ 啟動失敗:", err);
        alert("無法啟動相機或麥克風，請檢查權限設定。");
        if (err.message && err.message.includes('WebGL')) {
            alert("您的瀏覽器可能不支援 WebGL，面試系統將以基本模式運行（無臉部表情分析）。");
        }
    }
}

// ==========================================
// 🎬 2D 影片版全域大腦計時器 (雙面試官專屬 - 無縫疊加版)
// ==========================================

function initGlobalAnimationLoop() {
    const runGlobalLoop = () => {
        const ctx = window.audioContext || (typeof audioContext !== 'undefined' ? audioContext : null);
        const now = ctx ? ctx.currentTime : 0;
        
        const activeTurn = window.audioAnimationQueue.find(item => now >= item.startTime && now <= item.endTime);
        const activeTargetId = activeTurn ? activeTurn.targetId : null;

        window.audioAnimationQueue = window.audioAnimationQueue.filter(item => now <= item.endTime);

        const talkVideoTech = document.getElementById('talkVideo_Tech');
        const talkVideoHR = document.getElementById('talkVideo_HR');

        if (talkVideoTech && talkVideoHR) {
            if (activeTargetId === 'aiModel_Tech') {
                if (!talkVideoTech.classList.contains('active')) {
                    talkVideoTech.currentTime = 0; 
                    talkVideoTech.play().catch(e => console.log(e));
                    talkVideoTech.classList.add('active'); 
                }
                talkVideoHR.classList.remove('active'); 

            } else if (activeTargetId === 'aiModel_HR') {
                if (!talkVideoHR.classList.contains('active')) {
                    talkVideoHR.currentTime = 0;
                    talkVideoHR.play().catch(e => console.log(e));
                    talkVideoHR.classList.add('active'); 
                }
                talkVideoTech.classList.remove('active'); 

            } else {
                talkVideoTech.classList.remove('active');
                talkVideoHR.classList.remove('active');
            }
        }

        requestAnimationFrame(runGlobalLoop);
    };
    
    requestAnimationFrame(runGlobalLoop);
}

initGlobalAnimationLoop();

// ================= 7. 結束處理 =================
async function handleEndInterview() {
    console.log("🚀 正在結束面試並上傳數據...", window.interviewSessionData);

    // 1. 鎖死按鈕與顯示 Loading 畫面
    const endBtn = document.querySelector('.btn-end');
    if (endBtn) {
        endBtn.disabled = true;
        endBtn.innerText = "處理中...";
    }

    const loadingOverlay = document.createElement('div');
    loadingOverlay.id = 'interview-loading-overlay';
    loadingOverlay.style.position = 'fixed';
    loadingOverlay.style.top = '0';
    loadingOverlay.style.left = '0';
    loadingOverlay.style.width = '100vw';
    loadingOverlay.style.height = '100vh';
    loadingOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
    loadingOverlay.style.color = 'white';
    loadingOverlay.style.display = 'flex';
    loadingOverlay.style.flexDirection = 'column';
    loadingOverlay.style.justifyContent = 'center';
    loadingOverlay.style.alignItems = 'center';
    loadingOverlay.style.zIndex = '99999';
    loadingOverlay.innerHTML = `
        <div style="font-size: 50px; margin-bottom: 20px; animation: pulse 1.5s infinite;">⏳</div>
        <h2 style="margin: 0 0 10px 0; color: #1D9E75;">面試已結束！</h2>
        <p style="font-size: 18px; color: #ddd; margin-bottom: 5px;">AI 正在彙整您的面試表現並生成專屬報告...</p>
        <p style="font-size: 14px; color: #888;">(此過程大約需要 10 ~ 20 秒，請勿關閉視窗)</p>
    `;
    const style = document.createElement('style');
    style.innerHTML = `@keyframes pulse { 0% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(1.1); } 100% { opacity: 1; transform: scale(1); } }`;
    document.head.appendChild(style);
    document.body.appendChild(loadingOverlay);

    // 2. 關閉視訊與錄音資源
    if (ws) ws.close();
    if (audioContext) audioContext.close();
    if (cameraUtil) cameraUtil.stop();

    // 3. 開始傳送數據給後端 (最重要的部分！)
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const sessionId = urlParams.get('session_id');

        if (sessionId) {
            console.log("⏳ 正在準備上傳數據...");
            const transcriptText = document.getElementById('transcriptBox')?.innerText || "";

            try {
                const ed = window.interviewSessionData;
                let finalEmotion = "平穩"; 
                if (ed.happy_frames > ed.neutral_frames && ed.happy_frames > ed.sad_frames) {
                    finalEmotion = "自信/喜悅";
                } else if (ed.sad_frames > ed.neutral_frames && ed.sad_frames > ed.happy_frames) {
                    finalEmotion = "緊張/焦慮";
                }

                await fetch('/api/log-emotion', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        session_id: sessionId,
                        timestamp_mark: "面試總結", 
                        emotion: finalEmotion,     
                        focus_score: Math.round(ed.confidence_score || 0)
                    })
                });
            } catch (logErr) {
                console.error("⚠️ emotion_log 寫入失敗:", logErr);
            }

            console.log("⏳ 正在請求後端生成 AI 評分報告 (包含表情與誠信查核)...");
            const res = await fetch(`/api/generate-report?session_id=${sessionId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    transcript: transcriptText,
                    cheat_count: tabSwitchCount,
                    emotion_data: window.interviewSessionData
                })
            });

            if (!res.ok) {
                const errorText = await res.text(); 
                throw new Error(`後端處理失敗 (${res.status}): ${errorText}`);
            }
            console.log("✅ AI 報告已成功生成並存入資料庫。");
        }
    } catch (err) {
        console.error("❌ 生成報告失敗:", err);
    }

    // 🌟 4. 所有資料都確定送出後，才執行這兩個「會跳轉」的動作！
    if (typeof endInterview === 'function') {
        console.log("💾 正在更新面試場次狀態...");
        await endInterview();
    }

    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session_id');
    window.location.href = `finish.html`;
}

window.addEventListener('load', () => {
    initAntiCheatSystem();

    document.body.addEventListener('click', () => {
        if (!isSetupComplete) startInterviewAI();
    }, { once: true });

    document.getElementById('transcriptBox').innerHTML = '<div class="ai-msg" style="padding:10px; background:#f0f0f0; border-radius:8px;">系統：請點擊畫面任何一處以啟動麥克風與相機...<br><small style="color:#666;">🎥 AI 將分析您的面部表情與語音表現</small></div>';
});