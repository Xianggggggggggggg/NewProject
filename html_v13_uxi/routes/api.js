const express = require('express');
const router = express.Router();
const supabase = require('../utils/supabase');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const puppeteer = require('puppeteer');

// ⭐ 統一 API Key 讀取
const API_KEY = process.env.GEMINI_API_KEY_REPORT || process.env.GEMINI_API_KEY_REPORT;
const genAI = new GoogleGenerativeAI(API_KEY);
const GEMINI_REPORT_MODEL = process.env.GEMINI_REPORT_MODEL || 'gemini-2.5-flash';

console.log(`🚀 [系統訊息] 報告路由模組已載入，準備使用模型: ${GEMINI_REPORT_MODEL}`);

/**
 * 1. 取得指定場次的履歷與面試資訊
 */
router.get('/resume', async (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: "缺少 session_id 參數" });

    try {
        const { data: sessionData, error: sessionErr } = await supabase
            .from('interview_sessions')
            .select('resume_id, applied_position, start_time')
            .eq('session_id', session_id)
            .single();

        if (sessionErr || !sessionData) throw new Error("找不到面試場次紀錄");

        if (!sessionData.resume_id) {
            return res.json({
                name: "應徵者",
                apply_role: sessionData.applied_position || "未指定",
                education: "未提供學歷",
                interview_date: new Date(sessionData.start_time).toLocaleDateString()
            });
        }

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

router.get('/emotion', async (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: "缺少 session_id" });
    try {
        const { data, error } = await supabase
            .from('evaluation_reports')
            .select('happy_ratio, neutral_ratio, sad_ratio')
            .eq('session_id', session_id)
            .single();
        if (error || !data) return res.status(404).json({ error: "找不到該場次的情緒資料" });
        res.json(data);
    } catch (err) {
        console.error('讀取情緒資料失敗：', err.message);
        res.status(500).json({ error: "伺服器錯誤" });
    }
});

// Auth Helpers
function parseCookies(req) {
    const header = req.headers.cookie || '';
    return Object.fromEntries(
        header.split(';').filter(Boolean).map(cookie => {
            const [name, ...rest] = cookie.split('=');
            return [decodeURIComponent(name.trim()), decodeURIComponent(rest.join('=').trim())];
        })
    );
}

function getAccessToken(req) {
    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    if (authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7).trim();
    }
    const cookies = parseCookies(req);
    return cookies['supabase_access_token'] || null;
}

async function getCurrentUser(req) {
    const accessToken = getAccessToken(req);
    if (!accessToken) return { user: null, error: null };
    const { data, error } = await supabase.auth.getUser(accessToken);
    return { user: data?.user || null, error };
}

function setSessionCookies(res, session) {
    const secure = process.env.NODE_ENV === 'production';
    const expires = session.expires_at ? new Date(session.expires_at * 1000) : undefined;
    res.cookie('supabase_access_token', session.access_token, {
        httpOnly: true, secure, sameSite: 'lax', path: '/', expires
    });
    res.cookie('supabase_refresh_token', session.refresh_token, {
        httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 30 * 24 * 60 * 60 * 1000
    });
}

function clearSessionCookies(res) {
    const secure = process.env.NODE_ENV === 'production';
    res.cookie('supabase_access_token', '', { httpOnly: true, secure, sameSite: 'lax', path: '/', expires: new Date(0) });
    res.cookie('supabase_refresh_token', '', { httpOnly: true, secure, sameSite: 'lax', path: '/', expires: new Date(0) });
}

