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

// ================= 4. MediaPipe 初始化 (你同學的邏輯) =================
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

    faceMesh.onResults((results) => {
        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            const landmarks = results.multiFaceLandmarks[0];
            const data = window.interviewSessionData;

            data.total_frames++;

            const smile_ratio = calculateSmile(landmarks);
            const frown_score = calculateFrown(landmarks);
            const left_ear = calculateEAR(landmarks, [33, 160, 158, 133, 153, 144]);
            const right_ear = calculateEAR(landmarks, [362, 385, 387, 263, 373, 380]);
            const avg_ear = (left_ear + right_ear) / 2.0;

            if (avg_ear < EAR_THRESHOLD && !isEyeClosed) {
                data.blink_count++;
                isEyeClosed = true;
            } else if (avg_ear >= EAR_THRESHOLD) {
                isEyeClosed = false;
            }

            if (smile_ratio > SMILE_THRESHOLD) {
                data.happy_frames++;
            } else if (frown_score > FROWN_THRESHOLD) {
                data.sad_frames++;
            } else {
                data.neutral_frames++;
            }

            if (data.total_frames > 0) {
                data.emotion_joy = parseFloat((data.happy_frames / data.total_frames).toFixed(2));
                data.emotion_anxiety = parseFloat((data.sad_frames / data.total_frames).toFixed(2));
                data.emotion_neutral = parseFloat((data.neutral_frames / data.total_frames).toFixed(2));

                let baseScore = 100 - (data.emotion_anxiety * 60) - (data.blink_count * 0.1);
                data.confidence_score = Math.max(0, Math.min(100, Math.round(baseScore)));
            }
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

// ================= 6. 核心啟動函數 (完美融合版) =================
async function startInterviewAI() {
    const videoElement = document.getElementById('localVideo');
    const transcriptBox = document.getElementById('transcriptBox');
    setupFaceMesh();

    try {
        // 喚醒音訊環境 (避免瀏覽器阻擋聲音)
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        }
        await audioContext.resume();
        console.log("當前音訊狀態:", audioContext.state);

        // 取得共用的影音串流 (影像給 MediaPipe，聲音給 Gemini)
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 },
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });

        // 讓 MediaPipe 吃影像
        videoElement.srcObject = stream;
        cameraUtil = new Camera(videoElement, {
            onFrame: async () => { await faceMesh.send({ image: videoElement }); },
            width: 640, height: 480
        });
        cameraUtil.start();
        console.log("✅ AI 視覺偵測系統啟動");

        // 連線到你的 Node.js 後端大腦 (之後上線記得改 IP)
        ws = new WebSocket(`ws://${window.location.host}`);

        ws.onopen = () => {
            console.log("✅ WebSocket 連線成功");
            transcriptBox.innerHTML += '<div class="ai-msg">系統：連線成功，AI 正在準備面試...</div>';
        };

        ws.onmessage = async (event) => {
            const data = JSON.parse(event.data);

            // 觸發 AI 第一句話
            if (data.setupComplete) {
                isSetupComplete = true;
            }

            // 顯示文字
            if (data.customType === 'user_transcript') appendTranscript('user', data.text);
            if (data.customType === 'ai_transcript_final') appendTranscript('ai', data.text);

            // 播放聲音
            if (data.serverContent?.modelTurn?.parts) {
                for (const part of data.serverContent.modelTurn.parts) {
                    if (part.inlineData && part.inlineData.data) {
                        if (audioContext.state === 'suspended') {
                            audioContext.resume();
                        }
                        playAudio(part.inlineData.data);
                    }
                }
            }

            if (data.serverContent?.interrupted) stopAllAudio();
        };

        // 擷取麥克風音訊送給 Node.js 後端
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
        console.error("相機或麥克風啟動失敗:", err);
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