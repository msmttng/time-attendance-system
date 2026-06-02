/**
 * スマート打刻システム - 管理ダッシュボードロジック
 */

let currentPassword = '';
let currentUsers = {};
let holidaysData = {};

document.addEventListener('DOMContentLoaded', () => {
    initMonthSelector();
    
    // 祝日データの取得
    fetch('https://holidays-jp.github.io/api/v1/date.json')
        .then(res => res.json())
        .then(data => { holidaysData = data; })
        .catch(err => console.error('祝日データの取得に失敗しました', err));

    document.getElementById('btn-login').addEventListener('click', attemptLogin);
    document.getElementById('admin-password').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') attemptLogin();
    });

    document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
    document.getElementById('btn-add-user').addEventListener('click', saveUser);

    document.getElementById('month-select').addEventListener('change', (e) => fetchDashboardData(e.target.value));

    document.getElementById('btn-open-add-log').addEventListener('click', openAddLogModal);
    document.getElementById('btn-save-log-edit').addEventListener('click', saveLogEdit);
    document.getElementById('btn-save-new-log').addEventListener('click', saveNewLog);
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
            if (dayOfWeek >= 1 && dayOfWeek <= 5) totalStandardMinutes += 585; // 9:15-19:00
            else if (dayOfWeek === 6) totalStandardMinutes += 255;             // 9:15-13:30
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
        
        if (dataLogs.status === 'success') {
            renderLogTable(dataLogs.data);
            renderAggregationDashboard(dataLogs.data, currentUsers);
        } else {
            document.getElementById('log-tbody').innerHTML = `<tr><td colspan="4" style="text-align:center; color:red;">${dataLogs.message}</td></tr>`;
            document.getElementById('aggregation-tbody').innerHTML = `<tr><td colspan="4" style="text-align:center; color:red;">${dataLogs.message}</td></tr>`;
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

// === 集計ダッシュボードの描画 ===

function renderAggregationDashboard(rawData, employeesSettings = {}) {
    const tbody = document.getElementById('aggregation-tbody');
    
    if (!rawData || rawData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center;">この月のデータはありません</td></tr>`;
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
        
        let totalNetMinutes = 0, totalOvertimeMinutes = 0, workDays = 0;
        
        for (const day in user.days) {
            const log = user.days[day];
            if (!log.in || !log.out) continue; 
            
            workDays++;
            const inMins = log.in.getHours() * 60 + log.in.getMinutes();
            const outMins = log.out.getHours() * 60 + log.out.getMinutes();
            const dayOfWeek = log.date.getDay(); 
            
            let grossMins = outMins - inMins;
            if (grossMins < 0) grossMins = 0;
            
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
                <td><span style="color:var(--accent-blue);font-weight:bold;">${formatTime(totalNetMinutes)}</span></td>
                <td>${formatTime(totalOvertimeMinutes)}</td>
            </tr>
        `;
    }

    tbody.innerHTML = html;
    document.getElementById('total-hours').textContent = `${Math.floor(grandTotalMinutes / 60)}時間 ${grandTotalMinutes % 60}分`;
    document.getElementById('total-users').textContent = `${activeUsersCount}人`;
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
                    <button class="btn-small btn-primary" onclick="editUser('${id}', '${user.name}', ${user.breakMinutes})" style="margin-left: 5px;">編集</button>
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
    await sendPostRequest(payload, '従業員を保存しました。');
    document.getElementById('new-user-id').value = '';
    document.getElementById('new-user-name').value = '';
    document.getElementById('new-user-break').value = '';
    fetchDashboardData(document.getElementById('month-select').value);
}

async function deleteUser(id) {
    if (!confirm(`ユーザーID: ${id} を削除しますか？`)) return;
    const payload = { action: 'delete_user', adminPassword: currentPassword, userId: id };
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
