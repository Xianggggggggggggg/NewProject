// ================= 1. 辨識閾值與數據設定 (你同學的邏輯) =================
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

// ================= 2. Gemini 語音通訊變數 =================
let ws;
let audioContext;
let processor;
let isSetupComplete = false;
let nextPlayTime = 0;
let activeSources = [];
let avatarMesh = null; 
let aiModelElement = null;

window.isVisualMonitorRunning = false;
window.lastSpeakEndTime = 0; 

// 🌟 這裡！把這兩行大腦核心放進最高指揮部，全網頁都認識它們了！
window.audioAnimationQueue = [];              // 聲音播放排班表 (時間軸佇列)
window.facialMeshesMap = {};                  // 存放 HR 與技術主管肌肉的地圖

let faceMesh = null;
let cameraUtil = null;
let isEyeClosed = false;

// 🎬 C. 雙面試官接力賽與對嘴排程狀態
let currentSpeakerId = null;                  // 記錄當前動嘴模型 ID
window.currentAiRole = 'HR';                  // 記錄當前回合的角色 (HR 或 技術主管)
window.currentInterviewStage = 'HR_OPENING';  // 面試階段：HR_OPENING -> MANAGER_TECH -> HR_CLOSING

// 🌟 D. 對嘴動畫專用計數器 (剛剛漏掉的，補回這裡！)
let mouthFrameCount = 0;                      // 記錄嘴巴動了幾格
let currentMouthStrength = 0;                 // 記錄當前嘴巴開合的隨機強度

document.addEventListener('DOMContentLoaded', () => {
    ['aiModel_HR', 'aiModel_Tech'].forEach(id => {
        const model = document.getElementById(id);
        if (!model) return;

        model.addEventListener('load', () => {
            console.log(`📦 [系統] 模型 ${id} 真正載入完成！強制沖刷舊快取...`);
            if (window.facialMeshesMap) {
                window.facialMeshesMap[id] = []; // 確保重疊時重新掃描活體
            }
        });
    });
});

// ================= 3. 核心計算工具 (你同學的邏輯) =================
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

