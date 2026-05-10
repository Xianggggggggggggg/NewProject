// ================= 1. 辨識閾值與數據設定 (你同學的邏輯) =================
const EAR_THRESHOLD = 0.20;
const SMILE_THRESHOLD = 1.45;
const FROWN_THRESHOLD = 0.015;

let faceMesh = null;
let cameraUtil = null;
let isEyeClosed = false;

// 🌟 傳給 app.js 儲存的數據核心stopTalkingVisual
window.interviewSessionData = {
    total_frames: 0, blink_count: 0, happy_frames: 0, neutral_frames: 0,
    sad_frames: 0, emotion_joy: 0, emotion_neutral: 0, emotion_anxiety: 0,
    eye_contact_rate: 0.85, confidence_score: 100
};

// ================= 2. Gemini 語音通訊變數 =================
// ================= 基礎變數 =================
let ws;
let audioContext;
let nextPlayTime = 0;
let activeSources = [];
let avatarMesh = null; 
window.isVisualMonitorRunning = false;
window.lastSpeakEndTime = 0; 
let isSetupComplete = false;
let aiModelElement = null; // 補上這個存標籤的變數

document.addEventListener('DOMContentLoaded', () => {
    const model = document.getElementById('aiModel');
    model.addEventListener('load', () => {
        console.log("📦 [系統] 模型載入完成，開始掃描靈魂...");
        const symbols = Object.getOwnPropertySymbols(model);
        sceneSymbol = symbols.find(s => model[s] && model[s].type === 'Scene');
        
        if (sceneSymbol) {
            model[sceneSymbol].traverse(obj => {
                if (obj.morphTargetInfluences && obj.name.includes("Avatar")) {
                    avatarMesh = obj;
                    console.log("✅ [系統] 靈魂鎖定成功:", obj.name);
                }
            });
        }
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

// ================= 4. MediaPipe 初始化 (加入防呆與無臉警告) =================
function setupFaceMesh() {
    if (faceMesh) return;

    faceMesh = new FaceMesh({
        locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
        }
    });

    faceMesh.setOptions({
        maxNumFaces: 1, refineLandmarks: true,
        minDetectionConfidence: 0.5, minTrackingConfidence: 0.5
    });

    let no_face_counter = 0; // 用來計算找不到臉的次數

    faceMesh.onResults((results) => {
        // 🚨 防呆機制：如果迴圈有在跑，但找不到臉，要在 F12 提示
        if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
            no_face_counter++;
            if (no_face_counter % 30 === 0) {
                console.warn("⚠️ AI 正在運行，但畫面中找不到臉！請確保正對鏡頭且光源充足。");
            }
            return;
        }
        no_face_counter = 0; // 有找到臉就歸零

        // --- 下面完全是你的黃金邏輯，保持不變 ---
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

        if (is_blinking_now) {
            current_frame_emotion = "Fear (緊張眨眼)";
        }

        if (data.total_frames > 0) {
            const base_joy = (data.happy_frames / data.total_frames) * 1.5;
            const base_sad = (data.sad_frames / data.total_frames) * 1.5;

            data.emotion_joy = parseFloat(Math.min(1.0, base_joy).toFixed(2));
            data.emotion_anxiety = parseFloat(Math.min(1.0, base_sad).toFixed(2));
            data.emotion_neutral = parseFloat(Math.max(0, 1.0 - data.emotion_joy - data.emotion_anxiety).toFixed(2));

            let score = 100 - (data.emotion_anxiety * 80) - (data.blink_count * 0.5);
            data.confidence_score = Math.max(0, Math.min(100, Math.round(score)));

            if (data.emotion_anxiety > 0.2 || data.blink_count > 30) {
                data.ai_feedback = "偵測到您在過程中顯露較多緊張與不自信的微表情（如皺眉或頻繁眨眼），建議深呼吸放鬆。";
            } else if (data.emotion_joy > 0.3) {
                data.ai_feedback = "您的表現非常自信，笑容具有感染力，眼神交流也很穩定！";
            } else {
                data.ai_feedback = "整體表現平穩專業，若能適時增加一些微笑，會讓人感覺更有親和力。";
            }
        }

        // F12 即時印出
        if (data.total_frames % 15 === 0) {
            console.log(`%c[即時偵測] %c${current_frame_emotion} %c| 總分:${data.confidence_score} | EAR:${avg_ear.toFixed(3)} | Smile:${smile_ratio.toFixed(3)} | Frown:${frown_score.toFixed(3)}`,
                "color: #aaa;",
                current_frame_emotion.includes("Happy") ? "color: #e6c200; font-weight: bold;" :
                    current_frame_emotion.includes("Sad") ? "color: #e74c3c; font-weight: bold;" :
                        current_frame_emotion.includes("Fear") ? "color: #9b59b6; font-weight: bold;" : "color: #2ecc71;",
                "color: #fff;"
            );
        }
    });
}

// ================= 5. Gemini 語音與 UI 處理工具 =================
function appendTranscript(role, text) {
    if (!text.trim()) return;
    const box = document.getElementById('transcriptBox');

    const msgDiv = document.createElement('div');
    // 套用同學原本設定好的 class
    msgDiv.className = role === 'ai' ? 'ai-msg' : 'user-msg';

    // 如果同學的 CSS 裡還沒有 .user-msg，這段行內樣式可以先頂著用，確保分得出對話
    msgDiv.style.margin = "10px 0";
    msgDiv.style.padding = "10px";
    msgDiv.style.borderRadius = "8px";
    msgDiv.style.backgroundColor = role === 'ai' ? "#f0f0f0" : "#e8f0fe";
    msgDiv.style.color = role === 'ai' ? "#333" : "#1a73e8";
    msgDiv.style.textAlign = role === 'ai' ? "left" : "right";

    msgDiv.innerText = (role === 'ai' ? '🎙️ AI 面試官：\n' : '👤 你：\n') + text;
    box.appendChild(msgDiv);
    box.scrollTop = box.scrollHeight;
}

function stopAllAudio() {
    activeSources.forEach(source => { try { source.stop(); } catch (e) { } });
    activeSources = [];
    if (audioContext) nextPlayTime = audioContext.currentTime;
}

// 🌟 暴力掃描函數：衝進 3D 引擎後門找肌肉
// 🌟 強化版：地毯式遞迴搜索肌肉
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

// ================= 5. 修正版：音訊播放與視覺守護者 =================
// ================= 5. 音訊播放與視覺同步核心 (修復遺失的 playAudio) =================

let mouthFrameCount = 0; 
let currentMouthStrength = 0;
let facialMeshes = []; // 存放所有抓到的零件

/**
 * 🔊 播放從後端傳來的音訊片段
 */
async function playAudio(base64Data) {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
        }
        if (audioContext.state === 'suspended') await audioContext.resume();

        // 1. 解碼 Base64
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
        const int16Array = new Int16Array(bytes.buffer);
        
        // 2. 建立 Buffer
        const audioBuffer = audioContext.createBuffer(1, int16Array.length, 24000);
        audioBuffer.getChannelData(0).set(Array.from(int16Array).map(v => v / 32768.0));

        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);

        // 3. 管理播放時間軸
        const now = audioContext.currentTime;
        if (nextPlayTime < now) nextPlayTime = now;

        // 🌟 核心修正：更新結束時間，讓嘴巴知道要動到什麼時候
        // 增加 0.3 秒緩衝，讓說話結束的閉嘴動作更自然
        window.lastSpeakEndTime = nextPlayTime + audioBuffer.duration + 0.3;

        source.start(nextPlayTime);
        nextPlayTime += audioBuffer.duration;

        // 4. 啟動對嘴守護者
        startTalkingVisual();

    } catch (err) {
        console.error("❌ [音訊系統] playAudio 發生錯誤:", err);
    }
}

