/**
 * スマート打刻システム - 管理画面ロジック
 */

let currentPassword = '';
let currentUsers = {};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-login').addEventListener('click', attemptLogin);
    document.getElementById('admin-password').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') attemptLogin();
    });

    document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
    document.getElementById('btn-add-user').addEventListener('click', saveUser);

    // 打刻履歴用のイベントリスナー
    const today = new Date();
    const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const monthSelect = document.getElementById('log-month-select');
    monthSelect.value = currentMonth;
    monthSelect.addEventListener('change', (e) => fetchLogData(e.target.value));

    document.getElementById('btn-open-add-log').addEventListener('click', openAddLogModal);
    document.getElementById('btn-save-log-edit').addEventListener('click', saveLogEdit);
    document.getElementById('btn-save-new-log').addEventListener('click', saveNewLog);
});

async function attemptLogin() {
    const pwdInput = document.getElementById('admin-password').value;
    const errorText = document.getElementById('password-error');
    
    if (!pwdInput) {
        errorText.textContent = 'パスワードを入力してください';
        return;
    }
    
    currentPassword = pwdInput;
    errorText.textContent = '';
    
    await fetchAdminData();
}

async function fetchAdminData() {
    const overlay = document.getElementById('loading-overlay');
    const pwdOverlay = document.getElementById('password-overlay');
    const adminContent = document.getElementById('admin-content');
    const errorText = document.getElementById('password-error');
    
    if (GAS_WEB_APP_URL.includes('YOUR_SCRIPT_ID_HERE')) {
        errorText.textContent = 'デモモードでは管理画面は利用できません。GASと連携してください。';
        return;
    }

    overlay.classList.remove('hidden');

    try {
        // 設定情報の取得
        const resSettings = await fetch(`${GAS_WEB_APP_URL}?action=get_settings&password=${encodeURIComponent(currentPassword)}`);
        const dataSettings = await resSettings.json();
        
        if (dataSettings.status !== 'success') {
            pwdOverlay.classList.remove('hidden');
            adminContent.classList.add('hidden');
            errorText.textContent = dataSettings.message || '認証に失敗しました';
            currentPassword = '';
            return;
        }

        // 従業員情報の取得
        const resUsers = await fetch(`${GAS_WEB_APP_URL}?action=get_users`);
        const dataUsers = await resUsers.json();
        currentUsers = dataUsers.data || {};

        // 画面の表示切替とデータセット
        pwdOverlay.classList.add('hidden');
        adminContent.classList.remove('hidden');
        
        document.getElementById('setting-password').value = dataSettings.data.password;
        document.getElementById('setting-email').value = dataSettings.data.email;
        
        renderUserTable(currentUsers);

        // 打刻履歴の取得（初期表示月）
        const selectedMonth = document.getElementById('log-month-select').value;
        fetchLogData(selectedMonth);

    } catch (error) {
        console.error(error);
        errorText.textContent = `通信エラー: ${error.message}`;
    } finally {
        overlay.classList.add('hidden');
    }
}

function renderUserTable(usersData) {
    const tbody = document.getElementById('user-tbody');
    let html = '';
    
    for (const [id, user] of Object.entries(usersData)) {
        html += `
            <tr>
                <td>${id}</td>
                <td>${user.name}</td>
                <td>${user.breakMinutes} 分</td>
                <td>
                    <button class="btn-small btn-danger" onclick="deleteUser('${id}')">削除</button>
                    <button class="btn-small btn-primary" onclick="editUser('${id}', '${user.name}', ${user.breakMinutes})" style="margin-left: 5px;">編集</button>
                </td>
            </tr>
        `;
    }
    
    if (html === '') {
        html = `<tr><td colspan="4" style="text-align:center;">従業員が登録されていません</td></tr>`;
    }
    
    tbody.innerHTML = html;
}

function editUser(id, name, breakMins) {
    document.getElementById('new-user-id').value = id;
    document.getElementById('new-user-name').value = name;
    document.getElementById('new-user-break').value = breakMins;
}

async function saveSettings() {
    const pwd = document.getElementById('setting-password').value;
    const email = document.getElementById('setting-email').value;
    
    if (!pwd) {
        alert('パスワードは必須です');
        return;
    }

    const payload = {
        action: 'save_settings',
        adminPassword: currentPassword,
        settings: { password: pwd, email: email }
    };

    await sendPostRequest(payload, '設定を保存しました。次回から新しいパスワードでログインしてください。');
    currentPassword = pwd; // 画面上のセッションも更新
}

