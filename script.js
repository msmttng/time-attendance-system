/**
 * スマート打刻システム - フロントエンドロジック
 */

// --- 設定 ---
// TODO: GASをデプロイしたあとに発行されるWebアプリのURLをここに設定する
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzL9bLmEB9EAy5dyeFUpZfn5OIpXW3ILWTLBvCfKb7adYbheY-23spINckRHRJRfBiU/exec';

let statusReqSeq = 0;
let statusTimeoutTimer = null;

// --- 時計機能 ---
function updateClock() {
    const now = new Date();
    
    // 日付フォーマット (例: 2026年6月2日 (火))
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    const dateStr = `${now.getMonth() + 1}月${now.getDate()}日 (${days[now.getDay()]})`;
    
    // 時刻フォーマット (例: 15:45:02)
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const timeStr = `${hours}:${minutes}:${seconds}`;
    
    const dateEl = document.getElementById('date-display');
    const timeEl = document.getElementById('time-display');
    if (dateEl) dateEl.textContent = dateStr;
    if (timeEl) timeEl.textContent = timeStr;
}

// 1秒ごとに時計を更新
setInterval(updateClock, 1000);

document.addEventListener('DOMContentLoaded', () => {
    updateClock(); // 初回実行
    initUserSelect(); // ユーザーリストの生成
    
    // ユーザー選択変更イベントの監視を追加
    const select = document.getElementById('user-select');
    if (select) {
        select.addEventListener('change', handleUserChange);
    }
});

