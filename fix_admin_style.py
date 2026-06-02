import sys, re

with open('admin.html', 'r', encoding='utf-8') as f:
    content = f.read()

new_style = '''    <style>
        :root {
            --primary-blue: #1e40af;          /* 落ち着いたディープブルー (法人・医療向け) */
            --primary-blue-light: #2563eb;    /* 視認性の高いクリアブルー */
            --primary-blue-bg: #eff6ff;       /* 清潔感のある極薄ブルー背景 */
            --emerald-dark: #065f46;          /* 承認・成功用のグリーン */
            --emerald-med: #059669;
            --emerald-soft: rgba(16, 185, 129, 0.08);
            --accent-coral: #e11d48;          /* 警告、退勤等のローズコーラル */
            --accent-coral-soft: rgba(225, 29, 72, 0.06);
            --text-primary: #0f172a;          /* 最もコントラストの高いスレート */
            --text-secondary: #475569;
            --bg-light: #f8fafc;              /* 全体の背景 (ブルーグレー) */
            --glass-border: rgba(37, 99, 235, 0.15);
            --glass-bg: rgba(255, 255, 255, 0.95);
        }

        /* 視認性優先のクリーンなベース設定 */
        body {
            background-color: var(--bg-light) !important;
            color: var(--text-primary);
            min-height: 100vh;
            margin: 0;
            padding: 30px 0;
            overflow-y: auto;
        }

        /* 中央寄せと適正な幅設定 (右寄り問題を解消) */
        body .container {
            max-width: 1100px; /* 視認性向上のため少し広く */
            margin: 0 auto;
            padding: 35px 40px;
            width: 92%;
            border-radius: 16px;
            background: var(--glass-bg);
            border: 1px solid var(--glass-border);
            box-shadow: 0 10px 30px rgba(15, 23, 42, 0.05);
            box-sizing: border-box;
        }

        .admin-section {
            background: #ffffff;
            border-radius: 12px;
            padding: 25px;
            margin-bottom: 25px;
            box-shadow: 0 4px 15px rgba(37, 99, 235, 0.03);
            border: 1px solid var(--glass-border);
        }
        
        .admin-section h3 {
            margin-top: 0;
            margin-bottom: 20px;
            font-size: 1.25rem;
            font-weight: 700;
            color: var(--primary-blue);
            border-left: 4px solid var(--primary-blue-light);
            padding-left: 12px;
            padding-bottom: 2px;
            display: inline-block;
            white-space: nowrap;
        }
        
        /* ボタン基本 */
        .btn {
            padding: 10px 20px;
            font-size: 14px;
            border-radius: 8px;
            font-weight: 600;
            transition: all 0.2s;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 1px solid transparent;
        }
        .btn:hover { transform: translateY(-1px); }
        .btn:active { transform: scale(0.98); }

        .form-row { display: flex; gap: 15px; margin-bottom: 15px; align-items: flex-end; flex-wrap: wrap; }
        .form-row > div { flex: 1; min-width: 160px; }
        
        /* フォーム系 */
        .admin-section input[type="text"],
        .admin-section input[type="email"],
        .admin-section input[type="number"],
        .admin-section input[type="password"],
        .modal input[type="datetime-local"],
        .modal select,
        select#month-select,
        select#user-view-select {
            width: 100%;
            padding: 11px 14px;
            border: 2px solid #e2e8f0;
            border-radius: 8px;
            font-size: 14px;
            background: #ffffff;
            transition: border-color 0.2s, box-shadow 0.2s;
            outline: none;
            color: var(--text-primary);
            font-weight: 500;
            box-sizing: border-box;
        }
        .admin-section input:focus,
        .modal input:focus,
        .modal select:focus,
        select#month-select:focus,
        select#user-view-select:focus {
            border-color: var(--primary-blue-light) !important;
            box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15) !important;
        }

        .table-container {
            overflow-x: auto;
            background: white;
            border-radius: 12px;
            border: 1px solid rgba(37, 99, 235, 0.1);
            margin-top: 15px;
        }
        table { width: 100%; border-collapse: collapse; text-align: left; }
        
        th {
            background: var(--primary-blue) !important;
            font-weight: 600;
            font-size: 13px;
            color: white !important;
            padding: 14px 16px;
            border: none;
        }
        
        td {
            padding: 12px 16px;
            border-bottom: 1px solid #e2e8f0;
            color: var(--text-primary);
            white-space: nowrap;
            font-weight: 500;
        }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: var(--primary-blue-bg) !important; }
        
        .btn-small {
            padding: 6px 12px;
            font-size: 12px;
            border-radius: 6px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            border: 1px solid transparent;
            text-decoration: none;
        }

        .btn-small.btn-primary {
            color: var(--primary-blue) !important;
            background: var(--primary-blue-bg) !important;
            border-color: rgba(37, 99, 235, 0.2) !important;
        }
        .btn-small.btn-primary:hover {
            color: white !important;
            background: var(--primary-blue) !important;
        }
        
        .btn-small.btn-danger {
            color: var(--accent-coral) !important;
            background: var(--accent-coral-soft) !important;
            border-color: rgba(225, 29, 72, 0.2) !important;
        }
        .btn-small.btn-danger:hover {
            color: white !important;
            background: var(--accent-coral) !important;
        }
        
        .btn-small.btn-success {
            color: var(--emerald-dark) !important;
            background: var(--emerald-soft) !important;
            border-color: rgba(16, 185, 129, 0.2) !important;
        }
        .btn-small.btn-success:hover {
            color: white !important;
            background: var(--emerald-med) !important;
        }
        
        .modal {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(15, 23, 42, 0.6);
            display: flex; justify-content: center; align-items: center;
            z-index: 1000;
            backdrop-filter: blur(4px);
        }
        .modal-content {
            background: white; padding: 30px; border-radius: 12px;
            width: 90%; max-width: 420px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
        }
        .modal h3 { margin-top: 0; margin-bottom: 20px; color: var(--primary-blue); font-weight: 700; font-size: 1.2rem; }

        .summary-cards {
            display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
            gap: 15px; margin-bottom: 25px;
        }
        .card {
            background: white; padding: 16px; border-radius: 12px;
            border: 1px solid rgba(37, 99, 235, 0.1);
            box-shadow: 0 4px 10px rgba(37, 99, 235, 0.03);
            transition: all 0.2s;
        }
        .card:hover { border-color: rgba(37, 99, 235, 0.3); transform: translateY(-2px); }
        .card-title { font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; }
        .card-value { font-size: 20px; font-weight: 700; color: var(--primary-blue); }
        
        .admin-header {
            display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap;
            margin-bottom: 30px; gap: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 18px;
        }

        .overlay input[type="password"] {
            width: 100%; padding: 14px 20px; border: 2px solid #e2e8f0; border-radius: 10px;
            font-size: 16px; background: white; text-align: center;
            margin-bottom: 20px; font-weight: 600; box-sizing: border-box;
        }
        .overlay input[type="password"]:focus { border-color: var(--primary-blue-light); outline: none; }

        @media (max-width: 800px) { #individual-view { grid-template-columns: 1fr !important; } }
        @media (max-width: 600px) {
            .admin-header { flex-direction: column; align-items: center; text-align: center; }
            .form-row { flex-direction: column; align-items: stretch; }
            .form-row > div { min-width: 100%; }
            .btn { width: 100% !important; margin-top: 10px; }
        }
        .hidden { display: none !important; }
    </style>'''