async function saveUser() {
    const id = document.getElementById('new-user-id').value.trim();
    const name = document.getElementById('new-user-name').value.trim();
    const breakMins = document.getElementById('new-user-break').value;
    
    if (!id || !name || breakMins === '') {
        alert('すべての項目を入力してください');
        return;
    }

    const payload = {
        action: 'save_user',
        adminPassword: currentPassword,
        user: { id: id, name: name, breakMinutes: parseInt(breakMins, 10) }
    };

    await sendPostRequest(payload, '従業員情報を保存しました。');
    
    document.getElementById('new-user-id').value = '';
    document.getElementById('new-user-name').value = '';
    document.getElementById('new-user-break').value = '';
    
    await fetchAdminData();
}

async function deleteUser(id) {
    if (!confirm(`ユーザーID: ${id} を削除してもよろしいですか？\n※過去の打刻履歴は消えません`)) return;

    const payload = {
        action: 'delete_user',
        adminPassword: currentPassword,
        userId: id
    };

    await sendPostRequest(payload, '従業員を削除しました。');
    await fetchAdminData();
}

// === 打刻履歴管理用ロジック ===

async function fetchLogData(monthStr) {
    const tbody = document.getElementById('log-tbody');
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">データを読み込んでいます...</td></tr>`;

    try {
        const res = await fetch(`${GAS_WEB_APP_URL}?action=get_data&password=${encodeURIComponent(currentPassword)}&month=${encodeURIComponent(monthStr)}`);
        const result = await res.json();
        
        if (result.status !== 'success') {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color: red;">${result.message}</td></tr>`;
            return;
        }

        renderLogTable(result.data);
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color: red;">通信エラーが発生しました</td></tr>`;
    }
}

function renderLogTable(logs) {
    const tbody = document.getElementById('log-tbody');
    let html = '';
    
    // 降順にソート（新しい順）
    logs.sort((a, b) => new Date(b.serverTime) - new Date(a.serverTime));

    for (const log of logs) {
        const d = new Date(log.serverTime);
        const dateStr = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        
        // datetime-local用のフォーマット（YYYY-MM-DDThh:mm）
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

    if (!timeVal) {
        alert('日時を入力してください');
        return;
    }

    const payload = {
        action: 'update_log',
        adminPassword: currentPassword,
        rowNumber: parseInt(row, 10),
        newServerTime: new Date(timeVal).toISOString(),
        newType: typeVal
    };

    await sendPostRequest(payload, '打刻データを修正しました。');
    document.getElementById('edit-log-modal').classList.add('hidden');
    
    const selectedMonth = document.getElementById('log-month-select').value;
    fetchLogData(selectedMonth);
}

function openAddLogModal() {
    const userSelect = document.getElementById('add-log-user');
    let opts = '<option value="" disabled selected>選択してください</option>';
    for (const [id, user] of Object.entries(currentUsers)) {
        opts += `<option value="${id}">${user.name}</option>`;
    }
    userSelect.innerHTML = opts;
    
    // 現在時刻をセット
    const d = new Date();
    const isoLocal = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    document.getElementById('add-log-time').value = isoLocal;
    
    document.getElementById('add-log-modal').classList.remove('hidden');
}

async function saveNewLog() {
    const userId = document.getElementById('add-log-user').value;
    const timeVal = document.getElementById('add-log-time').value;
    const typeVal = document.getElementById('add-log-type').value;

    if (!userId || !timeVal) {
        alert('すべての項目を入力してください');
        return;
    }

    const userName = currentUsers[userId].name;

    const payload = {
        action: 'add_log',
        adminPassword: currentPassword,
        userId: userId,
        userName: userName,
        type: typeVal,
        serverTime: new Date(timeVal).toISOString(),
        clientTime: '管理者による手動追加'
    };

    await sendPostRequest(payload, '打刻データを手動追加しました。');
    document.getElementById('add-log-modal').classList.add('hidden');
    
    const selectedMonth = document.getElementById('log-month-select').value;
    fetchLogData(selectedMonth);
}

async function deleteLog(rowNumber) {
    if (!confirm(`この打刻データを削除してもよろしいですか？\n※この操作は元に戻せません`)) return;

    const payload = {
        action: 'delete_log',
        adminPassword: currentPassword,
        rowNumber: rowNumber
    };

    await sendPostRequest(payload, '打刻データを削除しました。');
    
    const selectedMonth = document.getElementById('log-month-select').value;
    fetchLogData(selectedMonth);
}

// === 汎用POSTリクエスト関数 ===

async function sendPostRequest(payload, successMsg) {
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
            alert(successMsg);
        } else {
            alert('エラー: ' + result.message);
        }
    } catch (error) {
        alert('通信エラー: ' + error.message);
    } finally {
        overlay.classList.add('hidden');
    }
}
