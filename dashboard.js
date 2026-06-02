/**
 * スマート打刻システム - ダッシュボードロジック (祝日判定・自動休憩控除対応)
 */

let currentPassword = '';
let holidaysData = {};

document.addEventListener('DOMContentLoaded', () => {
    initMonthSelector();
    
    // 祝日データの取得
    fetch('https://holidays-jp.github.io/api/v1/date.json')
        .then(res => res.json())
        .then(data => { holidaysData = data; })
        .catch(err => console.error('祝日データの取得に失敗しました', err));

    document.getElementById('btn-login').addEventListener('click', attemptLogin);
    
    document.getElementById('dashboard-password').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') attemptLogin();
    });

    document.getElementById('month-select').addEventListener('change', fetchDashboardData);
});

async function attemptLogin() {
    const pwdInput = document.getElementById('dashboard-password').value;
    const errorText = document.getElementById('password-error');
    
    if (!pwdInput) {
        errorText.textContent = 'パスワードを入力してください';
        return;
    }
    
    currentPassword = pwdInput;
    errorText.textContent = '';
    
    await fetchDashboardData();
}

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

// YYYY-MM形式の月間所定営業時間を計算する
function calculateMonthlyStandardHours(targetMonth) {
    const [yyyy, mm] = targetMonth.split('-');
    const year = parseInt(yyyy, 10);
    const month = parseInt(mm, 10) - 1;
    
    // 月末日を取得
    const lastDay = new Date(year, month + 1, 0).getDate();
    
    let totalStandardMinutes = 0;

    for (let d = 1; d <= lastDay; d++) {
        const dateObj = new Date(year, month, d);
        const dateStr = `${yyyy}-${mm}-${String(d).padStart(2, '0')}`;
        const dayOfWeek = dateObj.getDay();
        
        // 祝日判定
        const isHoliday = !!holidaysData[dateStr];
        
        if (!isHoliday) {
            if (dayOfWeek >= 1 && dayOfWeek <= 5) {
                // 平日: 9:15-19:00 (585分)
                totalStandardMinutes += 585;
            } else if (dayOfWeek === 6) {
                // 土曜: 9:15-13:30 (255分)
                totalStandardMinutes += 255;
            }
        }
    }
    
    const h = Math.floor(totalStandardMinutes / 60);
    const m = totalStandardMinutes % 60;
    document.getElementById('standard-hours').textContent = `${h}時間 ${m}分`;
}

async function fetchDashboardData() {
    if (!currentPassword) return;

    const overlay = document.getElementById('loading-overlay');
    const targetMonth = document.getElementById('month-select').value;
    const pwdOverlay = document.getElementById('password-overlay');
    const errorText = document.getElementById('password-error');
    
    document.getElementById('dashboard-subtitle').textContent = `${targetMonth.replace('-', '年')}月度 労働時間サマリー`;
    
    // 所定営業時間の計算
    calculateMonthlyStandardHours(targetMonth);
    
    if (GAS_WEB_APP_URL.includes('YOUR_SCRIPT_ID_HERE')) {
        if (currentPassword === 'admin') {
            pwdOverlay.classList.add('hidden');
            showDemoData();
        } else {
            errorText.textContent = 'パスワードが間違っています。(デモ版は admin です)';
        }
        return;
    }

    overlay.classList.remove('hidden');

    try {
        // 同時に設定（ユーザーリスト）も取得する
        const [resData, resUsers] = await Promise.all([
            fetch(`${GAS_WEB_APP_URL}?action=get_data&month=${targetMonth}&password=${encodeURIComponent(currentPassword)}`),
            fetch(`${GAS_WEB_APP_URL}?action=get_users`)
        ]);
        
        const result = await resData.json();
        const usersResult = await resUsers.json();
        const employeesSettings = (usersResult.status === 'success') ? usersResult.data : {};
        
        if (result.status === 'success') {
            pwdOverlay.classList.add('hidden');
            renderTable(result.data, employeesSettings);
        } else {
            pwdOverlay.classList.remove('hidden');
            errorText.textContent = result.message || 'データ取得に失敗しました';
            currentPassword = '';
        }
    } catch (error) {
        console.error(error);
        pwdOverlay.classList.remove('hidden');
        errorText.textContent = `通信エラー: ${error.message}`;
    } finally {
        overlay.classList.add('hidden');
    }
}

