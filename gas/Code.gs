/**
 * スマート打刻システム - GAS バックエンド (実務ルール完全対応版)
 */

const SHEET_NAME = '打刻履歴';

// --- 管理者設定 ---
const DASHBOARD_PASSWORD = 'admin'; 
const ADMIN_EMAIL = 'your-email@gmail.com'; 

// --- ユーザーごとの休憩設定（分単位） ---
// ※フロントエンドの config.js と同じ内容を設定してください
const USER_SETTINGS = {
    'user001': { name: '山田 太郎', breakMinutes: 120 }, 
    'user002': { name: '佐藤 花子', breakMinutes: 60 },  
    'user003': { name: '鈴木 一郎', breakMinutes: 0 },   
    'user004': { name: '高橋 美咲', breakMinutes: 90 }   
};

function doPost(e) {
  try {
    let payload = JSON.parse(e.postData.contents);
    const { userId, userName, type, timestamp } = payload;
    
    const serverTime = new Date();
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) throw new Error(`シート「${SHEET_NAME}」が見つかりません。`);

    const typeText = type === 'in' ? '出勤' : (type === 'out' ? '退勤' : type);

    sheet.appendRow([serverTime, userId, userName, typeText, timestamp]);

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      message: '打刻が正常に記録されました。',
      serverTime: serverTime.toISOString()
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: error.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  try {
    const action = e.parameter.action;
    
    if (action === 'get_data') {
      if (e.parameter.password !== DASHBOARD_PASSWORD) {
        return ContentService.createTextOutput(JSON.stringify({ 
          status: 'error', 
          message: 'パスワードが間違っています。' 
        })).setMimeType(ContentService.MimeType.JSON);
      }

      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
      if (!sheet) throw new Error(`シートが見つかりません。`);
      
      const data = sheet.getDataRange().getValues();
      if (data.length <= 1) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'success', data: [] })).setMimeType(ContentService.MimeType.JSON);
      }
      
      const rows = data.slice(1);
      const targetMonth = e.parameter.month;
      
      const resultData = rows.map(row => ({
        serverTime: row[0] instanceof Date ? row[0].toISOString() : row[0],
        userId: row[1],
        userName: row[2],
        type: row[3],
        clientTime: row[4]
      })).filter(row => {
        if (!targetMonth) return true;
        const dateObj = new Date(row.serverTime);
        const yyyy = dateObj.getFullYear();
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        return `${yyyy}-${mm}` === targetMonth;
      });
      
      const output = ContentService.createTextOutput(JSON.stringify({ status: 'success', data: resultData }));
      output.setMimeType(ContentService.MimeType.JSON);
      return output;
    }
    
    return ContentService.createTextOutput("API is running.");
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

function monthlyAggregationAndNotify() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) return;
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;
  
  const rows = data.slice(1);
  
  const today = new Date();
  today.setMonth(today.getMonth() - 1);
  const targetYear = today.getFullYear();
  const targetMonth = today.getMonth() + 1;
  
  // 祝日データをAPIから取得
  let holidaysData = {};
  try {
    const res = UrlFetchApp.fetch('https://holidays-jp.github.io/api/v1/date.json');
    holidaysData = JSON.parse(res.getContentText());
  } catch (e) {
    Logger.log("祝日データの取得に失敗: " + e.message);
  }
  
  const userLogs = {};
  
  rows.forEach(row => {
    const dateObj = new Date(row[0]);
    if (dateObj.getFullYear() !== targetYear || (dateObj.getMonth() + 1) !== targetMonth) return;
    
    const userId = row[1];
    const userName = row[2];
    const type = row[3];
    const dayStr = String(dateObj.getDate()).padStart(2, '0');
    
    if (!userLogs[userId]) {
        userLogs[userId] = { name: userName, days: {} };
    }
    if (!userLogs[userId].days[dayStr]) {
        userLogs[userId].days[dayStr] = { date: dateObj, in: null, out: null };
    }
    
    const dayLog = userLogs[userId].days[dayStr];
    
    if (type === '出勤' && !dayLog.in) {
        dayLog.in = dateObj;
    } else if (type === '退勤') {
        dayLog.out = dateObj;
    }
  });
  
  let reportText = `お疲れ様です。\n${targetYear}年${targetMonth}月度の労働時間集計が完了しました。\n\n`;
  reportText += `【月次サマリー】\n`;
  
  let hasData = false;
  for (const userId in userLogs) {
    hasData = true;
    const user = userLogs[userId];
    
    const breakMinutes = (USER_SETTINGS && USER_SETTINGS[userId]) ? USER_SETTINGS[userId].breakMinutes : 0;
    
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
    
    const formatTime = (mins) => `${Math.floor(mins / 60)}時間 ${mins % 60}分`;
    reportText += `👤 ${user.name}: 出勤 ${workDays}日 / 実働 ${formatTime(totalNetMinutes)} / 残業 ${formatTime(totalOvertimeMinutes)}\n`;
  }

  if (!hasData) reportText += "※ 当月の打刻データはありませんでした。\n";
  
  reportText += `\n詳細はダッシュボードからご確認ください。`;

  if (ADMIN_EMAIL !== 'your-email@gmail.com') {
    try {
      MailApp.sendEmail({
        to: ADMIN_EMAIL,
        subject: `【自動集計】${targetYear}年${targetMonth}月度 労働時間レポート`,
        body: reportText
      });
      Logger.log("Gmailへ通知を送信しました。");
    } catch (e) {
      Logger.log('メール送信エラー: ' + e.message);
    }
  } else {
    Logger.log("通知先メールアドレスが未設定のため、以下のレポートを出力します:\n" + reportText);
  }
}