// ユーザー変更時の打刻ステータス判定
async function handleUserChange() {
    const userSelect = document.getElementById('user-select');
    const userId = userSelect.value;
    const btnIn = document.getElementById('btn-clock-in');
    const btnOut = document.getElementById('btn-clock-out');
    
    const resetButtons = () => {
        btnIn.disabled = false;
        btnOut.disabled = false;
        btnIn.style.opacity = '1';
        btnOut.style.opacity = '1';
        btnIn.innerHTML = '<span class="icon">💼</span> 出勤';
        btnOut.innerHTML = '<span class="icon">🏠</span> 退勤';
    };
    
    if (!userId) {
        resetButtons();
        return;
    }
    
    if (GAS_WEB_APP_URL.includes('YOUR_SCRIPT_ID_HERE')) return;
    
    const cachedStr = localStorage.getItem('ta_users_v1');
    let punchStatus = null;
    if (cachedStr) {
        try {
            const cachedData = JSON.parse(cachedStr);
            if (cachedData.data && cachedData.data[userId]) {
                punchStatus = cachedData.data[userId].todayStatus;
            }
        } catch (e) {}
    }

    const applyStatus = (status) => {
        if (status === 'none') {
            btnIn.disabled = false;
            btnOut.disabled = true;
            btnIn.style.opacity = '1';
            btnOut.style.opacity = '0.4';
        } else if (status === 'in') {
            btnIn.disabled = true;
            btnOut.disabled = false;
            btnIn.style.opacity = '0.4';
            btnOut.style.opacity = '1';
        } else if (status === 'out') {
            btnIn.disabled = true;
            btnOut.disabled = true;
            btnIn.style.opacity = '0.4';
            btnOut.style.opacity = '0.4';
            showStatus('本日は既に退勤済みです。', 'success');
        }
        btnIn.innerHTML = '<span class="icon">💼</span> 出勤';
        btnOut.innerHTML = '<span class="icon">🏠</span> 退勤';
    };

    if (punchStatus !== null && punchStatus !== undefined) {
        applyStatus(punchStatus);
        return;
    }
    
    btnIn.disabled = false;
    btnOut.disabled = false;
    btnIn.innerHTML = '<span class="icon">💼</span> 確認中...';
    btnOut.innerHTML = '<span class="icon">🏠</span> 確認中...';
    
    statusReqSeq++;
    const currentSeq = statusReqSeq;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    try {
        const response = await fetch(`${GAS_WEB_APP_URL}?action=get_punch_status&userId=${encodeURIComponent(userId)}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        const result = await response.json();
        
        if (currentSeq !== statusReqSeq) return;
        
        if (result.status === 'success' && result.data) {
            applyStatus(result.data.status);
        } else {
            resetButtons();
        }
    } catch (error) {
        clearTimeout(timeoutId);
        if (currentSeq !== statusReqSeq) return;
        console.error('打刻ステータスの取得に失敗:', error);
        resetButtons();
    }
}

function buildSelectOptions(select, data) {
    select.innerHTML = '<option value="" disabled selected>選択してください</option>';
    for (const [id, user] of Object.entries(data)) {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = user.name;
        select.appendChild(option);
    }
}

// GASから従業員リストを取得してプルダウンを生成
async function initUserSelect() {
    const select = document.getElementById('user-select');
    if (!select) return;
    
    if (GAS_WEB_APP_URL.includes('YOUR_SCRIPT_ID_HERE')) {
        select.innerHTML = '<option value="" disabled selected>選択してください</option><option value="user001">山田 太郎 (デモ)</option><option value="user002">佐藤 花子 (デモ)</option>';
        return;
    }

    const cachedStr = localStorage.getItem('ta_users_v1');
    if (cachedStr) {
        try {
            const cachedData = JSON.parse(cachedStr);
            buildSelectOptions(select, cachedData.data);
        } catch (e) {}
    } else {
        select.innerHTML = '<option value="" disabled selected>読み込み中...</option>';
    }

    try {
        const response = await fetch(`${GAS_WEB_APP_URL}?action=get_users`);
        const result = await response.json();
        
        if (result.status === 'success' && result.data) {
            localStorage.setItem('ta_users_v1', JSON.stringify({ ts: Date.now(), data: result.data }));
            const currentValue = select.value;
            buildSelectOptions(select, result.data);
            if (currentValue && result.data[currentValue]) {
                select.value = currentValue;
                handleUserChange();
            }
        }
    } catch (error) {
        console.error('従業員リストの取得に失敗:', error);
        if (!cachedStr) {
            select.innerHTML = '<option value="" disabled selected>通信エラー</option>';
        }
    }
}

// --- 打刻送信機能 ---
async function submitAttendance(type) {
    const userSelect = document.getElementById('user-select');
    const userId = userSelect.value;
    const userName = userSelect.options[userSelect.selectedIndex].text;

    const btnIn = document.getElementById('btn-clock-in');
    const btnOut = document.getElementById('btn-clock-out');

    // バリデーション
    if (!userId) {
        showStatus('ユーザーを選択してください。', 'error');
        return;
    }

    // 連打防止
    btnIn.disabled = true;
    btnOut.disabled = true;

    // ローディング表示
    const overlay = document.getElementById('loading-overlay');
    overlay.classList.remove('hidden');

    const payload = {
        userId: userId,
        userName: userName,
        type: type, // 'in' or 'out'
        timestamp: new Date().toISOString(),
    };

    try {
        const response = await fetch(GAS_WEB_APP_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain;charset=utf-8',
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (result.status === 'success') {
            const actionText = type === 'in' ? '出勤' : '退勤';
            showStatus(`${userName} さん、${actionText}の打刻が完了しました！`, 'success');
            
            const cachedStr = localStorage.getItem('ta_users_v1');
            if (cachedStr) {
                try {
                    const cachedData = JSON.parse(cachedStr);
                    if (cachedData.data && cachedData.data[userId]) {
                        cachedData.data[userId].todayStatus = type === 'in' ? 'in' : 'out';
                        localStorage.setItem('ta_users_v1', JSON.stringify(cachedData));
                    }
                } catch(e) {}
            }
            
            userSelect.value = '';
        } else {
            throw new Error(result.message || 'サーバーエラーが発生しました');
        }

    } catch (error) {
        console.error('Error:', error);
        if (GAS_WEB_APP_URL.includes('YOUR_SCRIPT_ID_HERE')) {
            setTimeout(() => {
                const actionText = type === 'in' ? '出勤' : '退勤';
                showStatus(`[デモモード] ${userName} さん、${actionText}の打刻が完了しました。（連携未設定）`, 'success');
                userSelect.value = '';
                overlay.classList.add('hidden');
            }, 1000);
            return;
        }

        showStatus(`エラー: ${error.message}`, 'error');
        
        const cachedStr = localStorage.getItem('ta_users_v1');
        if (cachedStr) {
            try {
                const cachedData = JSON.parse(cachedStr);
                if (cachedData.data && cachedData.data[userId]) {
                    delete cachedData.data[userId].todayStatus;
                    localStorage.setItem('ta_users_v1', JSON.stringify(cachedData));
                }
            } catch(e) {}
        }
    } finally {
        if (!GAS_WEB_APP_URL.includes('YOUR_SCRIPT_ID_HERE')) {
            overlay.classList.add('hidden');
            handleUserChange();
        }
    }
}

// --- UI操作 ---
function showStatus(message, type) {
    const statusEl = document.getElementById('status-message');
    statusEl.textContent = message;
    statusEl.className = `status-message status-${type} show`;

    if (statusTimeoutTimer) clearTimeout(statusTimeoutTimer);
    statusTimeoutTimer = setTimeout(() => {
        statusEl.classList.remove('show');
    }, 5000);
}
