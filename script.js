/**
 * スマート打刻システム - フロントエンドロジック
 */

// --- 設定 ---
// TODO: GASをデプロイしたあとに発行されるWebアプリのURLをここに設定する
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxC6QMDA8rozGLPQylqpW8Kx_njtdWIjyaAJIwe61f01Nahc3b1DQKEVGFkjmqjN2S_/exec';

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
    
    document.getElementById('date-display').textContent = dateStr;
    document.getElementById('time-display').textContent = timeStr;
}

// 1秒ごとに時計を更新
setInterval(updateClock, 1000);

document.addEventListener('DOMContentLoaded', () => {
    updateClock(); // 初回実行
    initUserSelect(); // ユーザーリストの生成
});

// GASから従業員リストを取得してプルダウンを生成
async function initUserSelect() {
    const select = document.getElementById('user-select');
    
    if (GAS_WEB_APP_URL.includes('YOUR_SCRIPT_ID_HERE')) {
        // デモ用データ
        select.innerHTML = '<option value="" disabled selected>選択してください</option><option value="user001">山田 太郎 (デモ)</option><option value="user002">佐藤 花子 (デモ)</option>';
        return;
    }

    try {
        const response = await fetch(`${GAS_WEB_APP_URL}?action=get_users`);
        const result = await response.json();
        
        if (result.status === 'success' && result.data) {
            select.innerHTML = '<option value="" disabled selected>選択してください</option>';
            for (const [id, user] of Object.entries(result.data)) {
                const option = document.createElement('option');
                option.value = id;
                option.textContent = user.name;
                select.appendChild(option);
            }
        }
    } catch (error) {
        console.error('従業員リストの取得に失敗:', error);
        select.innerHTML = '<option value="" disabled selected>通信エラー</option>';
    }
}

// --- 打刻送信機能 ---
async function submitAttendance(type) {
    const userSelect = document.getElementById('user-select');
    const userId = userSelect.value;
    const userName = userSelect.options[userSelect.selectedIndex].text;

    // バリデーション
    if (!userId) {
        showStatus('ユーザーを選択してください。', 'error');
        return;
    }

    // ローディング表示
    const overlay = document.getElementById('loading-overlay');
    overlay.classList.remove('hidden');

    const payload = {
        userId: userId,
        userName: userName,
        type: type, // 'in' or 'out'
        timestamp: new Date().toISOString(), // クライアント側の参考時刻（正確な時刻はGAS側で取る）
    };

    try {
        // Fetch APIでGASへPOST送信 (no-corsモードはレスポンスが読めないので標準モードを使用、GAS側でCORS対応が必要)
        // または、GASの仕様上 POSTリクエストをJSONで送る場合は、text/plainとして送りGAS側でパースするワークアラウンドが一般的です。
        
        const response = await fetch(GAS_WEB_APP_URL, {
            method: 'POST',
            // redirect: 'follow', // GASのリダイレクトに対応
            // Content-Type を text/plain にすることでCORSプリフライトを回避できるケースがあります
            headers: {
                'Content-Type': 'text/plain;charset=utf-8',
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (result.status === 'success') {
            const actionText = type === 'in' ? '出勤' : '退勤';
            showStatus(`${userName} さん、${actionText}の打刻が完了しました！`, 'success');
            // セレクトボックスをリセット
            userSelect.value = '';
        } else {
            throw new Error(result.message || 'サーバーエラーが発生しました');
        }

    } catch (error) {
        console.error('Error:', error);
        // モック動作（GAS URLが未設定の場合のエラーフォールバック用）
        if (GAS_WEB_APP_URL.includes('YOUR_SCRIPT_ID_HERE')) {
            setTimeout(() => {
                const actionText = type === 'in' ? '出勤' : '退勤';
                showStatus(`[デモモード] ${userName} さん、${actionText}の打刻が完了しました。（連携未設定）`, 'success');
                userSelect.value = '';
                overlay.classList.add('hidden');
            }, 1000);
            return;
        }

        showStatus(`通信エラーが発生しました: ${error.message}`, 'error');
    } finally {
        if (!GAS_WEB_APP_URL.includes('YOUR_SCRIPT_ID_HERE')) {
            overlay.classList.add('hidden');
        }
    }
}

// --- UI操作 ---
function showStatus(message, type) {
    const statusEl = document.getElementById('status-message');
    statusEl.textContent = message;
    statusEl.className = `status-message status-${type} show`;

    // 5秒後に消す
    setTimeout(() => {
        statusEl.classList.remove('show');
    }, 5000);
}
