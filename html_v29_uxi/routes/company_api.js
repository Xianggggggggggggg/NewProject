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
// 🚀 求職者管理專用 API
// ==========================================

// ==========================================
// 🚀 求職者管理專用 API
// ==========================================

// 🌟 抓取「進行中」的面試名單 (戰情室大廳專用)
router.get('/active-sessions', async (req, res) => {
    try {
        // 從資料庫找出所有狀態為「進行中」的房間，順便把應徵者名字也撈出來
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

// 👇 下面接著你原本的 router.get('/applicants', ...)

router.get('/applicants', async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('interview_sessions')
            .select(`
                session_id,
                status,
                start_time,
                applicants ( name, email ),
                jobs ( department, job_title ),
                evaluation_reports ( report_id )
            `)
            .order('start_time', { ascending: false });

        if (error) throw error;

        // 🌟 關鍵修復：先過濾 (filter) 掉沒有職缺、沒有部門的髒資料，再進行 map 整理
        const formattedData = data
            .filter(session => session.jobs && session.jobs.department) 
            .map(session => ({
                session_id: session.session_id,
                department: session.jobs.department,
                name: session.applicants?.name || '未知應徵者',
                job_title: session.jobs.job_title,
                status: session.status || 'status-2', 
                hasReport: !!session.evaluation_reports
            }));

        res.json({ success: true, data: formattedData });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/applicants/:session_id/status', async (req, res) => {
    try {
        const { status } = req.body;
        const sessionId = req.params.session_id;

        // 🌟 修正 1：把 if (!status) 改成明確檢查 undefined，允許空字串 ("") 通過
        if (status === undefined) return res.status(400).json({ success: false, error: '缺少狀態參數' });

        // 1. 先更新資料庫中的狀態
        const { error: updateError } = await supabaseAdmin
            .from('interview_sessions')
            .update({ status })
            .eq('session_id', sessionId);
        if (updateError) throw updateError;

        // 🌟 修正 2：如果狀態是空的 (尚未點選狀態)，就不發送自動通知信
        if (status !== '') {
            // 2. 撈取該求職者的 ID 與職缺名稱
            const { data: sessionData, error: sessionError } = await supabaseAdmin
                .from('interview_sessions')
                .select('applicant_id, jobs(job_title)')
                .eq('session_id', sessionId)
                .single();

            if (!sessionError && sessionData && sessionData.applicant_id) {
                let autoMessage = '';
                if (status === 'status-1') autoMessage = '【系統自動通知】您好，我們已收到您的面試資料，目前正在進行初步審核中。';
                else if (status === 'status-2') autoMessage = '【系統自動通知】您好，我們誠摯地邀請您參與後續的面試階段，將有專人與您聯繫安排時間。';
                else if (status === 'status-3') autoMessage = '【系統自動通知】恭喜您錄取！我們非常期待您的加入，後續將寄送正式的報到通知信。';
                else if (status === 'status-4') autoMessage = '【系統自動通知】感謝您參與本次面試。經過審慎評估，目前暫無合適職缺，您的資料已存入人才庫。';
                else if (status === 'status-5') autoMessage = '【系統自動通知】您好，您的狀態已更新為「備取」，若有職缺釋出將第一時間與您聯繫。';
                else autoMessage = `【系統自動通知】您應徵的「${sessionData.jobs?.job_title || '該職缺'}」狀態已更新。`;

                // 寫入訊息表
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
// 💬 HR 訊息中心專用 API
// ==========================================

// 1. 取得左側聯絡人列表 (🌟 修正：改成 applicants)
router.get('/chat/contacts', async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin.from('applicants').select('applicant_id, name');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. 取得與特定求職者的歷史對話 (🌟 修正：改成 messages)
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

// 3. HR 手動傳送新訊息 (🌟 修正：改成 messages)
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

module.exports = router;