content = re.sub(r'<style>.*?</style>', new_style, content, flags=re.DOTALL)

content = content.replace('<div class="background-animation"></div>', '<!-- 背景アニメーション無効化 -->')
content = content.replace('<div class="container glass-panel" style="max-width: 950px; padding: 30px; width: 95%;">', '<div class="container">')

old_indiv = '''            <!-- 従業員個別詳細勤務表モード (デフォルト非表示、アバター不要版) -->
            <div id="individual-view" class="hidden" style="display: grid; grid-template-columns: 280px 1fr; gap: 25px; align-items: start; margin-bottom: 25px;">
                
                <!-- 左カラム: 個人設定・プロフィールサイドバー -->
                <div class="admin-section" style="margin-bottom: 0; padding: 20px; border: 1px solid rgba(13, 92, 79, 0.1); background: white; display: flex; flex-direction: column; gap: 20px;">
                    <div>
                        <h3 style="border: none; font-size: 1.1rem; width: 100%; margin-bottom: 15px;">👤 個人契約設定</h3>
                        <div style="margin-bottom: 20px; padding-left: 5px;">
                            <h4 id="profile-name" style="font-size: 20px; font-weight: 700; color: var(--primary-teal); margin-bottom: 5px;">-- --</h4>
                            <p id="profile-email" style="font-size: 13px; color: var(--text-secondary); margin: 0; word-break: break-all;">--@--</p>
                        </div>
                        
                        <div style="border-top: 1px solid rgba(13, 92, 79, 0.08); padding-top: 15px;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 13px;">
                                <span style="color: var(--text-secondary);">勤務契約時間</span>
                                <span id="profile-times" style="font-weight: 600; color: var(--text-primary);">--:-- 〜 --:--</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 13px;">
                                <span style="color: var(--text-secondary);">設定休憩時間</span>
                                <span id="profile-break" style="font-weight: 600; color: var(--text-primary);">--分</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 13px;">
                                <span style="color: var(--text-secondary);">月間所定時間</span>
                                <span id="profile-standard" style="font-weight: 600; color: var(--text-primary);">--時間</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 13px;">
                                <span style="color: var(--text-secondary);">基本給与額</span>
                                <span id="profile-salary" style="font-weight: 600; color: var(--text-primary);">--円</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 13px;">
                                <span style="color: var(--text-secondary);">勤務形態</span>
                                <span id="profile-worktype" style="font-weight: 600; color: var(--text-primary);">--</span>
                            </div>
                        </div>
                        
                        <button id="btn-edit-profile" class="btn" style="width: 100%; margin-top: 20px; padding: 12px; font-size: 13px; border-radius: 8px; font-weight: 600; background: var(--primary-teal-bg); color: var(--primary-teal); border: 1px solid rgba(15, 159, 144, 0.2); box-shadow: 0 2px 5px rgba(13, 92, 79, 0.02); cursor: pointer;">
                            ⚙️ 契約条件の変更
                        </button>
                    </div>

                    <!-- 管理者代理打刻セクション (サイドバー下部へ美しく統合) -->
                    <div style="border-top: 1px solid rgba(13, 92, 79, 0.08); padding-top: 20px;">
                        <h3 style="border: none; font-size: 1.05rem; width: 100%; margin-bottom: 15px;">🕒 管理者代理打刻</h3>
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            <button id="btn-proxy-in" class="btn" style="width: 100%; padding: 11px; font-size: 13px; background: #0284c7; color: white; border: none; box-shadow: 0 4px 10px rgba(2, 132, 199, 0.12); cursor: pointer;">出勤を記録する</button>
                            <button id="btn-proxy-out" class="btn" style="width: 100%; padding: 11px; font-size: 13px; background: #e11d48; color: white; border: none; box-shadow: 0 4px 10px rgba(225, 29, 72, 0.12); cursor: pointer;">退勤を記録する</button>
                        </div>
                    </div>
                </div>
                
                <!-- 右カラム: 勤務詳細 (月次詳細サマリーと日別勤務表) -->
                <div style="display: flex; flex-direction: column; gap: 25px;">
                    
                    <!-- 個別アクションヘッダー -->
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0px; flex-wrap: wrap; gap: 10px;">
                        <div style="display: flex; gap: 10px;">
                            <button id="btn-export-csv" class="btn" style="padding: 10px 18px; font-size: 13px; font-weight: 600; background: #059669; color: white; border: none; box-shadow: 0 4px 10px rgba(5, 150, 105, 0.15); cursor: pointer;"><span style="margin-right: 6px;">📥</span>CSVで出力</button>
                            <button onclick="alert('Excel出力はCSV形式でのダウンロードが推奨されています。CSV出力をご利用ください。')" class="btn" style="padding: 10px 18px; font-size: 13px; font-weight: 600; background: #047857; color: white; border: none; box-shadow: 0 4px 10px rgba(4, 120, 87, 0.15); cursor: pointer;"><span style="margin-right: 6px;">📊</span>EXCELで出力</button>
                        </div>
                    </div>
                    
                    <!-- 個別月次集計カード (プレミアム化) -->
                    <div class="admin-section" style="padding: 20px; margin-bottom: 0; border: 1px solid rgba(13, 92, 79, 0.08); background: white;">
                        <h3 style="border: none; font-size: 1.1rem; width: 100%;">📊 月別詳細サマリー</h3>
                        <div class="summary-cards" style="grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-bottom: 0;">
                            <div class="card" style="padding: 12px; background: #fafdfc;">
                                <div class="card-title" style="font-size: 11px; margin-bottom: 4px;">作業月</div>
                                <div class="card-value" id="indiv-month" style="font-size: 18px;">--年--月</div>
                            </div>
                            <div class="card" style="padding: 12px; background: #fafdfc;">
                                <div class="card-title" style="font-size: 11px; margin-bottom: 4px;">所定時間</div>
                                <div class="card-value" id="indiv-standard-hours" style="font-size: 18px;">--時間</div>
                            </div>
                            <div class="card" style="padding: 12px; background: #fafdfc;">
                                <div class="card-title" style="font-size: 11px; margin-bottom: 4px;">稼働時間</div>
                                <div class="card-value" id="indiv-total-hours" style="font-size: 18px; color: var(--primary-teal);">--時間--分</div>
                            </div>
                            <div class="card" style="padding: 12px; background: #fafdfc;">
                                <div class="card-title" style="font-size: 11px; margin-bottom: 4px;">時間外</div>
                                <div class="card-value" id="indiv-overtime-hours" style="font-size: 18px; color: var(--accent-coral);">--時間--分</div>
                            </div>
                            <div class="card" style="padding: 12px; background: #fafdfc;">
                                <div class="card-title" style="font-size: 11px; margin-bottom: 4px;">稼働日数</div>
                                <div class="card-value" id="indiv-work-days" style="font-size: 18px;">--日</div>
                            </div>
                            <div class="card" style="padding: 12px; background: #fafdfc;">
                                <div class="card-title" style="font-size: 11px; margin-bottom: 4px;">概算給与</div>
                                <div class="card-value" id="indiv-earned-salary" style="font-size: 18px; color: var(--emerald-med); font-weight: bold;">--円</div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- 日別カレンダー勤務表 -->
                    <div class="admin-section" style="padding: 20px; margin-bottom: 0; border: 1px solid rgba(13, 92, 79, 0.08); background: white;">
                        <h3 style="border: none; font-size: 1.1rem; width: 100%;">📅 勤務表詳細</h3>
                        <div class="table-container" style="margin-top: 5px;">
                            <table style="font-size: 13px;">
                                <thead>
                                    <tr>
                                        <th style="width: 60px;">編集</th>
                                        <th style="width: 60px;">区分</th>
                                        <th>日付</th>
                                        <th>開始</th>
                                        <th>所定終了</th>
                                        <th>終了</th>
                                        <th>休憩</th>
                                        <th>実働</th>
                                        <th>時間外</th>
                                        <th style="width: 140px; text-align: center;">承認</th>
                                        <th>日報</th>
                                    </tr>
                                </thead>
                                <tbody id="indiv-calendar-tbody">
                                    <!-- JSで1日〜末日まで自動生成 -->
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>'''