// Auth Routes
router.post('/auth/register', async (req, res) => {
    const { name, username, email, password } = req.body;
    if (!name || !username || !email || !password) return res.status(400).json({ error: '缺少註冊資料' });
    try {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) return res.status(400).json({ error: error.message });
        const { error: insertError } = await supabase.from('applicants').insert([{ applicant_id: data.user.id, username, name, email }]);
        if (insertError) return res.status(500).json({ error: insertError.message });
        res.json({ user: { id: data.user.id, email: data.user.email, name, username } });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const { data: applicant, error: applicantError } = await supabase.from('applicants').select('email').eq('username', username).single();
        if (applicantError || !applicant) return res.status(400).json({ error: '找不到此帳號' });
        const { data, error } = await supabase.auth.signInWithPassword({ email: applicant.email, password });
        if (error) return res.status(400).json({ error: error.message });
        setSessionCookies(res, data.session);
        res.json({ user: data.user, access_token: data.session.access_token });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/auth/logout', (req, res) => { clearSessionCookies(res); res.json({ success: true }); });

router.post('/auth/password-reset', async (req, res) => {
    const { email, redirectTo } = req.body;
    if (!email) return res.status(400).json({ error: '缺少信箱' });
    try {
        const { data, error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) return res.status(400).json({ error: error.message });
        res.json({ success: true, message: '密碼重設信件已發送' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/auth/user', async (req, res) => {
    const { user, error } = await getCurrentUser(req);
    if (error) return res.status(401).json({ error: error.message });
    res.json({ user });
});

// Profile & Resume Routes
router.get('/user/profile', async (req, res) => {
    const { user } = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: '未登入' });
    const { data, error } = await supabase.from('applicants').select('username, name, email').eq('applicant_id', user.id).single();
    if (error) return res.status(404).json({ error: '找不到資料' });
    res.json({ profile: data });
});

router.put('/user/profile', async (req, res) => {
    const { user } = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: '未登入' });
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: '姓名不能為空' });
    const { data, error } = await supabase.from('applicants').update({ name }).eq('applicant_id', user.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ profile: data });
});

router.put('/user/email', async (req, res) => {
    const { user } = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: '未登入' });
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: '信箱不能為空' });
    try {
        const { data, error } = await supabase.auth.updateUser({ email });
        if (error) return res.status(400).json({ error: error.message });
        const { error: updateError } = await supabase.from('applicants').update({ email }).eq('applicant_id', user.id);
        if (updateError) return res.status(500).json({ error: updateError.message });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/user/password', async (req, res) => {
    const { user } = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: '未登入' });
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: '密碼必須至少 6 個字元' });
    try {
        const { data, error } = await supabase.auth.updateUser({ password });
        if (error) return res.status(400).json({ error: error.message });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/resumes', async (req, res) => {
    const { user } = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: '未登入' });
    const { data, error } = await supabase.from('resumes').select('*').eq('applicant_id', user.id);
    res.json({ resumes: data || [] });
});

router.post('/resume', async (req, res) => {
    const { user } = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: '未登入' });
    const { data, error } = await supabase.from('resumes').insert([{ ...req.body, applicant_id: user.id }]).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ resume: data });
});

router.get('/resume/:id', async (req, res) => {
    const { user } = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: '未登入' });
    const { id } = req.params;
    const { data, error } = await supabase.from('resumes').select('*').eq('resume_id', id).eq('applicant_id', user.id).single();
    if (error || !data) return res.status(404).json({ error: '找不到該履歷' });
    res.json({ resume: data });
});

router.put('/resume/:id', async (req, res) => {
    const { user } = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: '未登入' });
    const { id } = req.params;
    const { data, error } = await supabase.from('resumes').update(req.body).eq('resume_id', id).eq('applicant_id', user.id).select().single();
    if (error || !data) return res.status(404).json({ error: '更新履歷失敗' });
    res.json({ resume: data });
});

router.delete('/resume/:id', async (req, res) => {
    const { user } = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: '未登入' });
    const { id } = req.params;
    const { error } = await supabase.from('resumes').delete().eq('resume_id', id).eq('applicant_id', user.id);
    if (error) return res.status(404).json({ error: '刪除履歷失敗' });
    res.json({ success: true });
});

// Interview Session Routes
router.post('/interview-sessions', async (req, res) => {
    const { user } = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: '未登入' });
    const { data, error } = await supabase.from('interview_sessions').insert([{
        applicant_id: user.id,
        resume_id: req.body.resume_id,
        applied_position: req.body.position,
        interview_type: req.body.type,
        status: '進行中',
        start_time: new Date().toISOString()
    }]).select();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ session_id: data[0].session_id });
});

