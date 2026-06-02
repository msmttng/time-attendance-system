/**
 * スマート打刻システム - 管理ダッシュボードロジック (従業員個別詳細勤務表・契約設定・承認・CSV対応版)
 */

let currentPassword = '';
let currentUsers = {};
let holidaysData = {};
let monthlyLogs = [];
let monthlyDailyData = [];
let currentSelectedUserId = 'all'; // 'all' または 従業員ID

document.addEventListener('DOMContentLoaded', () => {
    initMonthSelector();
    
    // 祝日データの取得
    fetch('https://holidays-jp.github.io/api/v1/date.json')
        .then(res => res.json())
        .then(data => { holidaysData = data; })
        .catch(err => console.error('祝日データの取得に失敗しました', err));

    // イベントリスナーの登録
    document.getElementById('btn-login').addEventListener('click', attemptLogin);
    document.getElementById('admin-password').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') attemptLogin();
    });

    document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
    document.getElementById('btn-add-user').addEventListener('click', saveUser);
    document.getElementById('month-select').addEventListener('change', (e) => fetchDashboardData(e.target.value));
    
    // 表示対象切り替え
    document.getElementById('user-view-select').addEventListener('change', handleUserViewChange);

    // 打刻履歴用モーダル
    document.getElementById('btn-open-add-log').addEventListener('click', openAddLogModal);
    document.getElementById('btn-save-log-edit').addEventListener('click', saveLogEdit);
    document.getElementById('btn-save-new-log').addEventListener('click', saveNewLog);

    // 個人プロフィール設定用モーダル
    document.getElementById('btn-edit-profile').addEventListener('click', openEditProfileModal);
    document.getElementById('btn-save-profile').addEventListener('click', saveUserProfile);

    // 日別勤務編集用モーダル
    document.getElementById('btn-save-daily').addEventListener('click', saveDailyEdit);

    // 個別勤務表のアクション
    document.getElementById('btn-export-csv').addEventListener('click', exportIndividualCSV);
    document.getElementById('btn-proxy-in').addEventListener('click', () => triggerProxyPunch('出勤'));
    document.getElementById('btn-proxy-out').addEventListener('click', () => triggerProxyPunch('退勤'));
});

function initMonthSelector() {
    const select = document.getElementById('month-select');
    const now = new Date();
    
    for (let i = 0; i < 6; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const value = `${yyyy}-${mm}`;
        const label = `${yyyy}年${d.getMonth() + 1}月`;
        
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
    }
}

async function attemptLogin() {
    const pwdInput = document.getElementById('admin-password').value;
    const errorText = document.getElementById('password-error');
    
    if (!pwdInput) {
        errorText.textContent = 'パスワードを入力してください';
        return;
    }
    
    currentPassword = pwdInput;
    errorText.textContent = '';
    
    const selectedMonth = document.getElementById('month-select').value;
    await fetchDashboardData(selectedMonth);
}

// YYYY-MM形式の月間所定営業時間を計算する
function calculateMonthlyStandardHours(targetMonth) {
    const [yyyy, mm] = targetMonth.split('-');
    const year = parseInt(yyyy, 10);
    const month = parseInt(mm, 10) - 1;
    const lastDay = new Date(year, month + 1, 0).getDate();
    let totalStandardMinutes = 0;

    for (let d = 1; d <= lastDay; d++) {
        const dateObj = new Date(year, month, d);
        const dateStr = `${yyyy}-${mm}-${String(d).padStart(2, '0')}`;
        const dayOfWeek = dateObj.getDay();
        const isHoliday = !!holidaysData[dateStr];
        
        if (!isHoliday) {
            if (dayOfWeek >= 1 && dayOfWeek <= 5) totalStandardMinutes += 585; // 9:15-19:00 (9.75h)
            else if (dayOfWeek === 6) totalStandardMinutes += 255;             // 9:15-13:30 (4.25h)
        }
    }
    
    const h = Math.floor(totalStandardMinutes / 60);
    const m = totalStandardMinutes % 60;
    document.getElementById('standard-hours').textContent = `${h}時間 ${m}分`;
}

async function fetchDashboardData(monthStr) {
    if (!currentPassword) return;

    const overlay = document.getElementById('loading-overlay');
    const pwdOverlay = document.getElementById('password-overlay');
    const adminContent = document.getElementById('admin-content');
    const errorText = document.getElementById('password-error');
    
    if (GAS_WEB_APP_URL.includes('YOUR_SCRIPT_ID_HERE')) {
        errorText.textContent = 'デモモードでは利用できません。GASと連携してください。';
        return;
    }

    overlay.classList.remove('hidden');
    calculateMonthlyStandardHours(monthStr);

    try {
        // 設定、ユーザー、打刻データを並列取得
        const [resSettings, resUsers, resData] = await Promise.all([
            fetch(`${GAS_WEB_APP_URL}?action=get_settings&password=${encodeURIComponent(currentPassword)}`),
            fetch(`${GAS_WEB_APP_URL}?action=get_users`),
            fetch(`${GAS_WEB_APP_URL}?action=get_data&month=${encodeURIComponent(monthStr)}&password=${encodeURIComponent(currentPassword)}`)
        ]);
        
        const dataSettings = await resSettings.json();
        
        if (dataSettings.status !== 'success') {
            pwdOverlay.classList.remove('hidden');
            adminContent.classList.add('hidden');
            errorText.textContent = dataSettings.message || '認証に失敗しました';
            currentPassword = '';
            return;
        }

        const dataUsers = await resUsers.json();
        currentUsers = dataUsers.data || {};

        const dataLogs = await resData.json();

        // 画面の表示切替とデータセット
        pwdOverlay.classList.add('hidden');
        adminContent.classList.remove('hidden');
        
        document.getElementById('setting-password').value = dataSettings.data.password;
        document.getElementById('setting-email').value = dataSettings.data.email;
        
        renderUserTable(currentUsers);
        updateUserViewSelector(currentUsers);
        
        if (dataLogs.status === 'success') {
            // logs と dailyData の格納
            monthlyLogs = dataLogs.data.logs || [];
            monthlyDailyData = dataLogs.data.dailyData || [];
            
            renderLogTable(monthlyLogs);
            renderAggregationDashboard(monthlyLogs, currentUsers);
            
            // 現在の選択に応じて再描画
            refreshCurrentView();
        } else {
            document.getElementById('log-tbody').innerHTML = `<tr><td colspan="4" style="text-align:center; color:red;">${dataLogs.message}</td></tr>`;
            document.getElementById('aggregation-tbody').innerHTML = `<tr><td colspan="5" style="text-align:center; color:red;">${dataLogs.message}</td></tr>`;
        }

    } catch (error) {
        console.error(error);
        if (currentPassword === '') {
            errorText.textContent = `通信エラー: ${error.message}`;
        } else {
            alert(`通信エラー: ${error.message}`);
        }
    } finally {
        overlay.classList.add('hidden');
    }
}

