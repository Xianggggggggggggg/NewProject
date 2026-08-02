// ==========================================
// 1. 全域變數與初始化
// ==========================================
const EAR_THRESHOLD = 0.20;
const SMILE_THRESHOLD = 1.45;
const FROWN_THRESHOLD = 0.015;
const AUDIO_VOLUME_GATE = 0.02;

// 傳給後端儲存的面試表情/情緒數據
window.interviewSessionData = {
    total_frames: 0, blink_count: 0, happy_frames: 0, neutral_frames: 0,
    sad_frames: 0, emotion_joy: 0, emotion_neutral: 0, emotion_anxiety: 0,
    eye_contact_rate: 0.85, confidence_score: 100
};

// 全域 WebGL 錯誤處理
window.addEventListener('error', (event) => {
    if (event.error && event.error.message && event.error.message.includes('WebGL')) {
        console.warn('⚠️ 偵測到 WebGL 錯誤，臉部偵測功能將被停用');
        faceMesh = null;
        event.preventDefault();
    }
});

const urlParams = new URLSearchParams(window.location.search);
const TARGET_SESSION_ID = urlParams.get('session_id') || 'group_test_123';
const RESUME_ID = urlParams.get('resume_id');
const POSITION = urlParams.get('position') || '未指定';
const INTERVIEW_TYPE = urlParams.get('type') || '行為面試';
window.currentSessionId = TARGET_SESSION_ID;

const peers = {};
let myStream = null;
let windowHrPeerId = null; // 專門用來記錄真人考官的 Peer ID

let ws = null;
let myPeer = null;
let audioContext = null;
let audioAnalyser = null;
let processor = null;
let faceMesh = null;
let isSetupComplete = false;
let nextPlayTime = 0;
let activeSources = [];
let isEyeClosed = false;

window.isAIPaused = false;
window.audioAnimationQueue = [];
window.currentAiRole = 'HR';

// 真人插話時備用聽寫打字員
let userRecognition = null;
if ('webkitSpeechRecognition' in window) {
    userRecognition = new webkitSpeechRecognition();
    userRecognition.continuous = true;
    userRecognition.interimResults = false;
    userRecognition.lang = 'zh-TW';
    userRecognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                const text = event.results[i][0].transcript.trim();
                if (text && ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ customType: 'user_human_speech', text: text, sessionId: window.currentSessionId }));
                }
            }
        }
    };
    userRecognition.onend = () => {
        if (window.isAIPaused && userRecognition) {
            try { userRecognition.start(); } catch (e) { }
        }
    };
}

// ==========================================
// 2. MediaPipe 臉部與情緒分析計算
// ==========================================
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

function setupFaceMesh() {
    if (faceMesh) return;
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) return;
    } catch (e) {
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

    faceMesh.onResults((results) => {
        if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) return;
        const landmarks = results.multiFaceLandmarks[0];
        const data = window.interviewSessionData;
        data.total_frames++;

        const smile_ratio = calculateSmile(landmarks);
        const frown_score = calculateFrown(landmarks);
        const left_ear = calculateEAR(landmarks, [33, 160, 158, 133, 153, 144]);
        const right_ear = calculateEAR(landmarks, [362, 385, 387, 263, 373, 380]);
        const avg_ear = (left_ear + right_ear) / 2.0;

        if (avg_ear < EAR_THRESHOLD) {
            if (!isEyeClosed) {
                data.blink_count++;
                isEyeClosed = true;
            }
        } else {
            isEyeClosed = false;
        }

        if (smile_ratio > SMILE_THRESHOLD) {
            data.happy_frames++;
        } else if (frown_score > FROWN_THRESHOLD && smile_ratio <= SMILE_THRESHOLD) {
            data.sad_frames++;
        } else {
            data.neutral_frames++;
        }

        if (data.total_frames > 0) {
            const base_joy = (data.happy_frames / data.total_frames) * 1.5;
            const base_sad = (data.sad_frames / data.total_frames) * 1.5;
            data.emotion_joy = parseFloat(Math.min(1.0, base_joy).toFixed(2));
            data.emotion_anxiety = parseFloat(Math.min(1.0, base_sad).toFixed(2));
            data.emotion_neutral = parseFloat(Math.max(0, 1.0 - data.emotion_joy - data.emotion_anxiety).toFixed(2));
            let score = 100 - (data.emotion_anxiety * 80) - (data.blink_count * 0.5);
            data.confidence_score = Math.max(0, Math.min(100, Math.round(score)));
        }
    });
}