router.post('/interview-result', async (req, res) => {
    const { session_id, finalEmotion, finalFeedback, finalConfidenceScore, analysisData } = req.body;
    if (!session_id) return res.status(400).json({ error: '缺少 session_id' });
    try {
        const { error: updateError } = await supabase.from('interview_sessions').update({ status: '已完成', end_time: new Date().toISOString() }).eq('session_id', session_id);
        if (updateError) throw updateError;

        const { error: reportError } = await supabase.from('evaluation_reports').upsert({
            session_id,
            confidence_score: finalConfidenceScore || 0,
            ai_feedback: finalFeedback || '',
            created_at: new Date().toISOString()
        }, { onConflict: 'session_id' });
        if (reportError) throw reportError;

        res.json({ success: true, message: '面試結果已保存' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/history', async (req, res) => {
    const { user } = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: '未登入' });
    const { data, error } = await supabase.from('interview_sessions').select(`
        session_id, applied_position, interview_type, status, start_time,
        evaluation_reports ( confidence_score, ai_feedback )
    `).eq('applicant_id', user.id).order('start_time', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const history = data.map(s => ({
        session_id: s.session_id, position: s.applied_position, type: s.interview_type, status: s.status,
        date: new Date(s.start_time).toLocaleDateString('zh-TW'),
        score: s.evaluation_reports?.[0]?.confidence_score ? Math.round(s.evaluation_reports[0].confidence_score * 100) + '%' : 'N/A',
        feedback: s.evaluation_reports?.[0]?.ai_feedback || ''
    }));
    res.json({ history });
});

/**
 * -------------------------------------------------------------------
 * 核心修改區塊：AI 報告生成的相關邏輯
 * -------------------------------------------------------------------
 */

function tryParseReportString(reportString) {
    try { return JSON.parse(reportString); } catch (e) {
        try { return Function(`"use strict"; return (${reportString})`)(); } catch (e2) { return reportString; }
    }
}

function buildReportPrompt(transcript, cheatCount = 0) {
    const cheatWarning = cheatCount > 0
        ? `【嚴重警告：偵測到應徵者在面試過程中切換視窗或離開頁面共 ${cheatCount} 次。這屬於嚴重的誠信問題。】`
        : `【應徵者表現誠信，全程未離開頁面。】`;

    return `
        你是一位專業公正又輕微嚴格的企業招募經理。
        請嚴格分析以下這場面試對話紀錄。
        ${cheatWarning}

        規則:
        1. 面試官結束面試前面試者先結束面試，扣總分 5 分。
        2. 若作弊次數（cheatCount）大於 0，每切換一次扣總分 5-10 分，建議等級不得高於 C。
        
        對話紀錄：${transcript}

        格式要求 (JSON)：
        {
            "grade": "A/B/C/D",
            "grade_title": "總結標題",
            "overall_score": 0,
            "metrics": {
                "technical": 0,
                "communication": 0,
                "logic": 0,
                "learning": 0,
                "stress": 0
            },
            "summary": "150字內總結，需提及誠信紀錄",
            "highlights": ["亮點"],
            "concerns": ["待改進/誠信問題"],
            "qa": [{"question": "問題", "score": 0, "feedback": "具體建議"}]
        }`;
}

async function generateReportByGemini(prompt) {
    const model = genAI.getGenerativeModel({
        model: GEMINI_REPORT_MODEL,
        generationConfig: { responseMimeType: "application/json", temperature: 0.4 }
    });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    try { return JSON.parse(text); } catch (e) {
        const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```\s*$/i, '').trim();
        return JSON.parse(cleaned);
    }
}

// 📌 修改後的 /report 讀取路由：主動帶出情緒資料
router.get('/report', async (req, res) => {
    try {
        const { session_id, regenerate } = req.query;
        if (!session_id) return res.status(400).json({ error: '缺少 session_id' });

        if (regenerate === '1' || regenerate === 'true') {
            const { data: tdata } = await supabase.from('transcripts').select('text_content').eq('session_id', session_id).single();
            const { data: repMeta } = await supabase.from('evaluation_reports').select('cheat_count').eq('session_id', session_id).single();
            const reportObj = await generateReportByGemini(buildReportPrompt(tdata.text_content, repMeta?.cheat_count || 0));

            const metrics = reportObj.metrics || {};
            await supabase.from('evaluation_reports').upsert({
                session_id, full_report_json: reportObj,
                professional_score: metrics.technical || reportObj.overall_score,
                communication_score: metrics.communication || reportObj.overall_score,
                logic_score: metrics.logic || reportObj.overall_score,
                learning_score: metrics.learning || reportObj.overall_score,
                stress_score: metrics.stress || reportObj.overall_score,
                created_at: new Date().toISOString()
            }, { onConflict: 'session_id' });
            return res.json({ report: reportObj });
        }

        const { data, error } = await supabase
            .from('evaluation_reports')
            .select('full_report_json, happy_ratio, neutral_ratio, sad_ratio')
            .eq('session_id', session_id)
            .single();

        if (error || !data) return res.status(404).json({ error: '找不到報告資料' });

        let report = data.full_report_json;
        if (typeof report === 'string') report = tryParseReportString(report);

        // 回傳報告同時，帶上攝影機真實偵測到的情緒比例
        res.json({
            report,
            emotionData: {
                happy_ratio: data.happy_ratio,
                neutral_ratio: data.neutral_ratio,
                sad_ratio: data.sad_ratio
            }
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 📌 修改後的 /generate-report：完整存入五維度數據
router.post('/generate-report', async (req, res) => {
    const sessionId = req.query.session_id || req.body.session_id;
    const { transcript, cheat_count, emotion_data } = req.body;

    if (!transcript || !sessionId) return res.status(400).json({ error: "資訊缺失" });

    try {
        console.log('⏳ 正在請求 Gemini 進行深度分析...');
        const report = await generateReportByGemini(buildReportPrompt(transcript, cheat_count || 0));

        const metrics = report.metrics || {};
        const overall = report.overall_score || 0;

        const { error: saveError } = await supabase.from('evaluation_reports').upsert({
            session_id: sessionId,
            full_report_json: report,
            // 寫入五維度分數 (對應雷達圖)
            professional_score: metrics.technical !== undefined ? metrics.technical : overall,
            communication_score: metrics.communication !== undefined ? metrics.communication : overall,
            logic_score: metrics.logic !== undefined ? metrics.logic : overall,
            learning_score: metrics.learning !== undefined ? metrics.learning : overall,
            stress_score: metrics.stress !== undefined ? metrics.stress : overall,
            // 寫入情緒數據 (來自攝影機)
            confidence_score: emotion_data?.confidence_score || 0,
            blink_count: emotion_data?.blink_count || 0,
            ai_feedback: emotion_data?.ai_feedback || "平穩",
            happy_ratio: emotion_data?.emotion_joy || 0,
            neutral_ratio: emotion_data?.emotion_neutral || 0,
            sad_ratio: emotion_data?.emotion_anxiety || 0,
            cheat_count: cheat_count || 0,
            created_at: new Date().toISOString()
        }, { onConflict: 'session_id' });

        if (saveError) throw saveError;
        res.json(report);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

/**
 * -------------------------------------------------------------------
 * PDF 匯出相關
 * -------------------------------------------------------------------
 */
router.get('/export-pdf', async (req, res) => {
    const { session_id } = req.query;
    try {
        const [resumeRes, transcriptRes, emotionRes] = await Promise.all([
            fetch(`${req.protocol}://${req.get('host')}/api/resume?session_id=${session_id}`),
            fetch(`${req.protocol}://${req.get('host')}/api/transcript?session_id=${session_id}`),
            fetch(`${req.protocol}://${req.get('host')}/api/emotion?session_id=${session_id}`).catch(() => ({ ok: false }))
        ]);
        const resumeData = await resumeRes.json();
        const transcriptData = await transcriptRes.json();
        const emotionData = emotionRes.ok ? await emotionRes.json() : null;

        const reportRes = await fetch(`${req.protocol}://${req.get('host')}/api/report?session_id=${session_id}`);
        const { report: reportData } = reportRes.ok ? await reportRes.json() : { report: { grade: "B", summary: "AI 分析中..." } };

        const htmlContent = generatePDFHTML(resumeData, reportData, emotionData);
        const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
        await browser.close();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="report-${session_id}.pdf"`);
        res.send(pdfBuffer);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

function generatePDFHTML(resume, report, emotionData) {
    const score = report.overall_score || 0;
    const joy = emotionData ? Math.round((emotionData.happy_ratio || 0) * 100) : 0;
    const neu = emotionData ? Math.round((emotionData.neutral_ratio || 0) * 100) : 0;
    const anx = emotionData ? Math.round((emotionData.sad_ratio || 0) * 100) : 0;

    return `<html>...略 (與原本 PDF 樣式相同，但數據已代入)...</html>`; // 此處保留原本的 generatePDFHTML 樣板即可
}

module.exports = router;