// ドロップダウンリストに従業員一覧を動的追加
function updateUserViewSelector(users) {
    const select = document.getElementById('user-view-select');
    
    // 現在の選択値を退避
    const lastValue = select.value;
    
    // 初期状態にリセット
    select.innerHTML = '<option value="all">📊 ダッシュボード</option>';
    
    for (const [id, user] of Object.entries(users)) {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = `👤 ${user.name}`;
        select.appendChild(option);
    }
    
    // 選択を復元（存在すれば）
    if ([...select.options].some(opt => opt.value === lastValue)) {
        select.value = lastValue;
        currentSelectedUserId = lastValue;
    } else {
        select.value = 'all';
        currentSelectedUserId = 'all';
    }
}

function handleUserViewChange(e) {
    currentSelectedUserId = e.target.value;
    refreshCurrentView();
}

function refreshCurrentView() {
    if (currentSelectedUserId === 'all') {
        document.getElementById('all-view').classList.remove('hidden');
        document.getElementById('individual-view').classList.add('hidden');
        renderAggregationDashboard(monthlyLogs, currentUsers);
    } else {
        document.getElementById('all-view').classList.add('hidden');
        document.getElementById('individual-view').classList.remove('hidden');
        renderIndividualView(currentSelectedUserId);
    }
}

// === 全体集計ダッシュボードの描画 ===
function renderAggregationDashboard(rawData, employeesSettings = {}) {
    const tbody = document.getElementById('aggregation-tbody');
    
    if (!rawData || rawData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center;">この月のデータはありません</td></tr>`;
        document.getElementById('total-hours').textContent = '0時間 0分';
        document.getElementById('total-users').textContent = '0人';
        return;
    }

    const userLogs = {};
    
    rawData.forEach(row => {
        const dateObj = new Date(row.serverTime);
        const userId = row.userId;
        const dayStr = String(dateObj.getDate()).padStart(2, '0');
        const typeText = row.type; 
        
        if (!userLogs[userId]) userLogs[userId] = { name: row.userName, days: {} };
        if (!userLogs[userId].days[dayStr]) userLogs[userId].days[dayStr] = { date: dateObj, in: null, out: null };
        
        const dayLog = userLogs[userId].days[dayStr];
        if (typeText === '出勤' && !dayLog.in) dayLog.in = dateObj;
        else if (typeText === '退勤') dayLog.out = dateObj;
    });

    let html = '';
    let grandTotalMinutes = 0;
    let activeUsersCount = 0;

    for (const userId in userLogs) {
        activeUsersCount++;
        const user = userLogs[userId];
        const breakMinutes = (employeesSettings[userId]) ? employeesSettings[userId].breakMinutes : 0;
        
        let totalNetMinutes = 0, totalGrossMinutes = 0, totalOvertimeMinutes = 0, workDays = 0;
        
        for (const day in user.days) {
            const log = user.days[day];
            if (!log.in || !log.out) continue; 
            
            workDays++;
            const inMins = log.in.getHours() * 60 + log.in.getMinutes();
            const outMins = log.out.getHours() * 60 + log.out.getMinutes();
            const dayOfWeek = log.date.getDay(); 
            
            let grossMins = outMins - inMins;
            if (grossMins < 0) grossMins = 0;
            totalGrossMinutes += grossMins;
            
            let todayBreak = (dayOfWeek === 6) ? 0 : breakMinutes;
            let netMins = grossMins - todayBreak;
            if (netMins < 0) netMins = 0;
            totalNetMinutes += netMins;

            const yyyy = log.date.getFullYear();
            const mm = String(log.date.getMonth() + 1).padStart(2, '0');
            const dd = String(log.date.getDate()).padStart(2, '0');
            const dateStr = `${yyyy}-${mm}-${dd}`;
            
            const isHoliday = !!holidaysData[dateStr] || dayOfWeek === 0;
            let standardStart = 0, standardEnd = 0;

            if (!isHoliday) {
                if (dayOfWeek >= 1 && dayOfWeek <= 5) { standardStart = 9 * 60 + 15; standardEnd = 19 * 60; }
                else if (dayOfWeek === 6) { standardStart = 9 * 60 + 15; standardEnd = 13 * 60 + 30; }
            }

            let dailyOvertime = 0;
            for (let m = inMins; m < outMins; m++) {
                if (isHoliday || m < standardStart || m >= standardEnd) dailyOvertime++;
            }
            totalOvertimeMinutes += dailyOvertime;
        }
        
        grandTotalMinutes += totalNetMinutes;
        const formatTime = (mins) => `${Math.floor(mins / 60)}時間 ${mins % 60}分`;
        
        html += `
            <tr>
                <td><strong>${user.name}</strong><br><span style="font-size: 11px; color: var(--text-secondary);">設定休憩: ${breakMinutes}分</span></td>
                <td>${workDays} 日</td>
                <td>${formatTime(totalGrossMinutes)}</td>
                <td><span style="color:var(--accent-blue);font-weight:bold;">${formatTime(totalNetMinutes)}</span></td>
                <td>${formatTime(totalOvertimeMinutes)}</td>
            </tr>
        `;
    }

    tbody.innerHTML = html;
    document.getElementById('total-hours').textContent = `${Math.floor(grandTotalMinutes / 60)}時間 ${grandTotalMinutes % 60}分`;
    document.getElementById('total-users').textContent = `${activeUsersCount}人`;
}