function renderTable(rawData, employeesSettings = {}) {
    const tbody = document.getElementById('aggregation-tbody');
    
    if (!rawData || rawData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center;">データがありません</td></tr>`;
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
        
        if (!userLogs[userId]) {
            userLogs[userId] = { name: row.userName, days: {} };
        }
        if (!userLogs[userId].days[dayStr]) {
            userLogs[userId].days[dayStr] = { date: dateObj, in: null, out: null };
        }
        
        const dayLog = userLogs[userId].days[dayStr];
        
        if (typeText === '出勤' && !dayLog.in) {
            dayLog.in = dateObj;
        } else if (typeText === '退勤') {
            dayLog.out = dateObj;
        }
    });

    let html = '';
    let grandTotalMinutes = 0;
    let activeUsersCount = 0;

    for (const userId in userLogs) {
        activeUsersCount++;
        const user = userLogs[userId];
        
        // employeesSettings からユーザーごとの休憩設定を取得（未定義なら0分）
        const breakMinutes = (employeesSettings[userId]) ? employeesSettings[userId].breakMinutes : 0;
        
        let totalNetMinutes = 0;
        let totalOvertimeMinutes = 0;
        let workDays = 0;
        
        for (const day in user.days) {
            const log = user.days[day];
            if (!log.in || !log.out) continue; 
            
            workDays++;
            
            const inMins = log.in.getHours() * 60 + log.in.getMinutes();
            const outMins = log.out.getHours() * 60 + log.out.getMinutes();
            const dayOfWeek = log.date.getDay(); 
            
            let grossMins = outMins - inMins;
            if (grossMins < 0) grossMins = 0; // 日またぎ等異常値対策
            
            // 実働時間 ＝ 総滞在時間 － 休憩設定時間（土曜は休憩なし）
            let todayBreak = (dayOfWeek === 6) ? 0 : breakMinutes;
            let netMins = grossMins - todayBreak;
            if (netMins < 0) netMins = 0;
            totalNetMinutes += netMins;

            // 残業時間の計算（所定営業時間外の打刻分）
            const yyyy = log.date.getFullYear();
            const mm = String(log.date.getMonth() + 1).padStart(2, '0');
            const dd = String(log.date.getDate()).padStart(2, '0');
            const dateStr = `${yyyy}-${mm}-${dd}`;
            
            const isHoliday = !!holidaysData[dateStr] || dayOfWeek === 0; // 祝日または日曜
            
            let standardStart = 0;
            let standardEnd = 0;

            if (!isHoliday) {
                if (dayOfWeek >= 1 && dayOfWeek <= 5) {
                    standardStart = 9 * 60 + 15; // 9:15
                    standardEnd = 19 * 60;       // 19:00
                } else if (dayOfWeek === 6) {
                    standardStart = 9 * 60 + 15; // 9:15
                    standardEnd = 13 * 60 + 30;  // 13:30
                }
            }

            let dailyOvertime = 0;
            for (let m = inMins; m < outMins; m++) {
                if (isHoliday || m < standardStart || m >= standardEnd) {
                    dailyOvertime++;
                }
            }
            totalOvertimeMinutes += dailyOvertime;
        }
        
        grandTotalMinutes += totalNetMinutes;
        
        const formatTime = (mins) => `${Math.floor(mins / 60)}時間 ${mins % 60}分`;
        
        html += `
            <tr>
                <td><strong>${user.name}</strong><br><span style="font-size: 11px; color: var(--text-secondary);">設定休憩: ${breakMinutes}分</span></td>
                <td>${workDays} 日</td>
                <td><span style="color:var(--accent-blue);font-weight:bold;">${formatTime(totalNetMinutes)}</span></td>
                <td>${formatTime(totalOvertimeMinutes)}</td>
            </tr>
        `;
    }

    tbody.innerHTML = html;
    
    const gHours = Math.floor(grandTotalMinutes / 60);
    const gMins = grandTotalMinutes % 60;
    document.getElementById('total-hours').textContent = `${gHours}時間 ${gMins}分`;
    document.getElementById('total-users').textContent = `${activeUsersCount}人`;
}

function showDemoData() {
    document.getElementById('standard-hours').textContent = `180時間 0分`;
    
    const tbody = document.getElementById('aggregation-tbody');
    const html = `
        <tr>
            <td><strong>山田 太郎</strong><br><span style="font-size: 11px; color: var(--text-secondary);">設定休憩: 120分</span></td>
            <td>20 日</td>
            <td><span style="color:var(--accent-blue);font-weight:bold;">150時間 30分</span></td>
            <td>15時間 15分</td>
        </tr>
        <tr>
            <td><strong>佐藤 花子</strong><br><span style="font-size: 11px; color: var(--text-secondary);">設定休憩: 60分</span></td>
            <td>18 日</td>
            <td><span style="color:var(--accent-blue);font-weight:bold;">135時間 45分</span></td>
            <td>5時間 0分</td>
        </tr>
        <tr>
            <td colspan="4" style="text-align: center; font-size: 12px; color: var(--text-secondary);">
                ※現在はデモデータを表示しています。GASと連携すると実際の集計が表示されます。
            </td>
        </tr>
    `;
    tbody.innerHTML = html;
    document.getElementById('total-hours').textContent = `286時間 15分`;
    document.getElementById('total-users').textContent = `2人`;
}