/**
 * 👄 平滑對嘴守護者 (解決頻率太快與不閉嘴的問題)
 */
function startTalkingVisual() {
    const model = document.getElementById('aiModel');
    if (!model || window.isVisualMonitorRunning) return;

    window.isVisualMonitorRunning = true;
    console.log("🛡️ [核心] 對嘴守護者：啟動平滑模式");

    const findScene = () => {
        const symbols = Object.getOwnPropertySymbols(model);
        for (let s of symbols) {
            if (model[s] && model[s].type === 'Scene') return model[s];
        }
        return null;
    };

    const runLoop = () => {
        const now = audioContext ? audioContext.currentTime : 0;
        const endTime = window.lastSpeakEndTime || 0;

        if (now < endTime) {
            // 🔍 1. 自動補抓零件
            if (facialMeshes.length === 0) {
                const scene = findScene();
                if (scene) {
                    scene.traverse((obj) => {
                        if (obj.morphTargetInfluences && (obj.name.includes("Head") || obj.name.includes("Avatar") || obj.name.includes("Mesh"))) {
                            facialMeshes.push(obj);
                        }
                    });
                    console.log(`✅ [核心] 已鎖定 ${facialMeshes.length} 個對嘴零件`);
                }
            }

            // 👄 2. 平滑張嘴邏輯
            if (facialMeshes.length > 0) {
                if (!model.paused) model.pause(); 

                // 🌟 降頻：每 6 幀才取一次新的強度 (解決動太快)
                if (mouthFrameCount % 20 === 0) {
                    currentMouthStrength = Math.random() * 0.4 + 0.25; 
                }
                mouthFrameCount++;

                facialMeshes.forEach(m => {
                    // 線性插值公式：舊值 60% + 新值 40%，讓動作變順
                    if (m.morphTargetInfluences[45] !== undefined) {
                        const oldVal = m.morphTargetInfluences[45];
                        m.morphTargetInfluences[45] = (oldVal * 0.6) + (currentMouthStrength * 0.4);
                    }
                    // 同步處理 0 號 (mouthOpen) 增加自然感
                    if (m.morphTargetInfluences[0] !== undefined) {
                        const oldVal = m.morphTargetInfluences[0];
                        m.morphTargetInfluences[0] = (oldVal * 0.6) + (currentMouthStrength * 0.2 * 0.4);
                    }
                    m.morphTargetInfluences = [...m.morphTargetInfluences];
                });

                // 強迫重繪
                model.exposure = 1.0 + (Math.random() * 0.001);
            }
            requestAnimationFrame(runLoop);
        } else {
            // 🤐 3. 強制閉嘴
            console.log("🤐 說話結束，下巴強制歸零");
            facialMeshes.forEach(m => {
                if (m.morphTargetInfluences[45] !== undefined) m.morphTargetInfluences[45] = 0;
                if (m.morphTargetInfluences[0] !== undefined) m.morphTargetInfluences[0] = 0;
                m.morphTargetInfluences = [...m.morphTargetInfluences];
            });
            
            model.exposure = 1.0;
            if (model.paused) model.play(); 
            
            // 重置狀態
            window.isVisualMonitorRunning = false;
            mouthFrameCount = 0;
            currentMouthStrength = 0;
        }
    };

    requestAnimationFrame(runLoop);
}
// ==========================================
// 3. 軟停止：只清空時間，不殺掉計時器
// ==========================================
function stopTalkingVisual() {
    console.log("🤐 收到停止指令，下巴進入待命");
    window.lastSpeakEndTime = 0; // 時間清零，上面的 setInterval 就會自動跑進 else 閉嘴
    
    if (aiModelElement) {
        aiModelElement.dataset.isTalking = 'false';
    }
}
// ================= 6. 核心啟動函數 (完美融合版 - 修復攝影機衝突) =================
// ================= 6. 核心啟動函數 (完美融合版 - 修復攝影機衝突) =================
async function startInterviewAI() {
    const videoElement = document.getElementById('localVideo');
    const transcriptBox = document.getElementById('transcriptBox');

    console.log("⏳ 正在初始化 FaceMesh 模型...");
    setupFaceMesh();

    let stream = null; // 🌟 把 stream 宣告拉出來，用來判斷有沒有成功抓到硬體

    // --- 第一部分：嘗試抓取鏡頭與麥克風 ---
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        }
        await audioContext.resume();

        console.log("⏳ 正在請求攝影機與麥克風權限...");
        stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 },
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });

        // 如果成功抓到，就綁定畫面並啟動 MediaPipe 臉部偵測
        videoElement.srcObject = stream;
        videoElement.onloadeddata = async () => {
            await videoElement.play();
            console.log(`✅ 影片畫面準備完畢！解析度: ${videoElement.videoWidth}x${videoElement.videoHeight}`);
            
            let isDetecting = false;
            async function detectionLoop() {
                if (!videoElement.paused && !videoElement.ended && videoElement.videoWidth > 0) {
                    if (!isDetecting) {
                        isDetecting = true;
                        try { await faceMesh.send({ image: videoElement }); } catch (err) {}
                        isDetecting = false;
                    }
                }
                requestAnimationFrame(detectionLoop);
            }
            detectionLoop();
        };

    } catch (err) {
        // 🌟 核心修改：如果沒鏡頭，只會在 F12 印出警告，但不會讓程式死當！
        console.warn("⚠️ 找不到相機或麥克風，進入【無鏡頭排版測試模式】");
        
        // 在你的視訊格子上加個文字提示，讓你知道它有在運作
        if(videoElement.parentElement) {
            let notice = document.createElement('div');
            notice.innerText = "沒有偵測到鏡頭\n(排版測試模式)";
            notice.style.cssText = "position:absolute; color:#888; text-align:center; top:50%; left:50%; transform:translate(-50%, -50%);";
            videoElement.parentElement.appendChild(notice);
        }
    }

    // --- 第二部分：無論有沒有鏡頭，都必須啟動 WebSocket 連線與 UI ---
    try {
        const backendUrl = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
            ? 'ws://localhost:3001'
            : `wss://${window.location.host}`;

        ws = new WebSocket(backendUrl);

        ws.onopen = () => {
            console.log("✅ WebSocket 連線成功");
            document.getElementById('transcriptBox').innerHTML = '';
            transcriptBox.innerHTML += '<div class="ai-msg">系統：連線成功，正在讀取資料...(無鏡頭模式)</div>';

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
            }
        };

        ws.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            if (data.setupComplete) isSetupComplete = true;
            if (data.customType === 'user_transcript') appendTranscript('user', data.text);
            if (data.customType === 'ai_transcript_final') {
                appendTranscript('ai', data.text);
            }

            if (data.serverContent?.modelTurn?.parts) {
        // 🌟 只要 AI 開始吐零件 (包含語音或文字)，就啟動晃動動畫
                startTalkingVisual();

                for (const part of data.serverContent.modelTurn.parts) {
                    if (part.inlineData && part.inlineData.data) {
                        if (audioContext && audioContext.state === 'suspended') await audioContext.resume();
                playAudio(part.inlineData.data);
                    }
                }
            }

    // 🌟 如果 AI 被你打斷了，立刻停止聲音也停止晃動
            if (data.serverContent?.interrupted) {
                stopAllAudio();
                stopTalkingVisual();
            }
        };

        // 🌟 防呆機制：如果有成功抓到麥克風 (stream 不為 null)，才啟動語音錄製傳送
        if (stream && audioContext) {
            const source = audioContext.createMediaStreamSource(stream);
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
            source.connect(processor);
            processor.connect(audioContext.destination);
        }

    } catch (err) {
        console.error("❌ 後端連線設定失敗:", err);
    }
}

// ================= 7. 結束處理 =================
async function handleEndInterview() {
    console.log("正在結束面試並上傳數據...", window.interviewSessionData);

    // 釋放資源
    if (ws) ws.close();
    if (audioContext) audioContext.close();
    if (cameraUtil) cameraUtil.stop();

    if (typeof endInterview === 'function') {
        await endInterview(); // 呼叫 app.js 中的函數
    } else {
        console.error("找不到 app.js 中的 endInterview 函數");
        window.location.href = 'result.html';
    }
}

// 啟動面試 (解決瀏覽器阻擋自動播放聲音的問題)
window.addEventListener('load', () => {
    // 讓使用者點擊畫面後再啟動，確保聲音能出來
    document.body.addEventListener('click', () => {
        if (!isSetupComplete) startInterviewAI();
    }, { once: true });

    document.getElementById('transcriptBox').innerHTML = '<div class="ai-msg">系統：請點擊畫面任何一處以啟動麥克風與相機...</div>';
});