// === 従業員個別詳細勤務表の描画 ===
function renderIndividualView(userId) {
    const user = currentUsers[userId];
    if (!user) return;

    // 1. 左サイドバープロフィールの描画 (アバター不要対応)
    document.getElementById('profile-name').textContent = user.name;
    document.getElementById('profile-email').textContent = user.email || 'メールアドレス未登録';
    document.getElementById('profile-times').textContent = (user.startTime && user.endTime) ? `${user.startTime} 〜 ${user.endTime}` : '未設定';
    document.getElementById('profile-break').textContent = `${user.breakMinutes || 0}分`;
    document.getElementById('profile-standard').textContent = user.standardHours ? `${user.standardHours}時間` : '未設定';
    const salaryLabel = user.workType === 'パート・アルバイト' ? '時給' : '月給';
    document.getElementById('profile-salary').textContent = user.salary ? `${salaryLabel} ${user.salary.toLocaleString()}円` : '未設定';
    document.getElementById('profile-worktype').textContent = user.workType || '未設定';

    // 2. カレンダー詳細勤務表の動的生成
    const monthSelect = document.getElementById('month-select');
    const monthStr = monthSelect.value; // YYYY-MM
    const [yyyy, mm] = monthStr.split('-');
    const year = parseInt(yyyy, 10);
    const month = parseInt(mm, 10) - 1;
    const lastDay = new Date(year, month + 1, 0).getDate();
    
    // 対象月の全打刻を取得
    const userLogs = monthlyLogs.filter(log => log.userId === userId);
    
    // 日付ごとに整理
    const dailyLogs = {};
    for (let d = 1; d <= lastDay; d++) {
        const dayStr = String(d).padStart(2, '0');
        dailyLogs[dayStr] = { in: null, out: null };
    }
    
    userLogs.forEach(log => {
        const dObj = new Date(log.serverTime);
        const dayStr = String(dObj.getDate()).padStart(2, '0');
        if (dailyLogs[dayStr]) {
            if (log.type === '出勤' && !dailyLogs[dayStr].in) dailyLogs[dayStr].in = dObj;
            else if (log.type === '退勤') dailyLogs[dayStr].out = dObj;
        }
    });

    const tbody = document.getElementById('indiv-calendar-tbody');
    let html = '';
    let totalWorkMinutes = 0;
    let totalOvertimeMinutes = 0;
    let actualWorkDays = 0;
    
    // 個人設定値
    const breakMinutes = user.breakMinutes || 0;
    const defaultStartStr = user.startTime || '09:00';
    const defaultEndStr = user.endTime || '18:00';
    
    const [defStartH, defStartM] = defaultStartStr.split(':').map(Number);
    const [defEndH, defEndM] = defaultEndStr.split(':').map(Number);
    const defStartMins = defStartH * 60 + defStartM;
    const defEndMins = defEndH * 60 + defEndM;

    for (let d = 1; d <= lastDay; d++) {
        const dayStr = String(d).padStart(2, '0');
        const dateObj = new Date(year, month, d);
        const dateKey = `${yyyy}-${mm}-${dayStr}`;
        const dayOfWeek = dateObj.getDay();
        const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];
        const dayLabel = dayLabels[dayOfWeek];
        
        // 土・日・祝日判定
        const isHoliday = !!holidaysData[dateKey];
        const isSunday = dayOfWeek === 0;
        const isSaturday = dayOfWeek === 6;
        
        let rowClass = '';
        let dateColorStyle = '';
        if (isSunday || isHoliday) {
            rowClass = 'style="background: rgba(239, 68, 68, 0.04);"';
            dateColorStyle = 'color: var(--accent-red); font-weight: bold;';
        } else if (isSaturday) {
            rowClass = 'style="background: rgba(59, 130, 246, 0.04);"';
            dateColorStyle = 'color: var(--accent-blue); font-weight: bold;';
        }

        // 打刻データの取得
        const punch = dailyLogs[dayStr];
        const inStr = punch.in ? `${String(punch.in.getHours()).padStart(2,'0')}:${String(punch.in.getMinutes()).padStart(2,'0')}` : '-';
        const outStr = punch.out ? `${String(punch.out.getHours()).padStart(2,'0')}:${String(punch.out.getMinutes()).padStart(2,'0')}` : '-';
        
        // 新設の「日別勤務データ」から有給、承認状態、日報を取得
        const dailyState = monthlyDailyData.find(item => item.date === dateKey && item.userId === userId) || {};
        
        // 有給等の「区分」判定
        let typeVal = dailyState.type || '';
        if (!typeVal && punch.in && punch.out) {
            typeVal = '出勤';
        }
        
        // 労働時間の計算
        let grossMins = 0;
        let netMins = 0;
        let overtimeMins = 0;
        
        if (punch.in && punch.out) {
            actualWorkDays++;
            const inMins = punch.in.getHours() * 60 + punch.in.getMinutes();
            const outMins = punch.out.getHours() * 60 + punch.out.getMinutes();
            grossMins = outMins - inMins;
            if (grossMins < 0) grossMins = 0;
            
            // 土曜日は休憩なし、平日は設定休憩時間を適用
            const todayBreak = (dayOfWeek === 6) ? 0 : breakMinutes;
            netMins = grossMins - todayBreak;
            if (netMins < 0) netMins = 0;
            
            totalWorkMinutes += netMins;
            
            // 時間外(残業)計算: 契約退勤時刻より後の時間、または休日労働
            let dailyStandardStart = defStartMins;
            let dailyStandardEnd = defEndMins;
            if (isSunday || isHoliday) {
                // 休日はすべて時間外
                overtimeMins = netMins;
            } else {
                for (let m = inMins; m < outMins; m++) {
                    if (m < dailyStandardStart || m >= dailyStandardEnd) overtimeMins++;
                }
            }
            totalOvertimeMinutes += overtimeMins;
        }

        const formatMinutes = (mins) => {
            if (mins === 0) return '-';
            return `${Math.floor(mins / 60)}時間${mins % 60}分`;
        };

        // 承認ステータス表示の組み立て
        let approvalHtml = '';
        if (dailyState.status === '承認済み') {
            approvalHtml = '<span style="color: var(--success-color); font-weight: bold;">✅ 承認済み</span>';
        } else if (dailyState.status === '差戻し') {
            approvalHtml = '<span style="color: var(--accent-red); font-weight: bold;">❌ 差戻し中</span>';
        } else {
            // 未承認時はボタン表示
            approvalHtml = `
                <div style="display: flex; gap: 5px; justify-content: center;">
                    <button class="btn-small btn-success" onclick="updateDailyStatus('${dateKey}', '${userId}', '承認済み')" style="padding: 4px 8px; font-size: 11px;">承認する</button>
                    <button class="btn-small btn-danger" onclick="updateDailyStatus('${dateKey}', '${userId}', '差戻し')" style="padding: 4px 8px; font-size: 11px;">差戻し</button>
                </div>
            `;
        }

        const shortDateStr = `${parseInt(mm, 10)}/${dayStr}(${dayLabel})`;

        html += `
            <tr ${rowClass}>
                <td><button class="btn-small btn-primary" onclick="openEditDailyModal('${dateKey}', '${userId}', '${typeVal}', '${dailyState.status || ''}', '${dailyState.report || ''}', '${inStr !== '-' ? inStr : ''}', '${outStr !== '-' ? outStr : ''}')">編集</button></td>
                <td><span style="font-weight: 500;">${typeVal || '-'}</span></td>
                <td><span style="${dateColorStyle}">${shortDateStr}</span></td>
                <td>${inStr}</td>
                <td>${user.endTime || '19:00'}</td>
                <td>${outStr}</td>
                <td>${punch.in && punch.out ? ((dayOfWeek === 6) ? 0 : breakMinutes) + '分' : '-'}</td>
                <td><strong>${formatMinutes(netMins)}</strong></td>
                <td style="color: var(--accent-red);">${formatMinutes(overtimeMins)}</td>
                <td style="text-align: center;">${approvalHtml}</td>
                <td style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${dailyState.report || ''}">${dailyState.report || '-'}</td>
            </tr>
        `;
    }

    tbody.innerHTML = html;

    // 3. 右カラム月次詳細サマリーカードの描画
    document.getElementById('indiv-month').textContent = `${yyyy}年${mm}月`;
    document.getElementById('indiv-standard-hours').textContent = user.standardHours ? `${user.standardHours}時間` : '未設定';
    
    const formatTimeSummary = (totalMins) => {
        const h = Math.floor(totalMins / 60);
        const m = totalMins % 60;
        return `${h}時間${m}分`;
    };
    
    document.getElementById('indiv-total-hours').textContent = formatTimeSummary(totalWorkMinutes);
    document.getElementById('indiv-overtime-hours').textContent = formatTimeSummary(totalOvertimeMinutes);
    document.getElementById('indiv-work-days').textContent = `${actualWorkDays}日`;
    
    // 概算給与計算（固定給 or 時給計算）
    let earnedSalary = 0;
    if (user.workType === 'パート・アルバイト') {
        // パートは時給計算: 時給 × 実働時間
        const actualHours = totalWorkMinutes / 60;
        earnedSalary = Math.round((user.salary || 0) * actualHours);
    } else {
        // 常勤は固定給そのまま
        earnedSalary = user.salary || 0;
    }
    document.getElementById('indiv-earned-salary').textContent = `${earnedSalary.toLocaleString()}円`;
}

