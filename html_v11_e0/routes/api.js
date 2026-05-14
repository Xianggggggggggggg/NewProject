const express = require('express');
const router = express.Router();
const supabase = require('../utils/supabase');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ⭐ 統一 API Key 讀取
const API_KEY = process.env.GEMINI_API_KEY_REPORT || process.env.GEMINI_API_KEY_REPORT;
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
        你是一位專業公正又輕微嚴格的企業招募經理。
        請嚴格分析以下這場「雙面試官（HR與部門主管）」與應徵者的面試對話紀錄，重點關注應徵者的專業能力、溝通表達、邏輯思維和潛在風險。難度設定為較高（120%），評分應該更注重專業性和實質表現。
    對話紀錄：${transcript}
    評分指引：
    - A級：表現傑出，專業能力強，幾乎沒有明顯缺點
    - B級：表現良好，具備足夠能力但有小瑕疵
    - C級：表現普通，基本能力不足或有明顯問題
    - D級：表現不佳，存在重大缺陷或不適任

    規則:
    1.面試官結束面試前面試者先結束面試，扣總分5分。
    
    格式要求：
    {
        "grade": "A/B/C/D",
        "grade_title": "總結標題",
        "overall_score": 0,
        "summary": "150字內總結，重點關注專業能力和潛在風險",
        "highlights": ["亮點"],
        "concerns": ["待改進之處"],
        "qa": [{"question": "問題", "score": 0, "feedback": "具體建議"}]
    }`;
}

router.post('/generate-report', async (req, res) => {
    const { transcript } = req.body;
    const sessionId = req.query.session_id;

    console.log('📥 [API] 收到生成報告請求，內容長度:', transcript?.length || 0);

    if (!transcript || transcript.length < 5) {
        return res.status(400).json({ error: "對話紀錄太短或缺失" });
    }

    if (!sessionId) {
        return res.status(400).json({ error: "缺少 session_id" });
    }

    try {
        const { data: existingReport, error: checkError } = await supabase
            .from('evaluation_reports')
            .select('full_report_json') // ✨ 改成新欄位
            .eq('session_id', sessionId)
            .not('full_report_json', 'is', null)
            .single();

        if (existingReport && existingReport.full_report_json) {
            console.log('✅ [API] 找到現有 jsonb 報告，直接返回');
            return res.json(existingReport.full_report_json); // ✨ 直接返回物件
        }

        if (existingReport && existingReport.full_report_json) {
            console.log('✅ [API] 找到現有報告，直接返回');
            return res.json(existingReport.full_report_json);
        }

        // 2. 如果沒有現有報告，才生成新的
        const report = await generateReportByGemini(buildReportPrompt(transcript));
        console.log('✅ [API] 報告生成成功！');

        // 3. 將報告儲存到資料庫 (配合新的 jsonb 欄位 full_report_json)
        const { error: saveError } = await supabase
            .from('evaluation_reports')
            .upsert({
                session_id: sessionId,
                full_report_json: report, // ✨ 改成正確欄位，且直接傳物件
                created_at: new Date().toISOString()
            }, {
                onConflict: 'session_id'
            });

        if (saveError) {
            console.error('⚠️ [API] 報告儲存失敗，但仍返回結果:', saveError.message);
        } else {
            console.log('✅ [API] 報告已儲存到資料庫');
        }

        return res.json(report);
    } catch (error) {
        console.error('❌ [API] 報告生成失敗:', error.message);
        res.status(500).json({ error: "AI 報告生成失敗: " + error.message });
    }
});

module.exports = router;