// 📁 routes/company_api.js
require('dotenv').config();
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');

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
                        try { jsonObj = JSON.parse(jsonObj); } catch (e) { }
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

        // 改為呼叫 OpenAI
        const reportJson = await callOpenAIForJson(prompt);

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

// 🌟 呼叫 OpenAI 產生 JSON 格式報告
async function callOpenAIForJson(prompt) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('缺少 OPENAI_API_KEY 環境變數，請在 .env 檔案中設定');

    const openai = new OpenAI({ apiKey: apiKey });

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini", // 速度快且成本極低的強大模型
            response_format: { type: "json_object" }, // 強制回傳 JSON 格式
            messages: [
                {
                    role: "system",
                    content: "你是一位資深招募顧問。請嚴格依照使用者的要求進行分析，並且務必只輸出合法的 JSON 格式，絕對不要包含任何 Markdown 標記 (如 ```json)。"
                },
                {
                    role: "user",
                    content: prompt
                }
            ]
        });

        const text = response.choices[0].message.content;
        if (!text) throw new Error('OpenAI 未回傳有效內容');

        return JSON.parse(text.trim());
    } catch (error) {
        console.error("OpenAI 發生錯誤:", error);
        throw new Error(`AI 報告生成失敗: ${error.message}`);
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
            `)
            .order('start_time', { ascending: true });

        if (error) throw error;

        const formattedData = (data || []).map(room => ({
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

// ==========================================
// 👥 團體面試專屬：單場多人面試綜合對比報告 API (逐字稿直讀版)
// ==========================================

router.post('/group-rooms/:roomId/report', async (req, res) => {
    try {
        const { roomId } = req.params;

        const { data: sessions, error: sessionsErr } = await supabaseAdmin
            .from('interview_sessions')
            .select(`
                session_id,
                applicants ( name ),
                evaluation_reports ( confidence_score, happy_ratio, neutral_ratio, sad_ratio, blink_count )
            `)
            .eq('room_id', roomId);

        if (sessionsErr) throw sessionsErr;
        if (!sessions || sessions.length === 0) {
            return res.status(400).json({ success: false, error: '此團面房間尚無應徵者參與。' });
        }

        const candidates = sessions.map(s => {
            let emo = s.evaluation_reports;
            if (Array.isArray(emo)) emo = emo[0];
            return {
                name: s.applicants?.name || '未知應徵者',
                session_id: s.session_id,
                emotion: emo ? {
                    confidence_score: emo.confidence_score ?? null,
                    happy_ratio: emo.happy_ratio ?? null,
                    neutral_ratio: emo.neutral_ratio ?? null,
                    sad_ratio: emo.sad_ratio ?? null,
                    blink_count: emo.blink_count ?? null
                } : null
            };
        });

        const candidateNames = candidates.map(c => c.name).filter(Boolean);
        const sessionIds = sessions.map(s => s.session_id);

        const { data: transcripts, error: transErr } = await supabaseAdmin
            .from('transcripts')
            .select('text_content')
            .in('session_id', sessionIds)
            .order('created_at', { ascending: false })
            .limit(1);

        if (transErr) throw transErr;
        if (!transcripts || transcripts.length === 0) {
            return res.status(400).json({ success: false, error: '此場團體面試尚無完整的對話逐字稿，無法進行 AI 分析。' });
        }

        const groupTranscript = transcripts[0].text_content;

        const perCandidateTranscript = splitTranscriptByCandidate(groupTranscript, candidateNames);
        candidates.forEach(c => {
            c.transcript_snippet = (perCandidateTranscript[c.name] || []).join('\n\n')
                || '（此應徵者在逐字稿中沒有偵測到發言紀錄）';
        });

        const prompt = `
你是一位資深招募顧問，正在針對一場「多人團體面試」進行逐一評分與橫向比較。
參與者：${candidateNames.join('、')}。

以下已針對「每一位」應徵者，從完整逐字稿中抽取出僅屬於他/她自己的提問與回答片段：

${candidates.map(c => `\n【${c.name} 的專屬對話片段】\n${c.transcript_snippet}\n`).join('\n')}

請針對每一位應徵者，依下列四個維度個別評分（0-100分），並「必須」寫出具體評分依據（引用他實際回答的內容或行為，不能只給空泛形容詞）：
- professionalism（專業能力）
- communication（溝通表達）
- teamwork（團隊合作／互動表現）
- logic（邏輯思維）

overall_score 為四項的加權平均（專業40%、溝通25%、團隊20%、邏輯15%，四捨五入至整數）。

另外，請為每位應徵者補充「qa」陣列，代表逐題問答評估：
- 每一個 qa item 都要對應一個剛剛問答中的關鍵問題
- question：問題內容
- score：0-10 的整數分數
- feedback：對該題的具體回饋與建議
- 若當題無法明確辨識，至少補上一題最重要問題的評語，不能空白

請「只回傳 JSON」，不要有任何 Markdown 符號，格式如下：
{
  "candidates": [
    {
      "name": "姓名",
      "overall_score": 數字,
      "score_breakdown": {
        "professionalism": { "score": 數字, "reason": "具體依據" },
        "communication": { "score": 數字, "reason": "具體依據" },
        "teamwork": { "score": 數字, "reason": "具體依據" },
        "logic": { "score": 數字, "reason": "具體依據" }
      },
      "highlights": ["亮點1","亮點2"],
      "concerns": ["待改進1"],
      "qa": [{ "question": "問題內容", "score": 7, "feedback": "具體建議" }]
    }
  ],
  "best_communicator": "本場團面中溝通表達最佳的人選姓名與理由",
  "standout_performer": "本場團面中專業表現最突出的人選姓名與理由",
  "hr_recommendation": "整體招募建議"
}

【完整團體面試對話逐字稿（供比對上下文使用）】：
${groupTranscript}
`;

        const reportJson = await callOpenAIForJson(prompt);

        console.log('🔍 [團面報告] 使用資料來源: AI 回傳', JSON.stringify(reportJson, null, 2));

        if (!Array.isArray(reportJson.candidates) || reportJson.candidates.length === 0) {
            const rankingFallback = Array.isArray(reportJson.ranking) ? reportJson.ranking : [];
            if (rankingFallback.length > 0) {
                reportJson.candidates = rankingFallback.map((item, idx) => ({
                    name: item.name || `候選人 ${idx + 1}`,
                    overall_score: Number(item.overall_score) || 0,
                    score_breakdown: {
                        professionalism: { score: 0, reason: '未提供具體評分依據' },
                        communication: { score: 0, reason: '未提供具體評分依據' },
                        teamwork: { score: 0, reason: '未提供具體評分依據' },
                        logic: { score: 0, reason: '未提供具體評分依據' }
                    },
                    highlights: [item.reason || '無亮點描述'],
                    concerns: ['未提供明確疑慮'],
                    qa: [],
                    transcript_snippet: '',
                    emotion: null
                }));
            } else {
                console.warn('⚠️ [團面報告] candidates 陣列為空，回傳的 keys 為:', Object.keys(reportJson));
                return res.status(500).json({
                    success: false,
                    error: 'AI 回傳的資料格式不符（缺少 candidates），請重新整理再試一次。若持續發生請查看後端終端機的 log。'
                });
            }
        }

        reportJson.candidates = (reportJson.candidates || []).map(c => {
            const matched = candidates.find(x => x.name === c.name) || {};
            return {
                ...c,
                qa: Array.isArray(c.qa) ? c.qa : [],
                transcript_snippet: matched.transcript_snippet || '',
                emotion: matched.emotion || null
            };
        });
        reportJson.ranking = [...reportJson.candidates]
            .sort((a, b) => (b.overall_score || 0) - (a.overall_score || 0))
            .map(c => ({ name: c.name, overall_score: c.overall_score, reason: c.highlights?.[0] || '' }));

        res.json({ success: true, report: reportJson, applicant_count: candidateNames.length });

    } catch (err) {
        console.error('生成團面報告失敗:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

function splitTranscriptByCandidate(fullText, candidateNames) {
    const lines = (fullText || '')
        .split(/\n\n|\r\n\r\n/)
        .map(l => l.trim())
        .filter(Boolean);

    const result = {};
    candidateNames.forEach(n => result[n] = []);

    let currentQuestionBlock = [];
    let lastSpeakerType = '';
    let candidatesWhoAnsweredThisQuestion = new Set();

    const buildCandidateKey = (speaker) => {
        const normalized = (speaker || '').replace(/[：:]/g, '').trim();
        const exactMatch = candidateNames.find(name => name && (name === normalized || normalized.includes(name) || name.includes(normalized)));
        if (exactMatch) return exactMatch;
        if (/(應徵者|候選人|applicant|candidate)/i.test(normalized)) return candidateNames[0] || '應徵者';
        return null;
    };

    for (const rawLine of lines) {
        const sepIdx = rawLine.indexOf('：');
        const altSepIdx = rawLine.indexOf(':');
        const splitAt = sepIdx >= 0 ? sepIdx : altSepIdx;
        if (splitAt === -1) continue;

        const speaker = rawLine.substring(0, splitAt).trim();
        const line = rawLine.trim();
        const isInterviewer = /(面試官|HR|主管|interviewer|manager|系統)/i.test(speaker);
        const targetCandidateName = buildCandidateKey(speaker);

        if (isInterviewer) {
            if (lastSpeakerType !== 'interviewer') {
                currentQuestionBlock = [];
                candidatesWhoAnsweredThisQuestion.clear();
            }
            currentQuestionBlock.push(line);
            lastSpeakerType = 'interviewer';
        }
        else if (targetCandidateName) {
            if (!candidatesWhoAnsweredThisQuestion.has(targetCandidateName) && currentQuestionBlock.length > 0) {
                result[targetCandidateName] = result[targetCandidateName] || [];
                result[targetCandidateName].push(...currentQuestionBlock);
                candidatesWhoAnsweredThisQuestion.add(targetCandidateName);
            }
            result[targetCandidateName] = result[targetCandidateName] || [];
            result[targetCandidateName].push(line);
            lastSpeakerType = 'candidate';
        }
        else {
            lastSpeakerType = 'other';
        }
    }

    return result;
}

module.exports = router;