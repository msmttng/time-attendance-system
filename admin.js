/**
 * スマート打刻システム - 管理画面ロジック
 */

let currentPassword = '';

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-login').addEventListener('click', attemptLogin);
    document.getElementById('admin-password').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') attemptLogin();
    });

    document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
    document.getElementById('btn-add-user').addEventListener('click', saveUser);
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

        // 画面の表示切替とデータセット
        pwdOverlay.classList.add('hidden');
        adminContent.classList.remove('hidden');
        
        document.getElementById('setting-password').value = dataSettings.data.password;
        document.getElementById('setting-email').value = dataSettings.data.email;
        
        renderUserTable(dataUsers.data);

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
    
    // 入力欄をクリア
    document.getElementById('new-user-id').value = '';
    document.getElementById('new-user-name').value = '';
    document.getElementById('new-user-break').value = '';
    
    // 一覧を再取得
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