// ==========================================
// 3. UI 與音訊播放控制
// ==========================================
function appendTranscript(role, text, ai_role = 'HR') {
    if (!text.trim()) return;
    const box = document.getElementById('transcriptBox');
    if (!box) return;

    const msgDiv = document.createElement('div');
    msgDiv.className = role === 'ai' ? 'ai-msg' : 'user-msg';
    msgDiv.style.margin = "10px 0";
    msgDiv.style.padding = "10px";
    msgDiv.style.borderRadius = "8px";

    if (role === 'ai') {
        if (ai_role === '真人HR') {
            msgDiv.style.backgroundColor = "#fff3e0";
            msgDiv.style.color = "#d35400";
            msgDiv.style.border = "1px solid #ffe0b2";
            msgDiv.innerText = '🕵️ 真人面試官：\n' + text;
        } else if (ai_role === 'HR') {
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

function stopAllAudio() {
    activeSources.forEach(source => { try { source.stop(); } catch (e) { } });
    activeSources = [];
    window.audioAnimationQueue = [];
    if (audioContext) nextPlayTime = audioContext.currentTime;

    const talkTech = document.getElementById('talkVideo_Tech');
    const talkHR = document.getElementById('talkVideo_HR');
    if (talkTech) talkTech.classList.remove('active');
    if (talkHR) talkHR.classList.remove('active');
}

async function playAudio(base64Data, targetId) {
    try {
        if (!targetId) targetId = 'aiModel_Tech';
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
        }
        if (audioContext.state === 'suspended') await audioContext.resume();

        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
        const int16Array = new Int16Array(bytes.buffer);
        const audioBuffer = audioContext.createBuffer(1, int16Array.length, 24000);
        audioBuffer.getChannelData(0).set(Array.from(int16Array).map(v => v / 32768.0));

        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);
        activeSources.push(source);

        const now = audioContext.currentTime;
        if (nextPlayTime < now) nextPlayTime = now;
        window.audioAnimationQueue.push({
            targetId: targetId,
            startTime: nextPlayTime,
            endTime: nextPlayTime + audioBuffer.duration
        });

        source.start(nextPlayTime);
        nextPlayTime += audioBuffer.duration;
    } catch (err) {
        console.error("❌ [音訊系統] playAudio 發生錯誤:", err);
    }
}

// 2D 影片對嘴動畫大腦迴圈
function initGlobalAnimationLoop() {
    const runGlobalLoop = () => {
        const ctx = audioContext;
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
                    talkVideoTech.play().catch(e => { });
                    talkVideoTech.classList.add('active');
                }
                talkVideoHR.classList.remove('active');
            } else if (activeTargetId === 'aiModel_HR') {
                if (!talkVideoHR.classList.contains('active')) {
                    talkVideoHR.currentTime = 0;
                    talkVideoHR.play().catch(e => { });
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

// ==========================================
// 4. 啟動面試主程序（綁定按鈕觸發）
// ==========================================
async function startGroupInterview() {
    const startBtn = document.getElementById('start-test-btn');
    if (startBtn) startBtn.style.display = 'none';

    setupFaceMesh();

    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        }
        await audioContext.resume();

        // 啟動相機與麥克風
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 },
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        myStream = stream;

        // 本地視訊畫面
        const myVideo = document.createElement('video');
        myVideo.muted = true;
        addVideoStream(myVideo, stream, 'my-video');

        // 進行 MediaPipe 臉部畫面分析
        let isDetecting = false;
        async function detectionLoop() {
            if (myVideo.videoWidth > 0 && !isDetecting && faceMesh) {
                isDetecting = true;
                try {
                    await faceMesh.send({ image: myVideo });
                } catch (err) {
                    if (err.message && err.message.includes('WebGL')) faceMesh = null;
                }
                isDetecting = false;
            }
            requestAnimationFrame(detectionLoop);
        }
        detectionLoop();

        const backendUrl = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
            ? 'ws://localhost:3001/ws/group' : `wss://${window.location.host}/ws/group`;
        ws = new WebSocket(backendUrl);

        // 初始化 PeerJS
        myPeer = new Peer();

        myPeer.on('open', id => {
            const statusText = document.getElementById('status-text');
            if (statusText) statusText.innerText = `✅ 連線成功 (您的 ID: ${id})`;

            const joinMsg = JSON.stringify({ type: 'join_group_room', sessionId: TARGET_SESSION_ID, peerId: id });
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(joinMsg);
            } else {
                ws.onopen = () => ws.send(joinMsg);
            }

            // 初始化 AI 面試資料
            if (TARGET_SESSION_ID) {
                ws.send(JSON.stringify({
                    customType: 'init_group_interview', // 改成與後端一致
                    sessionId: TARGET_SESSION_ID,
                    candidateIds: RESUME_ID ? [RESUME_ID] : [], // 配合後端解構的 candidateIds
                    position: POSITION,
                    interview_type: INTERVIEW_TYPE                }));
            }
        });

        // 🌟 【接聽來電】：其他人連線過來時 (包含真人考官與其他應徵者)
        myPeer.on('call', call => {
            call.answer(stream);
            const video = document.createElement('video');
            video.id = `video_${call.peer}`;

            call.on('stream', userVideoStream => {
                if (call.peer === windowHrPeerId) {
                    switchToHumanHR(userVideoStream);
                } else {
                    addVideoStream(video, userVideoStream);
                }
            });
            call.on('close', () => {
                if (call.peer === windowHrPeerId) {
                    revertToPlaceholderHR();
                } else {
                    video.remove();
                }
            });
            peers[call.peer] = call;
        });

        // 🌟 監聽後端 WebSocket 廣播
        ws.onmessage = async (event) => {
            const data = JSON.parse(event.data);

            // 🟢 A. 戰情室廣播：真人考官（HR）進房了！
            if (data.type === 'hr_joined_group') {
                console.log("🚨 [系統] 真人考官進場廣播！ID:", data.peerId);
                if (windowHrPeerId === data.peerId) return;
                windowHrPeerId = data.peerId;

                const call = myPeer.call(data.peerId, stream);
                call.on('stream', hrStream => {
                    switchToHumanHR(hrStream);
                });
                peers[data.peerId] = call;
            }

            // 🟢 B. 有新人進房：打給他！(一般的應徵者)
            if (data.type === 'user_joined_group') {
                connectToNewUser(data.newPeerId, stream);
            }

            // 🟢 C. 有人離開：刪除畫面 (包含考官退場處理)
            if (data.type === 'user_left_group') {
                if (peers[data.peerId]) {
                    peers[data.peerId].close();
                    delete peers[data.peerId];
                }
                if (data.peerId === windowHrPeerId) {
                    revertToPlaceholderHR();
                } else {
                    const videoToRemoval = document.getElementById(`video_${data.peerId}`);
                    if (videoToRemoval) videoToRemoval.remove();
                }
            }

            // 🟢 D. AI 狀態與對話串流處理
            if (data.setupComplete) isSetupComplete = true;

            if (data.customType === 'kill_ai_audio') {
                window.isAIPaused = true;
                stopAllAudio();
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ customType: 'execute_backend_pause' }));
                }
                if (userRecognition) { try { userRecognition.start(); } catch (e) { } }
            }

            if (data.customType === 'resume_ai_audio') {
                window.isAIPaused = false;
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ customType: 'execute_backend_resume' }));
                }
                if (userRecognition) { try { userRecognition.stop(); } catch (e) { } }
            }

            if (data.customType === 'user_transcript') {
                appendTranscript('user', data.text);
            }

            if (data.customType === 'ai_transcript_final') {
                const finalRole = data.ai_role || window.currentAiRole || '技術主管';
                appendTranscript('ai', data.text, finalRole);
            }

            if (data.serverContent?.modelTurn?.parts) {
                if (window.isAIPaused) return;
                window.currentAiRole = data.ai_role || window.currentAiRole || '技術主管';
                let roleStr = window.currentAiRole.toUpperCase();
                let targetId = roleStr.includes('HR') ? 'aiModel_HR' : 'aiModel_Tech';

                for (const part of data.serverContent.modelTurn.parts) {
                    if (part.inlineData && part.inlineData.data) {
                        if (audioContext.state === 'suspended') await audioContext.resume();
                        playAudio(part.inlineData.data, targetId);
                    }
                }
            }

            if (data.serverContent?.interrupted) {
                stopAllAudio();
            }
        };

        // 麥克風音訊處理與 PCM 轉換傳輸
        audioAnalyser = audioContext.createAnalyser();
        audioAnalyser.fftSize = 2048;
        processor = audioContext.createScriptProcessor(4096, 1, 1);

        processor.onaudioprocess = (e) => {
            if (ws && ws.readyState === WebSocket.OPEN && isSetupComplete) {
                const inputData = e.inputBuffer.getChannelData(0);
                let rms = 0;
                for (let i = 0; i < inputData.length; i++) {
                    rms += inputData[i] * inputData[i];
                }
                rms = Math.sqrt(rms / inputData.length);

                let isMainSpeaker = rms >= AUDIO_VOLUME_GATE;
                const pcmData = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    let sample = isMainSpeaker ? inputData[i] : 0;
                    pcmData[i] = Math.max(-1, Math.min(1, sample)) * 32767;
                }

                const base64Audio = btoa(String.fromCharCode.apply(null, new Uint8Array(pcmData.buffer)));
                ws.send(JSON.stringify({
                    realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: base64Audio } }
                }));
            }
        };

        const sourceNode = audioContext.createMediaStreamSource(stream);
        sourceNode.connect(audioAnalyser);
        audioAnalyser.connect(processor);
        processor.connect(audioContext.destination);

    } catch (err) {
        console.error("相機啟動失敗:", err);
        const statusText = document.getElementById('status-text');
        if (statusText) {
            statusText.innerText = "❌ 找不到相機或麥克風";
            statusText.style.color = "red";
        }
        if (startBtn) startBtn.style.display = 'inline-block';
    }
}

