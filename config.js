/**
 * スマート打刻システム - 共通設定
 * 
 * ユーザーのリストや休憩時間（分）の設定を行います。
 * ※この内容は GAS 側の Code.gs 内の設定と一致させる必要があります。
 */
const USER_SETTINGS = {
    'user001': { name: '山田 太郎', breakMinutes: 120 }, // 休憩2時間
    'user002': { name: '佐藤 花子', breakMinutes: 60 },  // 休憩1時間
    'user003': { name: '鈴木 一郎', breakMinutes: 0 },   // 休憩なし
    'user004': { name: '高橋 美咲', breakMinutes: 90 }   // 休憩1時間半
};
