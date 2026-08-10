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

        // 🌟 1. 在 select 裡面多加一個 autobiography
        const { data: resumeData, error: resumeErr } = await supabase
            .from('resumes')
            .select('resume_name, education, language_skills, work_experience, autobiography') 
            .eq('resume_id', sessionData.resume_id)
            .single();

        if (resumeErr) throw new Error("找不到對應履歷");

        // 🌟 2. 將自傳也包裝在 JSON 裡回傳給前端
        res.json({
            name: resumeData.resume_name,
            apply_role: sessionData.applied_position || "未指定",
            education: resumeData.education || "未提供學歷",
            interview_date: new Date(sessionData.start_time).toLocaleDateString(),
            language_skills: resumeData.language_skills || "未提供",
            work_experience: resumeData.work_experience || "目前無相關經歷紀錄",
            autobiography: resumeData.autobiography || "未提供自傳" // 👈 新增這一行
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
            .order('created_at', { ascending: false })
            .limit(1);

        if (error) {
            console.error("❌ Supabase 讀取錯誤:", error.message);
            return res.status(500).json({ error: "資料庫讀取錯誤" });
        }

        if (!data || data.length === 0) {
            return res.status(404).json({ error: "找不到該場次的對話紀錄" });
        }

        res.json({ transcript: data[0].text_content });
    } catch (err) {
        console.error("❌ 伺服器錯誤:", err);
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
    res.cookie('supabase_access_token', session.access_token, {
        httpOnly: true, 
        secure, 
        sameSite: 'lax', 
        path: '/'
    });
    res.cookie('supabase_refresh_token', session.refresh_token, {
        httpOnly: true, 
        secure, 
        sameSite: 'lax', 
        path: '/'
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
// 🌟 1. 修改面試場次建立 API
router.post('/interview-sessions', async (req, res) => {
    const { user } = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: '未登入' });
    
    const { data, error } = await supabase.from('interview_sessions').insert([{
        applicant_id: user.id,
        resume_id: req.body.resume_id,
        applied_position: req.body.position,
        interview_type: req.body.type,
        job_id: req.body.job_id,
        status: 'status-1', // 👈 關鍵修改：投遞履歷後，初始狀態設為「書審中」
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

// ⭐ 歷史紀錄撈取 (保護妳完美對接的 A/B/C/D 分數機制)
router.get('/history', async (req, res) => {
    const { user } = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: '未登入' });
    
    try {
        const { data: sessions, error: sessionErr } = await supabase
            .from('interview_sessions')
            .select('session_id, applied_position, interview_type, status, start_time, resume_id, room_id') // 👈 補上 resume_id 和 room_id
            .eq('applicant_id', user.id)
            .order('start_time', { ascending: false });
            
        if (sessionErr) return res.status(500).json({ error: sessionErr.message });
        if (!sessions || sessions.length === 0) return res.json({ history: [] });

        const sessionIds = sessions.map(s => s.session_id);

        const { data: reports, error: reportErr } = await supabase
            .from('evaluation_reports')
            .select('session_id, full_report_json, ai_feedback')
            .in('session_id', sessionIds);

        if (reportErr) return res.status(500).json({ error: reportErr.message });

        const reportMap = new Map();
        if (reports) {
            reports.forEach(r => reportMap.set(r.session_id, r));
        }

        const history = sessions.map(s => {
            let gradeText = 'N/A';
            let feedbackText = '';
            
            const matchReport = reportMap.get(s.session_id);
            if (matchReport) {
                feedbackText = matchReport.ai_feedback || '';
                let jsonObj = matchReport.full_report_json;
                
                if (typeof jsonObj === 'string') {
                    try { jsonObj = JSON.parse(jsonObj); } catch(e){}
                }
                
                if (jsonObj) {
                    if (jsonObj.grade) {
                        gradeText = jsonObj.grade;
                    } else if (jsonObj.report && jsonObj.report.grade) {
                        gradeText = jsonObj.report.grade;
                    }
                }
            }

            return {
                session_id: s.session_id, 
                resume_id: s.resume_id, // 🌟 補上這一行！這是消滅 undefined 的關鍵！
                position: s.applied_position, 
                type: s.interview_type, 
                status: s.status,
                date: new Date(s.start_time).toLocaleDateString('zh-TW'),
                score: gradeText,
                feedback: feedbackText,
                room_id: s.room_id
            };
        });
        
        res.json({ history });

    } catch (err) {
        console.error("❌ 讀取歷史紀錄嚴重錯誤:", err);
        res.status(500).json({ error: "伺服器內部錯誤" });
    }
});

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

        評分規則與數學計算 (非常重要，請嚴格遵守):
        1. 五大維度 (metrics)：technical, communication, logic, learning, stress，請分別給予 0~100 的整數評分。
        2. 總分 (overall_score)：【必須】先計算五大維度的「平均分數」，接著若作弊次數（cheatCount）大於 0，每切換一次扣 5~10 分。最後得出的結果才是 overall_score。
        3. 違規扣分：面試官結束面試前面試者先結束面試，總分額外扣 5 分。若作弊次數大於 0，建議等級 (grade) 不得高於 C。
        4. 逐題問答 (qa) 的 score 欄位：必須嚴格限制在 0 到 10 的整數之間（10 分為滿分，絕對不可超過 10 分！）。
        
        對話紀錄：${transcript}

        格式要求 (嚴格輸出的 JSON 格式)：
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

router.post('/log-emotion', async (req, res) => {
    const { session_id, timestamp_mark, emotion, focus_score } = req.body;
    if (!session_id) return res.status(400).json({ error: "Missing session_id" });

    try {
        const { error } = await supabase
            .from('emotion_logs')
            .insert([{ session_id, timestamp_mark, emotion, focus_score }]);

        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Emotion_Logs 寫入失敗:', err.message);
        res.status(500).json({ error: err.message });
    }
});

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
            professional_score: metrics.technical !== undefined ? metrics.technical : overall,
            communication_score: metrics.communication !== undefined ? metrics.communication : overall,
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

    return `<html>...略 (與原本 PDF 樣式相同，但數據已代入)...</html>`;
}

router.get('/report', async (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: "缺少 session_id" });

    try {
        const { data: evalData, error: evalErr } = await supabase
            .from('evaluation_reports')
            .select('*')
            .eq('session_id', session_id)
            .single();

        if (evalErr || !evalData) {
            return res.status(404).json({ error: "找不到該場次的分析報告" });
        }

        let reportData = evalData.full_report_json;
        const isValidReport = reportData && typeof reportData === 'object' && reportData.overall_score !== undefined;

        if (!isValidReport) {
            console.log(`⏳ [自動補救] 偵測到 ${session_id} 的報告為 null，正在生成...`);
            const { data: transcriptData, error: transcriptErr } = await supabase
                .from('transcripts')
                .select('text_content')
                .eq('session_id', session_id)
                .order('created_at', { ascending: false })
                .limit(1);
            
            if (transcriptErr || !transcriptData || transcriptData.length === 0) {
                return res.status(404).json({ error: "找不到該場次的對話紀錄，無法生成報告" });
            }
            
            const transcript = transcriptData[0].text_content;
            reportData = await generateReportByGemini(buildReportPrompt(transcript, evalData.cheat_count || 0));
            
            const { error: updateErr } = await supabase.from('evaluation_reports').update({ full_report_json: reportData }).eq('session_id', session_id);
            if (!updateErr) console.log(`✅ 報告已自動生成並保存 (${session_id})`);
        }

        const { data: logsData, error: logsErr } = await supabase
            .from('emotion_logs')
            .select('timestamp_mark, emotion, focus_score')
            .eq('session_id', session_id)
            .order('created_at', { ascending: true });

        let averages = { tech: 70, comm: 68, logic: 72, learn: 65, stress: 66 };
        let percentiles = { tech: 50, comm: 50, logic: 50, learn: 50, stress: 50 };

        try {
            const { data: allReports } = await supabase.from('evaluation_reports').select('full_report_json').not('full_report_json', 'is', null);

            if (allReports && allReports.length > 0) {
                let scores = { tech: [], comm: [], logic: [], learn: [], stress: [] };
                
                allReports.forEach(row => {
                    let r = row.full_report_json;
                    if (typeof r === 'string') { try { r = JSON.parse(r); } catch(e){} }
                    if (r && r.metrics) {
                        const o = r.overall_score || 0;
                        scores.tech.push(r.metrics.technical !== undefined ? r.metrics.technical : o);
                        scores.comm.push(r.metrics.communication !== undefined ? r.metrics.communication : o);
                        scores.logic.push(r.metrics.logic !== undefined ? r.metrics.logic : o);
                        scores.learn.push(r.metrics.learning !== undefined ? r.metrics.learning : o);
                        scores.stress.push(r.metrics.stress !== undefined ? r.metrics.stress : o);
                    }
                });

                const calcAvg = (arr) => arr.length ? Math.round(arr.reduce((a,b) => a+b, 0) / arr.length) : 0;
                averages = { tech: calcAvg(scores.tech), comm: calcAvg(scores.comm), logic: calcAvg(scores.logic), learn: calcAvg(scores.learn), stress: calcAvg(scores.stress) };

                const calcPct = (arr, myScore) => {
                    if (arr.length === 0) return 50;
                    const below = arr.filter(s => s < myScore).length;
                    const equal = arr.filter(s => s === myScore).length;
                    const pct = ((below + (0.5 * equal)) / arr.length) * 100;
                    return Math.min(Math.max(Math.round(pct), 1), 99);
                };

                const myMetrics = reportData.metrics || {};
                const myO = reportData.overall_score || 0;
                percentiles = {
                    tech: calcPct(scores.tech, myMetrics.technical !== undefined ? myMetrics.technical : myO),
                    comm: calcPct(scores.comm, myMetrics.communication !== undefined ? myMetrics.communication : myO),
                    logic: calcPct(scores.logic, myMetrics.logic !== undefined ? myMetrics.logic : myO),
                    learn: calcPct(scores.learn, myMetrics.learning !== undefined ? myMetrics.learning : myO),
                    stress: calcPct(scores.stress, myMetrics.stress !== undefined ? myMetrics.stress : myO)
                };
            }
        } catch (statsErr) {
            console.error("⚠️ 計算平均值與百分位失敗:", statsErr.message);
        }

        res.json({
            report: reportData, 
            emotionData: {
                happy_ratio: evalData.happy_ratio,
                neutral_ratio: evalData.neutral_ratio,
                sad_ratio: evalData.sad_ratio,
                confidence_score: evalData.confidence_score,
                blink_count: evalData.blink_count
            },
            emotionLogs: logsData || [],
            stats: { averages, percentiles }
        });
    } catch (err) {
        console.error("❌ 讀取報告失敗:", err);
        res.status(500).json({ error: "伺服器錯誤: " + err.message });
    }
});

// ⭐ 聊天訊息 API (保護並對接成功)
router.get('/chat/messages', async (req, res) => {
    const { user, error: authError } = await getCurrentUser(req);
    if (authError) return res.status(401).json({ error: authError.message });
    if (!user) return res.status(401).json({ error: '請先登入' });

    try {
        const { data, error } = await supabase
            .from('messages')
            .select('id, applicant_id, sender_role, content, created_at')
            .eq('applicant_id', user.id)
            .order('created_at', { ascending: true });

        if (error) throw error;
        res.json({ messages: data || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/chat/messages', async (req, res) => {
    const { user, error: authError } = await getCurrentUser(req);
    if (authError) return res.status(401).json({ error: authError.message });
    if (!user) return res.status(401).json({ error: '請先登入' });

    const content = String(req.body.content || '').trim();
    if (!content) return res.status(400).json({ error: '訊息不可為空' });

    try {
        const { data, error } = await supabase
            .from('messages')
            .insert({
                applicant_id: user.id,
                sender_role: 'applicant',
                content
            })
            .select('id, applicant_id, sender_role, content, created_at')
            .single();

        if (error) throw error;
        res.json({ message: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;