const express = require('express');
const router = express.Router();
const supabase = require('../utils/supabase');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ⭐ 統一 API Key 讀取
const API_KEY = process.env.GEMINI_API_KEY_REPORT || process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(API_KEY);
const GEMINI_REPORT_MODEL = process.env.GEMINI_REPORT_MODEL || 'gemini-2.5-flash';

console.log(`🚀 [系統訊息] 報告路由模組已載入，準備使用模型: ${GEMINI_REPORT_MODEL}`);

/**
 * 1. 取得指定場次的履歷與面試資訊
 * 前端呼叫：fetch('/api/resume?session_id=...')
 */
router.get('/resume', async (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: "缺少 session_id 參數" });

    try {
        // 先找面試場次資訊
        const { data: sessionData, error: sessionErr } = await supabase
            .from('interview_sessions')
            .select('resume_id, applied_position, start_time')
            .eq('session_id', session_id)
            .single();

        if (sessionErr || !sessionData) throw new Error("找不到面試場次紀錄");

        // 若無綁定履歷 ID，回傳預設值
        if (!sessionData.resume_id) {
            return res.json({
                name: "應徵者",
                apply_role: sessionData.applied_position || "未指定",
                education: "未提供學歷",
                interview_date: new Date(sessionData.start_time).toLocaleDateString()
            });
        }

        // 撈取履歷詳細資料
        const { data: resumeData, error: resumeErr } = await supabase
            .from('resumes')
            .select('resume_name, education')
            .eq('resume_id', sessionData.resume_id)
            .single();

        if (resumeErr) throw new Error("找不到對應履歷");

        res.json({
            name: resumeData.resume_name,
            apply_role: sessionData.applied_position || "未指定",
            education: resumeData.education || "未提供學歷",
            interview_date: new Date(sessionData.start_time).toLocaleDateString()
        });
    } catch (err) {
        console.error('❌ 獲取履歷失敗:', err.message);
        res.status(500).json({ error: "履歷資料讀取失敗 (" + err.message + ")" });
    }
});

/**
 * 2. 取得逐字稿
 * 前端呼叫：fetch('/api/transcript?session_id=...')
 */
router.get('/transcript', async (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: "缺少 session_id" });
    try {
        const { data, error } = await supabase
            .from('transcripts')
            .select('text_content')
            .eq('session_id', session_id)
            .single();
        if (error || !data) return res.status(404).json({ error: "找不到該場次的對話紀錄" });
        res.json({ transcript: data.text_content });
    } catch (err) {
        res.status(500).json({ error: "伺服器錯誤" });
    }
});

/**
 * 3. 生成 AI 報告
 */
async function generateReportByGemini(prompt) {
    if (!API_KEY) throw new Error('找不到 API Key，請檢查 .env 設定');

    const model = genAI.getGenerativeModel({
        model: GEMINI_REPORT_MODEL,
        generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.4
        }
    });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    try {
        return JSON.parse(text);
    } catch (e) {
        const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```\s*$/i, '').trim();
        return JSON.parse(cleaned);
    }
}

function buildReportPrompt(transcript) {
    return `
        你是一位嚴格且專業的企業招募委員會總監。
        請深度分析以下這場「雙面試官（HR與部門主管）」與應徵者的面試對話紀錄，並給出客觀的綜合評估。
    對話紀錄：${transcript}
    格式要求：
    {
        "grade": "A/B/C/D",
        "grade_title": "總結標題",
        "overall_score": 0,
        "summary": "150字內總結",
        "highlights": ["亮點"],
        "concerns": ["待加強"],
        "qa": [{"question": "問題", "score": 0, "feedback": "建議"}]
    }`;
}

router.post('/generate-report', async (req, res) => {
    const { transcript } = req.body;
    console.log('📥 [API] 收到生成報告請求，內容長度:', transcript?.length || 0);

    if (!transcript || transcript.length < 5) {
        return res.status(400).json({ error: "對話紀錄太短或缺失" });
    }

    try {
        const report = await generateReportByGemini(buildReportPrompt(transcript));
        console.log('✅ [API] 報告生成成功！');
        return res.json(report);
    } catch (error) {
        console.error('❌ [API] 報告生成失敗:', error.message);
        res.status(500).json({ error: "AI 報告生成失敗: " + error.message });
    }
});

module.exports = router;