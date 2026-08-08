// 📁 routes/company_api.js
require('dotenv').config();
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

// 🌟 建立企業端上帝模式客戶端
const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    {
        auth: { persistSession: false, autoRefreshToken: false }
    }
);

router.post('/jobs', async (req, res) => {
    try {
        const { error } = await supabaseAdmin.from('jobs').insert([req.body]);
        if (error) throw error;
        res.json({ success: true, message: "職缺已成功發佈！" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/jobs', async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin.from('jobs').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/jobs/:id', async (req, res) => {
    try {
        const { error } = await supabaseAdmin.from('jobs').delete().eq('job_id', req.params.id); 
        if (error) throw error;
        res.json({ success: true, message: "職缺已成功刪除！" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/jobs/:id', async (req, res) => {
    try {
        const { error } = await supabaseAdmin.from('jobs').update(req.body).eq('job_id', req.params.id);
        if (error) throw error;
        res.json({ success: true, message: "職缺已成功更新！" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/profile', async (req, res) => {
    try {
        const { error } = await supabaseAdmin.from('company_profile').update(req.body).eq('id', 1);
        if (error) throw error;
        res.json({ success: true, message: "公司資訊更新成功！" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 🚀 1.求職者管理專用 API
// ==========================================

// 🌟 抓取「進行中」的面試名單 (戰情室大廳專用)
router.get('/active-sessions', async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('interview_sessions')
            .select('*, applicants(name)') 
            .eq('status', '進行中'); 

        if (error) throw error;
        
        res.json({ success: true, data: data });
    } catch (err) {
        console.error('撈取進行中名單失敗:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 🌟 應徵者關閉面試分頁時，主動通知結束場次
router.post('/end-session', express.text({ type: '*/*' }), async (req, res) => {
    try {
        let sessionId;
        try {
            sessionId = JSON.parse(req.body).sessionId;
        } catch (e) {
            sessionId = null;
        }
        if (!sessionId) return res.status(400).json({ success: false, error: '缺少 sessionId' });

        const { error } = await supabaseAdmin
            .from('interview_sessions')
            .update({ status: '已結束', end_time: new Date().toISOString() })
            .eq('session_id', sessionId)
            .eq('status', '進行中');

        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error('結束場次失敗:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 🚀 2.撈取應徵者名單 (加入 AI 分數與合適度)
// ==========================================
router.get('/applicants', async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('interview_sessions')
            .select(`
                session_id,
                job_id,
                status,
                start_time,
                applicants ( name, email ),
                jobs ( job_title, department ),
                evaluation_reports ( professional_score, full_report_json )
            `)
            .order('start_time', { ascending: false });

        if (error) throw error;

        // 整理資料，抽出分數與合適度送給前端
        const formattedData = data
            .filter(session => session.jobs && session.jobs.job_title) 
            .map(session => {
                let profScore = 'N/A';
                let suitability = 'N/A';
                
                let report = session.evaluation_reports;
                if (Array.isArray(report)) report = report[0];

                if (report) {
                    profScore = report.professional_score ?? 'N/A';
                    
                    let jsonObj = report.full_report_json;
                    if (typeof jsonObj === 'string') {
                        try { jsonObj = JSON.parse(jsonObj); } catch(e){}
                    }
                    
                    if (jsonObj && jsonObj.overall_score !== undefined) {
                        suitability = jsonObj.overall_score;
                    } else {
                        suitability = profScore; 
                    }
                }

                return {
                    session_id: session.session_id,
                    job_id: session.job_id,
                    job_title: session.jobs.job_title,
                    department: session.jobs.department || '未分類',
                    name: session.applicants?.name || '未知應徵者',
                    start_time: session.start_time,
                    status: session.status || 'status-2', 
                    profScore: profScore,
                    suitability: suitability,
                    hasReport: !!report
                };
            });

        res.json({ success: true, data: formattedData });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/applicants/:session_id/status', async (req, res) => {
    try {
        const { status, scheduled_time, room_id } = req.body; // 🌟 接收 room_id
        const sessionId = req.params.session_id;

        if (status === undefined) return res.status(400).json({ success: false, error: '缺少狀態參數' });

        // 🌟 準備更新資料：把時間或房間 ID 存進去
        let updateData = { status };
        if (scheduled_time) updateData.start_time = scheduled_time;
        if (room_id) updateData.room_id = room_id; // 🌟 將求職者與房間綁定

        const { error: updateError } = await supabaseAdmin
            .from('interview_sessions')
            .update(updateData)
            .eq('session_id', sessionId);
        if (updateError) throw updateError;

        if (status !== '') {
            const { data: sessionData, error: sessionError } = await supabaseAdmin
                .from('interview_sessions')
                .select('applicant_id, jobs(job_title)')
                .eq('session_id', sessionId)
                .single();

            if (!sessionError && sessionData && sessionData.applicant_id) {
                let autoMessage = '';
                if (status === 'status-1') autoMessage = '【系統自動通知】您好，我們已收到您的履歷資料，目前正在進行初步審核中，如進入面試階段將會另行通知。';
                else if (status === 'status-2') autoMessage = '【系統自動通知】您好，恭喜您通過第一階段，我們誠摯地邀請您參與後續的面試階段。';
                else if (status === 'status-3') autoMessage = '【系統自動通知】恭喜您錄取！我們非常期待您的加入，後續將寄送正式的報到通知信。';
                else if (status === 'status-4') autoMessage = '【系統自動通知】感謝您參與本次面試。經過審慎評估，目前暫無合適職缺，您的資料已存入人才庫。';
                else if (status === 'status-5') autoMessage = '【系統自動通知】您好，您的狀態已更新為「備取」，若有職缺釋出將第一時間與您聯繫。';
                else autoMessage = `【系統自動通知】您應徵的「${sessionData.jobs?.job_title || '該職缺'}」狀態已更新。`;

                await supabaseAdmin.from('messages').insert([{
                    applicant_id: sessionData.applicant_id,
                    sender_role: 'company',
                    content: autoMessage
                }]);
            }
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 📊 3.職缺綜合對比大報告 API
// ==========================================

// 🌟 讀取已生成的職缺綜合報告 (不觸發 AI，純讀快取)
router.get('/jobs/:jobId/comparison-report', async (req, res) => {
    try {
        const { jobId } = req.params;
        const { data, error } = await supabaseAdmin
            .from('job_comparison_reports')
            .select('*')
            .eq('job_id', jobId)
            .maybeSingle();

        if (error) throw error;
        if (!data) return res.json({ success: true, exists: false });

        res.json({
            success: true,
            exists: true,
            report: data.report_json,
            updated_at: data.updated_at,
            applicant_count: data.applicant_count_at_generation
        });
    } catch (err) {
        console.error('讀取職缺綜合報告失敗:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 🌟 生成 / 重新生成職缺綜合對比大報告
router.post('/jobs/:jobId/comparison-report', async (req, res) => {
    try {
        const { jobId } = req.params;

        const { data: sessions, error: sessionsErr } = await supabaseAdmin
            .from('interview_sessions')
            .select(`
                session_id,
                applicant_id,
                start_time,
                applicants ( name ),
                evaluation_reports ( professional_score, full_report_json )
            `)
            .eq('job_id', jobId);

        if (sessionsErr) throw sessionsErr;

        const latestByApplicant = {};
        (sessions || []).forEach(s => {
            let report = s.evaluation_reports;
            if (Array.isArray(report)) report = report[0];
            if (!report) return; 

            let jsonObj = report.full_report_json;
            if (typeof jsonObj === 'string') {
                try { jsonObj = JSON.parse(jsonObj); } catch (e) { jsonObj = {}; }
            }
            jsonObj = jsonObj || {};

            const existing = latestByApplicant[s.applicant_id];
            if (!existing || new Date(s.start_time) > new Date(existing.start_time)) {
                
                // 💡 關鍵瘦身：限制總結字數，並移除優缺點陣列，避免 Token 爆掉
                let shortSummary = jsonObj.summary || '';
                if (shortSummary.length > 100) shortSummary = shortSummary.substring(0, 100) + '...';

                latestByApplicant[s.applicant_id] = {
                    name: s.applicants?.name || '未知姓名',
                    professional_score: report.professional_score,
                    overall_score: jsonObj.overall_score,
                    summary: shortSummary
                };
            }
        });

        const candidateList = Object.values(latestByApplicant);
        if (candidateList.length === 0) {
            return res.status(400).json({ success: false, error: '此職缺尚無已完成評分的應徵者，無法生成報告。' });
        }

        const prompt = `
你是一位資深招募顧問。以下是同一個職缺、多位應徵者的 AI 面試評估摘要（JSON 陣列），
請針對這些人選進行交叉比較分析。請「只回傳 JSON」，不要有任何前後贅字或 Markdown 符號，格式如下：
{
  "job_overview": "針對此職缺目前應徵者整體素質的簡短總評（80字內）",
  "ranking": [
    { "name": "姓名", "overall_score": 數字, "reason": "簡短排名理由" }
  ],
  "top_recommendation": "目前最推薦優先面談/錄取的人選姓名與理由",
  "common_strengths": ["整體應徵者普遍優勢"],
  "common_gaps": ["整體應徵者普遍待加強之處"]
}

應徵者資料：
${JSON.stringify(candidateList, null, 2)}
`;

        const reportJson = await callGeminiForJson(prompt);

        const { error: upsertErr } = await supabaseAdmin
            .from('job_comparison_reports')
            .upsert({
                job_id: jobId,
                report_json: reportJson,
                applicant_count_at_generation: candidateList.length,
                updated_at: new Date().toISOString()
            }, { onConflict: 'job_id' });

        if (upsertErr) throw upsertErr;

        res.json({ success: true, report: reportJson, applicant_count: candidateList.length });
    } catch (err) {
        console.error('生成職缺綜合報告失敗:', err);
        // 如果是我們自己攔截的 API 忙碌錯誤，直接回傳給前端
        const errorMsg = err.message.includes('AI 伺服器目前較忙碌') ? err.message : err.message;
        res.status(500).json({ success: false, error: errorMsg });
    }
});

// 🌟 呼叫 Gemini 產生 JSON 格式報告
async function callGeminiForJson(prompt) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('缺少 GEMINI_API_KEY 環境變數');

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: 'application/json' }
            })
        }
    );

    if (!response.ok) {
        // 💡 友善錯誤攔截：如果遇到 429 錯誤，直接回傳白話文提示
        if (response.status === 429) {
            throw new Error('AI 伺服器目前較忙碌 (API 呼叫次數達免費上限)，請等待 30 秒後再重新點擊產生報告！');
        }
        
        const errText = await response.text();
        throw new Error(`Gemini API 呼叫失敗: ${errText}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini 未回傳有效內容');

    try {
        return JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch (e) {
        throw new Error('AI 回傳格式無法解析為 JSON');
    }
}

// ==========================================
// 💬 4.HR 訊息中心專用 API
// ==========================================

router.get('/chat/contacts', async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin.from('applicants').select('applicant_id, name');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/chat/:applicant_id', async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('messages')
            .select('*')
            .eq('applicant_id', req.params.applicant_id)
            .order('created_at', { ascending: true });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/chat/:applicant_id', async (req, res) => {
    try {
        const { content } = req.body;
        const { error } = await supabaseAdmin.from('messages').insert([{
            applicant_id: req.params.applicant_id,
            sender_role: 'company',
            content: content
        }]);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 🏢 5團體面試房間 (Group Rooms) 專用 API
// ==========================================

// 1. 取得所有進行中/等待中的團面房間
router.get('/group-rooms', async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('group_rooms')
            // 🌟 修改：加入 interview_sessions(count) 來動態計算人數
            .select('*, jobs(job_title), interview_sessions(count)') 
            .order('start_time', { ascending: true }); 

        if (error) throw error;
        
        // 🌟 新增：將 Supabase 回傳的 count 格式，整理成前端原本預期的 current_count
        const formattedData = data.map(room => ({
            ...room,
            current_count: room.interview_sessions?.[0]?.count || 0
        }));

        res.json({ success: true, data: formattedData });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. 新增一個團面房間
router.post('/group-rooms', async (req, res) => {
    try {
        const { start_time, max_capacity, session_id } = req.body;
        if (!start_time) return res.status(400).json({ success: false, error: '缺少開始時間' });

        let jobId = null;
        if (session_id) {
            const { data: sessionData } = await supabaseAdmin
                .from('interview_sessions')
                .select('job_id')
                .eq('session_id', session_id)
                .single();
            if (sessionData) jobId = sessionData.job_id;
        }

        const { data, error } = await supabaseAdmin
            .from('group_rooms')
            .insert([{ 
                start_time, 
                max_capacity: max_capacity || 6, 
                // 🌟 修改：已經刪除 current_count: 0，交給動態關聯計算
                status: '等待中',
                job_id: jobId 
            }])
            .select();

        if (error) throw error;
        res.json({ success: true, data: data[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// ==========================================
// 📅 6.面試場次管理專用 API (0room_manage.html)
// ==========================================

// 1. 取得所有場次與被排入的應徵者名單
router.get('/manage-sessions', async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('group_rooms')
            .select(`
                room_id,
                start_time,
                max_capacity,
                jobs ( job_title ),
                interview_sessions (
                    applicants ( name )
                )
            `) // 🌟 修改：已經從 select 中移除了 current_count
            .order('start_time', { ascending: true });

        if (error) throw error;
        
        // 🌟 新增：利用撈出來的應徵者名單陣列長度，動態補上 current_count 給前端
        const formattedData = data.map(room => ({
            ...room,
            current_count: room.interview_sessions ? room.interview_sessions.length : 0
        }));

        res.json({ success: true, data: formattedData });
    } catch (err) {
        console.error('撈取場次失敗:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. 更新面試場次 (時間、人數)
router.put('/group-rooms/:id', async (req, res) => {
    try {
        const roomId = req.params.id;
        const { start_time, max_capacity } = req.body;
        
        const { error } = await supabaseAdmin
            .from('group_rooms')
            .update({ start_time, max_capacity })
            .eq('room_id', roomId);
            
        if (error) throw error;
        res.json({ success: true, message: '場次更新成功' });
    } catch (err) {
        console.error('更新場次失敗:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. 刪除面試場次
router.delete('/group-rooms/:id', async (req, res) => {
    try {
        const roomId = req.params.id;
        
        // 🌟 防呆安全機制：先將原本綁定在這個房間的應徵者解綁，並退回狀態
        await supabaseAdmin
            .from('interview_sessions')
            .update({ room_id: null, status: 'status-1' })
            .eq('room_id', roomId);

        // 再刪除房間
        const { error } = await supabaseAdmin
            .from('group_rooms')
            .delete()
            .eq('room_id', roomId);
            
        if (error) throw error;
        res.json({ success: true, message: '場次已刪除' });
    } catch (err) {
        console.error('刪除場次失敗:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;