// ================= 4. MediaPipe 初始化 (你同學的邏輯) =================
function setupFaceMesh() {
    if (faceMesh) return;

    // 🛡️ 1. 安全檢查：檢查瀏覽器有沒有 WebGL (沒顯卡驅動會抓不到)
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

    // ⚙️ 2. 初始化 MediaPipe FaceMesh
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

    // 🧠 3. 核心邏輯：處理偵測結果
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

        // --- 數值計算 ---
        const smile_ratio = calculateSmile(landmarks);
        const frown_score = calculateFrown(landmarks);
        const left_ear = calculateEAR(landmarks, [33, 160, 158, 133, 153, 144]);
        const right_ear = calculateEAR(landmarks, [362, 385, 387, 263, 373, 380]);
        const avg_ear = (left_ear + right_ear) / 2.0;

        // --- 眨眼偵測 ---
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

        // --- 情緒分析邏輯 ---
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

        // --- 分數更新與回饋 ---
        if (data.total_frames > 0) {
            const base_joy = (data.happy_frames / data.total_frames) * 1.5;
            const base_sad = (data.sad_frames / data.total_frames) * 1.5;

            data.emotion_joy = parseFloat(Math.min(1.0, base_joy).toFixed(2));
            data.emotion_anxiety = parseFloat(Math.min(1.0, base_sad).toFixed(2));
            data.emotion_neutral = parseFloat(Math.max(0, 1.0 - data.emotion_joy - data.emotion_anxiety).toFixed(2));

            let score = 100 - (data.emotion_anxiety * 80) - (data.blink_count * 0.5);
            data.confidence_score = Math.max(0, Math.min(100, Math.round(score)));

            // AI 自動給評語
            if (data.emotion_anxiety > 0.2 || data.blink_count > 30) {
                data.ai_feedback = "偵測到您在過程中顯露較多緊張，建議深呼吸。";
            } else if (data.emotion_joy > 0.3) {
                data.ai_feedback = "表現非常自信，笑容具感染力！";
            } else {
                data.ai_feedback = "整體表現平穩專業。";
            }
        }

        // --- 🌈 炫麗彩色 Log (每 15 幀印一次) ---
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

// ================= 5. Gemini 語音與 UI 處理工具 (🌟 已更新：支援雙面試官 UI) =================
// 新增 ai_role 參數，用來判斷是 HR 還是主管
function appendTranscript(role, text, ai_role = 'HR') {
    if (!text.trim()) return;
    const box = document.getElementById('transcriptBox');

    const msgDiv = document.createElement('div');
    msgDiv.className = role === 'ai' ? 'ai-msg' : 'user-msg';

    msgDiv.style.margin = "10px 0";
    msgDiv.style.padding = "10px";
    msgDiv.style.borderRadius = "8px";

    // 🌟 這裡負責把兩個 AI 面試官的泡泡顏色跟名字分開
    if (role === 'ai') {
        if (ai_role === 'HR') {
            msgDiv.style.backgroundColor = "#f0f0f0"; // HR：灰色泡泡
            msgDiv.style.color = "#333";
            msgDiv.innerText = '👩‍💼 人資 (HR)：\n' + text;
        } else {
            msgDiv.style.backgroundColor = "#ffebee"; // 主管：淡紅色/專業色泡泡
            msgDiv.style.color = "#c62828";
            msgDiv.innerText = '👨‍💻 部門主管：\n' + text;
        }
        msgDiv.style.textAlign = "left";
    } else {
        msgDiv.style.backgroundColor = "#e8f0fe"; // 應徵者：藍色泡泡
        msgDiv.style.color = "#1a73e8";
        msgDiv.style.textAlign = "right";
        msgDiv.innerText = '👤 你：\n' + text;
    }

    box.appendChild(msgDiv);
    box.scrollTop = box.scrollHeight;
}

function stopAllAudio() {
    activeSources.forEach(source => { try { source.stop(); } catch (e) { } });
    activeSources = [];
    if (audioContext) nextPlayTime = audioContext.currentTime;
}

function findAvatarMesh() {
    if (!aiModelElement) aiModelElement = document.getElementById('aiModel');
    if (!aiModelElement) return;

    // 1. 取得 Shadow Root
    const shadow = aiModelElement.shadowRoot;
    if (!shadow) {
        console.warn("⏳ [診斷] ShadowRoot 尚未生成，0.5秒後重試...");
        setTimeout(findAvatarMesh, 500);
        return;
    }

    // 2. 取得 Canvas
    const canvas = shadow.querySelector('canvas');
    if (!canvas) {
        console.warn("⏳ [診斷] Canvas 尚未生成，0.5秒後重試...");
        setTimeout(findAvatarMesh, 500);
        return;
    }

    // 3. 透過 __threeRenderer 潛入場景 (這是 model-viewer 的後門)
    const renderer = canvas.__threeRenderer;
    const scene = renderer?.scene;

    if (!scene) {
        console.log("⏳ [診斷] Three.js 場景建構中，持續監控...");
        setTimeout(findAvatarMesh, 500);
        return;
    }

    // 4. 地毯式搜索所有零件
    scene.traverse((obj) => {
        if (obj.isSkinnedMesh && obj.morphTargetInfluences) {
            // 只要是有 MorphTarget 的我們都先留著，並優先找臉部
            if (obj.name.includes("Head") || obj.name.includes("Avatar") || !avatarMesh) {
                avatarMesh = obj;
            }
        }
    });

    if (avatarMesh) {
        console.log("✅ [核心] 診斷成功！已鎖定肌肉零件:", avatarMesh.name);
        console.log("📊 47 號下巴狀態:", avatarMesh.morphTargetInfluences[47] !== undefined ? "可用" : "不存在");
        
        // 抓到後手動測試一下，看他會不會張嘴 (測試完會自動縮回去)
        avatarMesh.morphTargetInfluences[47] = 1.0;
        setTimeout(() => { avatarMesh.morphTargetInfluences[47] = 0; }, 500);
    } else {
        console.error("❌ [錯誤] 找遍了整個模型都找不到 MorphTargets，請檢查 GLB 導出設定！");
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

        // 🌟【除錯紀錄】排班表登記
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

            const urlParams = new URLSearchParams(window.location.search);
            const sessionId = urlParams.get('session_id');
            const resumeId = urlParams.get('resume_id');
            const position = urlParams.get('position');
            const interviewType = urlParams.get('type') || '行為面試';

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

            if (data.setupComplete) isSetupComplete = true;

            if (data.customType === 'user_transcript') {
                appendTranscript('user', data.text);
            }

            if (data.customType === 'ai_transcript_final') {
                const finalRole = data.ai_role || window.currentAiRole || '技術主管';
                appendTranscript('ai', data.text, finalRole);
            }

            // 處理後端傳來的語音串流
            if (data.serverContent?.modelTurn?.parts) {
                // 讀取後端同學在第一步貼上的 ai_role 貼紙
                window.currentAiRole = data.ai_role || window.currentAiRole || '技術主管';
                
                let roleStr = window.currentAiRole.toUpperCase();
                let targetId = roleStr.includes('HR') ? 'aiModel_HR' : 'aiModel_Tech';

                // 🔍【雷達偵測】檢查網頁上到底看不看的到這個 3D 模型
                const checkModel = document.getElementById(targetId);
                if (!checkModel) {
                    console.error(`❌ [偵測失敗] 程式正試圖讓 "${targetId}" 動嘴巴，但 HTML 裡面找不到這個 ID！請檢查網頁排版！`);
                }

                for (const part of data.serverContent.modelTurn.parts) {
                    if (part.inlineData && part.inlineData.data) {
                        if (audioContext.state === 'suspended') await audioContext.resume();
                        // 🌟 確保有把 targetId 牢牢傳進去
                        playAudio(part.inlineData.data, targetId); 
                    }
                }
            }
            
            if (data.serverContent?.interrupted) {
                stopAllAudio();
                window.lastSpeakEndTime = 0;
            }
        };

        const NOISE_THRESHOLD = 0.015;

        const source = audioContext.createMediaStreamSource(stream);
        processor = audioContext.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (e) => {
            
            // 🌟 恢復正常！只看前端唯一的連線變數 ws
            if (ws && ws.readyState === WebSocket.OPEN && isSetupComplete) {
                const inputData = e.inputBuffer.getChannelData(0);
                
                // 1. 不阻擋靜音！把包含安靜的聲音轉碼
                const pcmData = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 32767;
                }
                const base64Audio = btoa(String.fromCharCode.apply(null, new Uint8Array(pcmData.buffer)));
                
                // 2. 統一把聲音丟給後端，讓後端去煩惱要給 HR 還是主管聽
                ws.send(JSON.stringify({
                    realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: base64Audio } }
                }));
            }
        };
        
        source.connect(processor);
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
// 🎬 全域時間軸雙人對嘴系統 (自動對齊聲音時間)
// ==========================================

