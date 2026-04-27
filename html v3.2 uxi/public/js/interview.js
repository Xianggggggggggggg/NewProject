// ================= 1. 辨識閾值與數據設定 (你同學的邏輯) =================
const EAR_THRESHOLD = 0.20;
const SMILE_THRESHOLD = 1.45;
const FROWN_THRESHOLD = 0.015;

let faceMesh = null;
let cameraUtil = null;
let isEyeClosed = false;

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

async function playAudio(base64Data) {
    if (!audioContext) return;
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }

    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

    const int16Array = new Int16Array(bytes.buffer);
    const audioBuffer = audioContext.createBuffer(1, int16Array.length, 24000);
    const channelData = audioBuffer.getChannelData(0);
    for (let i = 0; i < int16Array.length; i++) channelData[i] = int16Array[i] / 32768.0;

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    activeSources.push(source);

    if (nextPlayTime < audioContext.currentTime) nextPlayTime = audioContext.currentTime;
    source.start(nextPlayTime);
    nextPlayTime += audioBuffer.duration;
}

// ================= 6. 核心啟動函數 (完美融合版 - 修復攝影機衝突) =================
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

        // 將串流綁定到 HTML 的 video 標籤
        videoElement.srcObject = stream;

        // 🌟 關鍵修復：等待影片真的載入畫面且有寬高後，才啟動 AI 迴圈
        videoElement.onloadeddata = async () => {
            await videoElement.play();
            console.log(`✅ 影片畫面準備完畢！解析度: ${videoElement.videoWidth}x${videoElement.videoHeight}`);
            console.log("🚀 啟動自定義 AI 影像傳輸迴圈...");

            let isDetecting = false;
            async function detectionLoop() {
                // 必須確保 videoWidth > 0，MediaPipe 才不會默默當機
                if (!videoElement.paused && !videoElement.ended && videoElement.videoWidth > 0) {
                    if (!isDetecting) {
                        isDetecting = true;
                        try {
                            // 將畫面送給 MediaPipe
                            await faceMesh.send({ image: videoElement });
                        } catch (err) {
                            console.error("❌ FaceMesh 處理影像時發生錯誤:", err);
                        }
                        isDetecting = false;
                    }
                }
                // 讓瀏覽器在下一次重繪時呼叫這個迴圈
                requestAnimationFrame(detectionLoop);
            }
            // 啟動迴圈
            detectionLoop();
        };

        // --- WebSocket (Gemini 後端) 連線區塊 ---
        // 記得上線時要把這裡的 IP 改成你後端伺服器的網址
        const backendUrl = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
            ? 'ws://localhost:3000'
            : `wss://${window.location.host}`;

        ws = new WebSocket(backendUrl);

        ws.onopen = () => {
            console.log("✅ WebSocket 連線成功");
            document.getElementById('transcriptBox').innerHTML = '';
            transcriptBox.innerHTML += '<div class="ai-msg">系統：連線成功，AI 正在準備面試...</div>';

            // 🌟 加入這段：抓取網址裡的 session_id 並傳給後端
            const urlParams = new URLSearchParams(window.location.search);
            const sessionId = urlParams.get('session_id');

            if (sessionId) {
                // 傳送特製的 JSON 給後端，讓後端知道這場對話的 ID
                ws.send(JSON.stringify({
                    customType: 'set_session_id',
                    sessionId: sessionId
                }));
                console.log(`🔗 已將 Session ID 傳給後端: ${sessionId}`);
            } else {
                console.warn("⚠️ 警告：網址列沒有 session_id，後端將無法把逐字稿存入資料庫！");
            }
        };

        ws.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            if (data.setupComplete) isSetupComplete = true;
            if (data.customType === 'user_transcript') appendTranscript('user', data.text);
            if (data.customType === 'ai_transcript_final') appendTranscript('ai', data.text);

            if (data.serverContent?.modelTurn?.parts) {
                for (const part of data.serverContent.modelTurn.parts) {
                    if (part.inlineData && part.inlineData.data) {
                        if (audioContext.state === 'suspended') await audioContext.resume();
                        playAudio(part.inlineData.data);
                    }
                }
            }
            if (data.serverContent?.interrupted) stopAllAudio();
        };

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

    } catch (err) {
        console.error("❌ 啟動失敗:", err);
        alert("無法啟動相機或麥克風，請檢查權限設定。");
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