// ==========================================
// 5. 背景連線與 DOM 控制函數
// ==========================================
function connectToNewUser(peerId, stream) {
    const call = myPeer.call(peerId, stream);
    const video = document.createElement('video');
    video.id = `video_${peerId}`;

    call.on('stream', userVideoStream => {
        if (peerId === windowHrPeerId) {
            switchToHumanHR(userVideoStream);
        } else {
            addVideoStream(video, userVideoStream);
        }
    });
    call.on('close', () => {
        if (peerId === windowHrPeerId) {
            revertToPlaceholderHR();
        } else {
            video.remove();
        }
    });
    peers[peerId] = call;
}

function addVideoStream(video, stream, elementId = '') {
    video.srcObject = stream;
    if (elementId) video.id = elementId;
    video.addEventListener('loadedmetadata', () => video.play());

    const grid = document.getElementById('video-grid');
    if (grid) grid.append(video);
}

// ==========================================
// 👑 真人考官狀態切換函數 (三劍客第三席控制)
// ==========================================
function switchToHumanHR(stream) {
    console.log("🎥 正在將真人考官串流接入第三席...");
    const placeholder = document.getElementById('hr-waiting-placeholder');
    if (placeholder) placeholder.style.display = 'none';

    const humanVideo = document.getElementById('humanHrVideo');
    if (humanVideo) {
        humanVideo.srcObject = stream;
        humanVideo.style.opacity = '1';
        humanVideo.play().catch(err => console.warn("考官視訊播放失敗:", err));
    }

    const hrLabel = document.getElementById('hr-label');
    if (hrLabel) {
        hrLabel.innerText = "👑 真人考官";
        hrLabel.style.background = "linear-gradient(45deg, #ff9800, #f39c12)";
        hrLabel.style.boxShadow = "0 2px 10px rgba(255, 152, 0, 0.5)";
    }

    const box = document.getElementById('transcriptBox');
    if (box) {
        if (!document.getElementById('human-join-alert')) {
            const alertDiv = document.createElement('div');
            alertDiv.id = 'human-join-alert';
            alertDiv.className = 'ai-msg';
            alertDiv.style.borderLeft = '4px solid #ff9800';
            alertDiv.style.backgroundColor = '#fff3e0';
            alertDiv.innerHTML = `<b>📢 系統提示：</b>真人面試官已加入會議，AI 與真人協同面試正式開始！`;
            box.appendChild(alertDiv);
            box.scrollTop = box.scrollHeight;
        }
    }
}

function revertToPlaceholderHR() {
    console.log("🚪 真人考官已離席，還原第三席狀態...");
    windowHrPeerId = null;

    const humanVideo = document.getElementById('humanHrVideo');
    if (humanVideo) {
        humanVideo.style.opacity = '0';
        humanVideo.srcObject = null;
    }

    const placeholder = document.getElementById('hr-waiting-placeholder');
    if (placeholder) placeholder.style.display = 'flex';

    const hrLabel = document.getElementById('hr-label');
    if (hrLabel) {
        hrLabel.innerText = "👤 真人面試官";
        hrLabel.style.background = "rgba(45, 52, 54, 0.8)";
        hrLabel.style.boxShadow = "none";
    }

    const alertDiv = document.getElementById('human-join-alert');
    if (alertDiv) alertDiv.remove();
}

// ==========================================
// 6. 頁面載入綁定按鈕監聽
// ==========================================
window.addEventListener('load', () => {
    const startBtn = document.getElementById('start-test-btn');
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            startGroupInterview();
        }, { once: true });
    }
});