// === 個人設定条件の編集モーダル制御 ===
function openEditProfileModal() {
    const userId = currentSelectedUserId;
    const user = currentUsers[userId];
    if (!user) return;

    document.getElementById('edit-profile-email').value = user.email || '';
    document.getElementById('edit-profile-worktype').value = user.workType || '勤務タイプ①';
    document.getElementById('edit-profile-start').value = user.startTime || '13:00';
    document.getElementById('edit-profile-end').value = user.endTime || '19:00';
    document.getElementById('edit-profile-standard').value = user.standardHours || 120;
    document.getElementById('edit-profile-salary').value = user.salary || 200000;
    document.getElementById('edit-profile-break').value = user.breakMinutes || 120;

    document.getElementById('edit-profile-modal').classList.remove('hidden');
}

async function saveUserProfile() {
    const userId = currentSelectedUserId;
    const user = currentUsers[userId];
    if (!user) return;

    const email = document.getElementById('edit-profile-email').value.trim();
    const worktype = document.getElementById('edit-profile-worktype').value.trim();
    const start = document.getElementById('edit-profile-start').value.trim();
    const end = document.getElementById('edit-profile-end').value.trim();
    const standard = parseInt(document.getElementById('edit-profile-standard').value, 10) || 0;
    const salary = parseInt(document.getElementById('edit-profile-salary').value, 10) || 0;
    const breakMins = parseInt(document.getElementById('edit-profile-break').value, 10) || 0;

    const payload = {
        action: 'save_user',
        adminPassword: currentPassword,
        user: {
            id: userId,
            name: user.name,
            breakMinutes: breakMins,
            email: email,
            startTime: start,
            endTime: end,
            standardHours: standard,
            salary: salary,
            workType: worktype,
            avatarUrl: '' // アバター不要のため空文字で統一
        }
    };

    const overlay = document.getElementById('loading-overlay');
    overlay.classList.remove('hidden');
    
    try {
        const response = await fetch(GAS_WEB_APP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (result.status === 'success') {
            alert('個人勤務設定を更新しました。');
            document.getElementById('edit-profile-modal').classList.add('hidden');
            // リロード
            await fetchDashboardData(document.getElementById('month-select').value);
        } else {
            alert('エラー: ' + result.message);
        }
    } catch (err) {
        alert('通信エラー: ' + err.message);
    } finally {
        overlay.classList.add('hidden');
    }
}

// === 日別勤務ステータスの変更・編集モーダル制御 ===
async function updateDailyStatus(date, userId, status) {
    const payload = {
        action: 'update_daily_status',
        adminPassword: currentPassword,
        date: date,
        userId: userId,
        status: status
    };

    const overlay = document.getElementById('loading-overlay');
    overlay.classList.remove('hidden');

    try {
        const response = await fetch(GAS_WEB_APP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (result.status === 'success') {
            // 再読み込みして最新データを反映
            await fetchDashboardData(document.getElementById('month-select').value);
        } else {
            alert('エラー: ' + result.message);
        }
    } catch (err) {
        alert('通信エラー: ' + err.message);
    } finally {
        overlay.classList.add('hidden');
    }
}

function openEditDailyModal(date, userId, type, status, report, inTime, outTime) {
    document.getElementById('edit-daily-date').value = date;
    document.getElementById('edit-daily-date-label').value = date;
    document.getElementById('edit-daily-type').value = type;
    document.getElementById('edit-daily-status').value = status;
    document.getElementById('edit-daily-report').value = report || '';
    document.getElementById('edit-daily-in').value = inTime || '';
    document.getElementById('edit-daily-out').value = outTime || '';

    document.getElementById('edit-daily-modal').classList.remove('hidden');
}

async function saveDailyEdit() {
    const date = document.getElementById('edit-daily-date').value;
    const userId = currentSelectedUserId;
    const type = document.getElementById('edit-daily-type').value;
    const status = document.getElementById('edit-daily-status').value;
    const report = document.getElementById('edit-daily-report').value.trim();

    const inTime = document.getElementById('edit-daily-in').value;
    const outTime = document.getElementById('edit-daily-out').value;

    const payload = {
        action: 'update_daily_status',
        adminPassword: currentPassword,
        date: date,
        userId: userId,
        type: type,
        status: status,
        report: report,
        inTime: inTime,
        outTime: outTime,
        userName: currentUsers[userId] ? currentUsers[userId].name : ''
    };

    const overlay = document.getElementById('loading-overlay');
    overlay.classList.remove('hidden');

    try {
        const response = await fetch(GAS_WEB_APP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (result.status === 'success') {
            alert('日別データを更新しました。');
            document.getElementById('edit-daily-modal').classList.add('hidden');
            await fetchDashboardData(document.getElementById('month-select').value);
        } else {
            alert('エラー: ' + result.message);
        }
    } catch (err) {
        alert('通信エラー: ' + err.message);
    } finally {
        overlay.classList.add('hidden');
    }
}

// === 管理者の代理打刻機能 ===
async function triggerProxyPunch(punchType) {
    const userId = currentSelectedUserId;
    const user = currentUsers[userId];
    if (!user) return;

    if (!confirm(`${user.name} さんの代わりに本日（現在時刻）の「${punchType}」を記録しますか？`)) return;

    const payload = {
        action: 'add_log',
        adminPassword: currentPassword,
        userId: userId,
        userName: user.name,
        type: punchType,
        serverTime: new Date().toISOString(),
        clientTime: '管理者代理打刻'
    };

    const overlay = document.getElementById('loading-overlay');
    overlay.classList.remove('hidden');

    try {
        const response = await fetch(GAS_WEB_APP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (result.status === 'success') {
            alert(`${punchType}を代理記録しました。`);
            await fetchDashboardData(document.getElementById('month-select').value);
        } else {
            alert('エラー: ' + result.message);
        }
    } catch (err) {
        alert('通信エラー: ' + err.message);
    } finally {
        overlay.classList.add('hidden');
    }
}

// === CSVエクスポート機能 (BOM付UTF-8によるExcel文字化け防止) ===
function exportIndividualCSV() {
    const userId = currentSelectedUserId;
    const user = currentUsers[userId];
    if (!user) return;

    const monthStr = document.getElementById('month-select').value;
    const filename = `timecard_${user.name}_${monthStr}.csv`;
    
    // CSVヘッダーの組み立て
    let csvRows = [];
    csvRows.push(`"スマート出退勤管理システム - 月間詳細勤務表"`);
    csvRows.push(`"従業員名","${user.name}","対象月","${monthStr}"`);
    csvRows.push(`"契約時間","${user.startTime || '13:00'}〜${user.endTime || '19:00'}","設定休憩","${user.breakMinutes || 0}分"`);
    csvRows.push(`"基本給与","${user.salary || 0}円","所定時間","${user.standardHours || 0}時間"`);
    csvRows.push(''); // 空行
    
    csvRows.push(`"区分","日付","開始時刻","退勤時刻","休憩時間","実労働時間","時間外労働","承認ステータス","業務日報メモ"`);

    const tableRows = document.querySelectorAll('#indiv-calendar-tbody tr');
    tableRows.forEach(row => {
        const cols = row.querySelectorAll('td');
        if (cols.length >= 11) {
            const type = cols[1].textContent.trim();
            const date = cols[2].textContent.trim();
            const start = cols[3].textContent.trim();
            const end = cols[5].textContent.trim();
            const rest = cols[6].textContent.trim();
            const net = cols[7].textContent.trim();
            const over = cols[8].textContent.trim();
            const status = cols[9].textContent.trim();
            const report = cols[10].textContent.trim();
            
            csvRows.push(`"${type}","${date}","${start}","${end}","${rest}","${net}","${over}","${status}","${report}"`);
        }
    });

    const csvContent = csvRows.join('\r\n');
    
    // BOM付きUTF-8
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8;' });
    
    if (window.navigator.msSaveOrOpenBlob) {
        window.navigator.msSaveBlob(blob, filename);
    } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
}

// === 打刻履歴の管理描画 ===
function renderLogTable(logs) {
    const tbody = document.getElementById('log-tbody');
    let html = '';
    
    // コピーしてソート（新しい順）
    const sortedLogs = [...logs].sort((a, b) => new Date(b.serverTime) - new Date(a.serverTime));

    for (const log of sortedLogs) {
        const d = new Date(log.serverTime);
        const dateStr = `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        const isoLocal = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        
        html += `
            <tr>
                <td>${dateStr}</td>
                <td>${log.userName}</td>
                <td><span style="display:inline-block; padding:3px 8px; border-radius:4px; font-size:12px; font-weight:bold; ${log.type === '出勤' ? 'background:#dbeafe; color:#1e40af;' : 'background:#fee2e2; color:#b91c1c;'}">${log.type}</span></td>
                <td>
                    <button class="btn-small btn-primary" onclick="openEditLogModal(${log.rowNumber}, '${isoLocal}', '${log.type}')" style="margin-right: 5px;">編集</button>
                    <button class="btn-small btn-danger" onclick="deleteLog(${log.rowNumber})">削除</button>
                </td>
            </tr>
        `;
    }
    
    if (html === '') {
        html = `<tr><td colspan="4" style="text-align:center;">この月の打刻データはありません</td></tr>`;
    }
    
    tbody.innerHTML = html;
}

function openEditLogModal(rowNumber, isoLocalTime, type) {
    document.getElementById('edit-log-row').value = rowNumber;
    document.getElementById('edit-log-time').value = isoLocalTime;
    document.getElementById('edit-log-type').value = (type === '出勤' || type === '退勤') ? type : '出勤';
    document.getElementById('edit-log-modal').classList.remove('hidden');
}

async function saveLogEdit() {
    const row = document.getElementById('edit-log-row').value;
    const timeVal = document.getElementById('edit-log-time').value;
    const typeVal = document.getElementById('edit-log-type').value;

    if (!timeVal) { alert('日時を入力してください'); return; }

    const payload = {
        action: 'update_log', adminPassword: currentPassword, rowNumber: parseInt(row, 10),
        newServerTime: new Date(timeVal).toISOString(), newType: typeVal
    };

    await sendPostRequest(payload, '打刻データを修正しました。');
    document.getElementById('edit-log-modal').classList.add('hidden');
    fetchDashboardData(document.getElementById('month-select').value);
}

function openAddLogModal() {
    const userSelect = document.getElementById('add-log-user');
    let opts = '<option value="" disabled selected>選択してください</option>';
    for (const [id, user] of Object.entries(currentUsers)) {
        opts += `<option value="${id}">${user.name}</option>`;
    }
    userSelect.innerHTML = opts;
    
    const d = new Date();
    const isoLocal = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    document.getElementById('add-log-time').value = isoLocal;
    document.getElementById('add-log-modal').classList.remove('hidden');
}

async function saveNewLog() {
    const userId = document.getElementById('add-log-user').value;
    const timeVal = document.getElementById('add-log-time').value;
    const typeVal = document.getElementById('add-log-type').value;

    if (!userId || !timeVal) { alert('すべての項目を入力してください'); return; }

    const payload = {
        action: 'add_log', adminPassword: currentPassword, userId: userId,
        userName: currentUsers[userId].name, type: typeVal,
        serverTime: new Date(timeVal).toISOString(), clientTime: '手動追加'
    };

    await sendPostRequest(payload, '打刻データを手動追加しました。');
    document.getElementById('add-log-modal').classList.add('hidden');
    fetchDashboardData(document.getElementById('month-select').value);
}

async function deleteLog(rowNumber) {
    if (!confirm(`この打刻データを削除してもよろしいですか？\n※元に戻せません`)) return;
    const payload = { action: 'delete_log', adminPassword: currentPassword, rowNumber: rowNumber };
    await sendPostRequest(payload, '打刻データを削除しました。');
    fetchDashboardData(document.getElementById('month-select').value);
}

// === 従業員・システム設定の管理描画 ===
function renderUserTable(usersData) {
    const tbody = document.getElementById('user-tbody');
    let html = '';
    for (const [id, user] of Object.entries(usersData)) {
        html += `
            <tr>
                <td>${id}</td><td>${user.name}</td><td>${user.breakMinutes} 分</td>
                <td>
                    <button class="btn-small btn-danger" onclick="deleteUser('${id}')">削除</button>
                    <button class="btn-small btn-primary" onclick="editUser('${id}', '${user.name}', '${user.breakMinutes || 0}')" style="margin-left: 5px;">編集</button>
                </td>
            </tr>
        `;
    }
    tbody.innerHTML = html === '' ? `<tr><td colspan="4" style="text-align:center;">従業員がいません</td></tr>` : html;
}

function editUser(id, name, breakMins) {
    document.getElementById('new-user-id').value = id;
    document.getElementById('new-user-name').value = name;
    document.getElementById('new-user-break').value = breakMins;
    
    // UX改善: ボタンの見た目を変え、上部へスクロールする
    const btn = document.getElementById('btn-add-user');
    btn.innerHTML = `✅ ${name} さんの情報を更新`;
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-success');
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function saveSettings() {
    const pwd = document.getElementById('setting-password').value;
    const email = document.getElementById('setting-email').value;
    if (!pwd) { alert('パスワードは必須です'); return; }
    const payload = { action: 'save_settings', adminPassword: currentPassword, settings: { password: pwd, email: email } };
    await sendPostRequest(payload, '設定を保存しました。');
    currentPassword = pwd;
}

async function saveUser() {
    const id = document.getElementById('new-user-id').value.trim();
    const name = document.getElementById('new-user-name').value.trim();
    const breakMins = document.getElementById('new-user-break').value;
    if (!id || !name || breakMins === '') { alert('すべての項目を入力してください'); return; }
    const payload = { action: 'save_user', adminPassword: currentPassword, user: { id: id, name: name, breakMinutes: parseInt(breakMins, 10) } };
    
    // UX改善: ボタンを元に戻す
    const btn = document.getElementById('btn-add-user');
    btn.innerHTML = '追加 / 更新';
    btn.classList.remove('btn-success');
    btn.classList.add('btn-primary');
    
    await sendPostRequest(payload, '従業員情報を保存しました。');
    
    document.getElementById('new-user-id').value = '';
    document.getElementById('new-user-name').value = '';
    document.getElementById('new-user-break').value = '';
    
    fetchDashboardData(document.getElementById('month-select').value);
}

async function deleteUser(id) {
    if (!confirm(`ユーザーID: ${id} を削除しますか？`)) return;
    const payload = { action: 'delete_user', adminPassword: currentPassword, userId: id };
    
    // ローカル上でも即座に消すことでUXを向上させる
    if (currentUsers[id]) {
        delete currentUsers[id];
        renderUserTable(currentUsers);
        updateUserViewSelector(currentUsers);
    }
    
    await sendPostRequest(payload, '従業員を削除しました。');
    
    fetchDashboardData(document.getElementById('month-select').value);
}

// === 汎用POST ===
async function sendPostRequest(payload, successMsg) {
    const overlay = document.getElementById('loading-overlay');
    overlay.classList.remove('hidden');
    try {
        const response = await fetch(GAS_WEB_APP_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
        const result = await response.json();
        if (result.status === 'success') alert(successMsg);
        else alert('エラー: ' + result.message);
    } catch (error) {
        alert('通信エラー: ' + error.message);
    } finally {
        overlay.classList.add('hidden');
    }
}

// === 勤務表（Excel）フォーマット出力機能 ===
async function exportToFormattedExcel() {
    const userId = currentSelectedUserId;
    const user = currentUsers[userId];
    if (!user) return;

    if (typeof ExcelJS === 'undefined') {
        alert('Excel出力ライブラリが読み込まれていません。ページを再読み込みしてください。');
        return;
    }

    const monthStr = document.getElementById('month-select').value;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('勤務表');

    // 列幅の設定
    worksheet.columns = [
        { width: 14 }, // A: 日付
        { width: 12 }, // B: 開始時刻
        { width: 12 }, // C: 所定時刻
        { width: 12 }, // D: 終了時刻
        { width: 12 }, // E: 休憩時間
        { width: 10 }, // F: 勤務
        { width: 30 }, // G: 作業内容
        { width: 12 }, // H: 実働
        { width: 12 }, // I: 時間外
        { width: 25 }  // J: 特記事項
    ];

    // フォント設定
    worksheet.eachRow((row) => {
        row.font = { name: 'Meiryo UI', size: 11 };
    });

    // タイトル
    worksheet.mergeCells('D3:G4');
    const titleCell = worksheet.getCell('D3');
    titleCell.value = '勤 務 表';
    titleCell.font = { name: 'Meiryo UI', size: 20, bold: true, underline: true };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };

    // ハンコ枠
    worksheet.mergeCells('I3:I4');
    const stamp1 = worksheet.getCell('I3');
    stamp1.value = '作業者印';
    stamp1.alignment = { vertical: 'top', horizontal: 'center' };
    stamp1.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };

    worksheet.mergeCells('J3:J4');
    const stamp2 = worksheet.getCell('J3');
    stamp2.value = '責任者印';
    stamp2.alignment = { vertical: 'top', horizontal: 'center' };
    stamp2.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };

    // 対象月
    worksheet.getCell('A8').value = monthStr.replace('-', '/');
    worksheet.getCell('A8').font = { color: { argb: 'FFFF0000' } }; // 赤文字

    // サマリーヘッダー (緑背景)
    const summaryHeaderBg = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B050' } }; 
    worksheet.mergeCells('A9:B9');
    worksheet.getCell('A9').value = '会社名';
    worksheet.mergeCells('C9:D9');
    worksheet.getCell('C9').value = '名前';
    worksheet.getCell('E9').value = '標準開始時間';
    worksheet.getCell('F9').value = '標準終了時間';
    worksheet.getCell('G9').value = '所定時間';
    worksheet.getCell('H9').value = '稼働日数';
    worksheet.mergeCells('I9:J9');
    worksheet.getCell('I9').value = '時間外';

    ['A9','C9','E9','F9','G9','H9','I9'].forEach(cell => {
        const c = worksheet.getCell(cell);
        c.fill = summaryHeaderBg;
        c.alignment = { vertical: 'middle', horizontal: 'center' };
        c.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
    });

    // サマリー値
    worksheet.mergeCells('A10:B10');
    worksheet.getCell('A10').value = ''; // 会社名
    worksheet.mergeCells('C10:D10');
    worksheet.getCell('C10').value = user.name;
    worksheet.getCell('E10').value = user.startTime || '13:00';
    worksheet.getCell('F10').value = user.endTime || '19:00';
    worksheet.getCell('G10').value = user.standardHours || '120';
    
    worksheet.getCell('H10').value = document.getElementById('indiv-work-days').textContent.replace('日', '');
    worksheet.mergeCells('I10:J10');
    worksheet.getCell('I10').value = document.getElementById('indiv-overtime').textContent;

    ['A10','C10','E10','F10','G10','H10','I10'].forEach(cell => {
        const c = worksheet.getCell(cell);
        c.alignment = { vertical: 'middle', horizontal: 'center' };
        c.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
    });

    // 明細ヘッダー (緑背景)
    const headers = ['日付', '開始時刻', '所定時刻', '終了時刻', '休憩時間', '勤務', '作業内容', '実働', '時間外', '特記事項'];
    const row12 = worksheet.getRow(12);
    headers.forEach((h, i) => {
        const cell = row12.getCell(i + 1);
        cell.value = h;
        cell.fill = summaryHeaderBg;
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
    });

    // 実働・時間外のフォーマット変換関数 ("6時間13分" => "06:13")
    const formatHm = (str) => {
        if (!str || str === '-') return '';
        const match = str.match(/(\d+)時間\s*(\d+)分/);
        if (match) return `${String(match[1]).padStart(2,'0')}:${String(match[2]).padStart(2,'0')}`;
        return str;
    };

    // 明細データ
    const tableRows = document.querySelectorAll('#indiv-calendar-tbody tr');
    let startRow = 13;
    tableRows.forEach((row) => {
        const cols = row.querySelectorAll('td');
        if (cols.length >= 11) {
            const type = cols[1].textContent.trim();
            const dateStr = cols[2].textContent.trim();
            const start = cols[3].textContent.trim();
            const standardEnd = cols[4].textContent.trim();
            const end = cols[5].textContent.trim();
            const rest = cols[6].textContent.trim().replace('分','');
            const net = cols[7].textContent.trim();
            const over = cols[8].textContent.trim();
            const report = cols[10].textContent.trim();

            const dataRow = worksheet.getRow(startRow);
            
            // Excel上でシリアル値にならないようにするため文字列として入力
            dataRow.getCell(1).value = dateStr; 
            dataRow.getCell(2).value = start !== '-' ? start : '';
            dataRow.getCell(3).value = standardEnd !== '-' ? standardEnd : '';
            dataRow.getCell(4).value = end !== '-' ? end : '';
            
            let restFmt = '';
            if (rest && rest !== '-') {
                let restMins = parseInt(rest, 10);
                if (!isNaN(restMins)) {
                    let h = Math.floor(restMins / 60);
                    let m = restMins % 60;
                    restFmt = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
                } else {
                    restFmt = rest;
                }
            }
            dataRow.getCell(5).value = restFmt;
            
            dataRow.getCell(6).value = type !== '-' ? type : '';
            dataRow.getCell(7).value = report !== '-' ? report : '';
            dataRow.getCell(8).value = formatHm(net);
            dataRow.getCell(9).value = formatHm(over);
            dataRow.getCell(10).value = '';

            for (let i = 1; i <= 10; i++) {
                dataRow.getCell(i).border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
                dataRow.getCell(i).alignment = { vertical: 'middle', horizontal: (i>=2 && i<=5) || i>=8 ? 'center' : 'left' };
            }
            startRow++;
        }
    });

    // 余白（空行）を10行ほど追加
    for (let i = 0; i < 10; i++) {
        const dataRow = worksheet.getRow(startRow);
        for (let j = 1; j <= 10; j++) {
            dataRow.getCell(j).border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
        }
        startRow++;
    }

    // 合計欄
    worksheet.mergeCells(`A${startRow}:I${startRow}`);
    const totalLabel = worksheet.getCell(`A${startRow}`);
    totalLabel.value = '合計';
    totalLabel.alignment = { horizontal: 'right', vertical: 'middle' };
    
    const indivTotal = document.getElementById('indiv-total-hours').textContent;
    worksheet.getCell(`J${startRow}`).value = formatHm(indivTotal);
    worksheet.getCell(`J${startRow}`).alignment = { horizontal: 'center' };

    for (let j = 1; j <= 10; j++) {
        worksheet.getRow(startRow).getCell(j).border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
    }

    // 備考欄
    startRow++;
    worksheet.mergeCells(`A${startRow}:B${startRow+3}`);
    worksheet.getCell(`A${startRow}`).value = '備考';
    worksheet.getCell(`A${startRow}`).alignment = { vertical: 'middle', horizontal: 'center' };
    
    worksheet.mergeCells(`C${startRow}:J${startRow+3}`);
    worksheet.getCell(`C${startRow}`).value = '※残業時間は所定時刻を終わりの時間として計算しています。';
    worksheet.getCell(`C${startRow}`).alignment = { vertical: 'top', horizontal: 'left', wrapText: true };

    for (let j = 1; j <= 10; j++) {
        // 簡易的に全セルにBorderを設定
        worksheet.getRow(startRow).getCell(j).border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
        worksheet.getRow(startRow+1).getCell(j).border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
        worksheet.getRow(startRow+2).getCell(j).border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
        worksheet.getRow(startRow+3).getCell(j).border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
    }

    // Generate Excel File
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `勤務表_${user.name}_${monthStr}.xlsx`);
}