new_indiv = '''            <!-- 従業員個別詳細勤務表モード (視認性改善のブルーテーマ版) -->
            <div id="individual-view" class="hidden" style="display: grid; grid-template-columns: 250px 1fr; gap: 20px; align-items: start; margin-bottom: 25px;">
                
                <!-- 左カラム: 個人設定・プロフィールサイドバー -->
                <div class="admin-section" style="margin-bottom: 0; padding: 20px; display: flex; flex-direction: column; gap: 20px;">
                    <div>
                        <h3 style="border: none; font-size: 1.1rem; width: 100%; margin-bottom: 15px;">👤 個人契約設定</h3>
                        <div style="margin-bottom: 20px; padding-left: 5px;">
                            <h4 id="profile-name" style="font-size: 20px; font-weight: 700; color: var(--primary-blue); margin-bottom: 5px;">-- --</h4>
                            <p id="profile-email" style="font-size: 13px; color: var(--text-secondary); margin: 0; word-break: break-all;">--@--</p>
                        </div>
                        
                        <div style="border-top: 1px solid #e2e8f0; padding-top: 15px;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 13px;">
                                <span style="color: var(--text-secondary);">勤務契約時間</span>
                                <span id="profile-times" style="font-weight: 600; color: var(--text-primary);">--:-- 〜 --:--</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 13px;">
                                <span style="color: var(--text-secondary);">設定休憩時間</span>
                                <span id="profile-break" style="font-weight: 600; color: var(--text-primary);">--分</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 13px;">
                                <span style="color: var(--text-secondary);">月間所定時間</span>
                                <span id="profile-standard" style="font-weight: 600; color: var(--text-primary);">--時間</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 13px;">
                                <span style="color: var(--text-secondary);">基本給与額</span>
                                <span id="profile-salary" style="font-weight: 600; color: var(--text-primary);">--円</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 13px;">
                                <span style="color: var(--text-secondary);">勤務形態</span>
                                <span id="profile-worktype" style="font-weight: 600; color: var(--text-primary);">--</span>
                            </div>
                        </div>
                        
                        <button id="btn-edit-profile" class="btn" style="width: 100%; margin-top: 20px; padding: 12px; font-size: 13px; border-radius: 8px; font-weight: 600; background: var(--primary-blue-bg); color: var(--primary-blue-light); border: 1px solid rgba(37, 99, 235, 0.2); box-shadow: 0 2px 5px rgba(0, 0, 0, 0.02); cursor: pointer;">
                            ⚙️ 契約条件の変更
                        </button>
                    </div>

                    <!-- 管理者代理打刻セクション (サイドバー下部へ美しく統合) -->
                    <div style="border-top: 1px solid #e2e8f0; padding-top: 20px;">
                        <h3 style="border: none; font-size: 1.05rem; width: 100%; margin-bottom: 15px;">🕒 管理者代理打刻</h3>
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            <button id="btn-proxy-in" class="btn" style="width: 100%; padding: 11px; font-size: 13px; background: #2563eb; color: white; border: none; box-shadow: 0 4px 10px rgba(37, 99, 235, 0.2); cursor: pointer;">出勤を記録する</button>
                            <button id="btn-proxy-out" class="btn" style="width: 100%; padding: 11px; font-size: 13px; background: #e11d48; color: white; border: none; box-shadow: 0 4px 10px rgba(225, 29, 72, 0.2); cursor: pointer;">退勤を記録する</button>
                        </div>
                    </div>
                </div>
                
                <!-- 右カラム: 勤務詳細 (月次詳細サマリーと日別勤務表) -->
                <div style="display: flex; flex-direction: column; gap: 20px;">
                    
                    <!-- 個別アクションヘッダー -->
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0px; flex-wrap: wrap; gap: 10px;">
                        <div style="display: flex; gap: 10px;">
                            <button id="btn-export-csv" class="btn" style="padding: 10px 18px; font-size: 13px; font-weight: 600; background: var(--primary-blue-light); color: white; border: none; box-shadow: 0 4px 10px rgba(37, 99, 235, 0.2); cursor: pointer;"><span style="margin-right: 6px;">📥</span>CSVで出力</button>
                            <button onclick="alert('Excel出力はCSV形式でのダウンロードが推奨されています。CSV出力をご利用ください。')" class="btn" style="padding: 10px 18px; font-size: 13px; font-weight: 600; background: var(--primary-blue); color: white; border: none; box-shadow: 0 4px 10px rgba(30, 58, 138, 0.2); cursor: pointer;"><span style="margin-right: 6px;">📊</span>EXCELで出力</button>
                        </div>
                    </div>
                    
                    <!-- 個別月次集計カード (プレミアム化) -->
                    <div class="admin-section" style="padding: 20px; margin-bottom: 0;">
                        <h3 style="border: none; font-size: 1.1rem; width: 100%;">📊 月別詳細サマリー</h3>
                        <div class="summary-cards" style="grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-bottom: 0;">
                            <div class="card" style="padding: 12px; background: #f8fafc;">
                                <div class="card-title" style="font-size: 11px; margin-bottom: 4px;">作業月</div>
                                <div class="card-value" id="indiv-month" style="font-size: 18px;">--年--月</div>
                            </div>
                            <div class="card" style="padding: 12px; background: #f8fafc;">
                                <div class="card-title" style="font-size: 11px; margin-bottom: 4px;">所定時間</div>
                                <div class="card-value" id="indiv-standard-hours" style="font-size: 18px;">--時間</div>
                            </div>
                            <div class="card" style="padding: 12px; background: #f8fafc;">
                                <div class="card-title" style="font-size: 11px; margin-bottom: 4px;">稼働時間</div>
                                <div class="card-value" id="indiv-total-hours" style="font-size: 18px; color: var(--primary-blue-light);">--時間--分</div>
                            </div>
                            <div class="card" style="padding: 12px; background: #f8fafc;">
                                <div class="card-title" style="font-size: 11px; margin-bottom: 4px;">時間外</div>
                                <div class="card-value" id="indiv-overtime-hours" style="font-size: 18px; color: var(--accent-coral);">--時間--分</div>
                            </div>
                            <div class="card" style="padding: 12px; background: #f8fafc;">
                                <div class="card-title" style="font-size: 11px; margin-bottom: 4px;">稼働日数</div>
                                <div class="card-value" id="indiv-work-days" style="font-size: 18px;">--日</div>
                            </div>
                            <div class="card" style="padding: 12px; background: #f8fafc;">
                                <div class="card-title" style="font-size: 11px; margin-bottom: 4px;">概算給与</div>
                                <div class="card-value" id="indiv-earned-salary" style="font-size: 18px; color: var(--emerald-med); font-weight: bold;">--円</div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- 日別カレンダー勤務表 -->
                    <div class="admin-section" style="padding: 20px; margin-bottom: 0;">
                        <h3 style="border: none; font-size: 1.1rem; width: 100%;">📅 勤務表詳細</h3>
                        <div class="table-container" style="margin-top: 5px;">
                            <table style="font-size: 13px;">
                                <thead>
                                    <tr>
                                        <th style="width: 60px;">編集</th>
                                        <th style="width: 60px;">区分</th>
                                        <th>日付</th>
                                        <th>開始</th>
                                        <th>所定終了</th>
                                        <th>終了</th>
                                        <th>休憩</th>
                                        <th>実働</th>
                                        <th>時間外</th>
                                        <th style="width: 140px; text-align: center;">承認</th>
                                        <th>日報</th>
                                    </tr>
                                </thead>
                                <tbody id="indiv-calendar-tbody">
                                    <!-- JSで1日〜末日まで自動生成 -->
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>'''
content = content.replace(old_indiv, new_indiv)

content = content.replace('var(--accent-blue)', 'var(--primary-blue)')
content = content.replace('var(--success-color)', 'var(--emerald-med)')

with open('admin.html', 'w', encoding='utf-8') as f:
    f.write(content)