// ==========================================
// 🎬 輕量版全域大腦計時器 (純負責時間軸與隨機嘴震幅)
// ==========================================
function initGlobalAnimationLoop() {
    const findScene = (model) => {
        if (!model) return null;
        if (model.model && model.model.getScene) {
            return model.model.getScene();
        }
        const symbols = Object.getOwnPropertySymbols(model);
        for (let s of symbols) {
            if (model[s] && (model[s].type === 'Scene' || model[s].constructor.name === 'Scene')) {
                return model[s];
            }
        }
        return null;
    };

    const runGlobalLoop = () => {
        const ctx = window.audioContext || (typeof audioContext !== 'undefined' ? audioContext : null);
        const now = ctx ? ctx.currentTime : 0;
        
        // 1. 檢查排班表：目前是誰在喇叭裡說話
        const activeTurn = window.audioAnimationQueue.find(item => now >= item.startTime && now <= item.endTime);
        const activeTargetId = activeTurn ? activeTurn.targetId : null;

        // 清理過期排班
        window.audioAnimationQueue = window.audioAnimationQueue.filter(item => now <= item.endTime);

        // 2. 更新全域隨機嘴巴開合強度 (每 6 幀換一次幅度，說話最自然)
        if (mouthFrameCount % 6 === 0) {
            window.currentMouthStrength = Math.random() * 0.55 + 0.2; // 0.20 ~ 0.75 之間張合
        }
        mouthFrameCount++;

        ['aiModel_HR', 'aiModel_Tech'].forEach(id => {
            const model = document.getElementById(id);
            if (!model) return;

            // 保持自然呼吸重繪畫布
            if (model.paused) model.play();

            // 3. 快取活體模型網格與嘴巴編號
            if (!window.facialMeshesMap[id] || window.facialMeshesMap[id].length === 0) {
                const scene = findScene(model);
                if (scene) {
                    window.facialMeshesMap[id] = [];
                    scene.traverse((obj) => {
                        if (obj.morphTargetDictionary && obj.morphTargetInfluences) {
                            for (let key in obj.morphTargetDictionary) {
                                let lowerKey = key.toLowerCase();
                                if (lowerKey.includes('open') || lowerKey.includes('jaw') || lowerKey.includes('mouth')) {
                                    const jawIdx = obj.morphTargetDictionary[key];
                                    window.facialMeshesMap[id].push({
                                        mesh: obj,
                                        jaw: jawIdx
                                    });
                                    console.log(`🎯 [實時對齊] 成功直連 ${id} 的實體肌肉: ${key} (編號 ${jawIdx})`);
                                    break;
                                }
                            }
                        }
                    });
                }
            }

            // 4. 🛠️ 暴力直灌：直接修改顯卡正在讀取的陣列元素！
            const meshRecords = window.facialMeshesMap[id] || [];
            meshRecords.forEach(record => {
                const m = record.mesh;
                
                if (id === activeTargetId) {
                    // 🎤 輪到你發言：直接往記憶體地址塞進開合度！
                    m.morphTargetInfluences[record.jaw] = window.currentMouthStrength;
                } else {
                    // 🤫 沒輪到你：雷打不動強制閉嘴
                    m.morphTargetInfluences[record.jaw] = 0;
                }
                
                // 🌟【最關鍵的交卷動作】重新解構，逼 Three.js 快取刷新
                m.morphTargetInfluences = [...m.morphTargetInfluences];
            });

            // 配合隨機微調曝光，確保畫布每幀都被迫重繪
            if (id === activeTargetId) {
                model.exposure = 1.0 + (Math.random() * 0.001);
            }
        });

        requestAnimationFrame(runGlobalLoop);
    };
    
    requestAnimationFrame(runGlobalLoop);
}

// 啟動全域指揮部
initGlobalAnimationLoop();

// ================= 7. 結束處理 =================
async function handleEndInterview() {
    console.log("正在結束面試並上傳數據...", window.interviewSessionData);

    if (ws) ws.close();
    if (audioContext) audioContext.close();
    if (cameraUtil) cameraUtil.stop();

    if (typeof endInterview === 'function') {
        await endInterview();
    } else {
        console.error("找不到 app.js 中的 endInterview 函數");
        window.location.href = 'result.html';
    }
}

window.addEventListener('load', () => {
    document.body.addEventListener('click', () => {
        if (!isSetupComplete) startInterviewAI();
    }, { once: true });

    document.getElementById('transcriptBox').innerHTML = '<div class="ai-msg" style="padding:10px; background:#f0f0f0; border-radius:8px;">系統：請點擊畫面任何一處以啟動麥克風與相機...<br><small style="color:#666;">🎥 AI 將分析您的面部表情與語音表現</small></div>';
});