/**
 * スマート打刻システム - GAS バックエンド (専用管理画面対応版)
 */

const LOG_SHEET_NAME = '打刻履歴';
const EMP_SHEET_NAME = '従業員';
const SETTING_SHEET_NAME = '設定';

// --- 初期化 (シートが無い場合に作成する) ---
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  if (!ss.getSheetByName(LOG_SHEET_NAME)) {
    const sheet = ss.insertSheet(LOG_SHEET_NAME);
    sheet.appendRow(['サーバー時刻', 'ユーザーID', '氏名', '打刻種類', 'クライアント時刻']);
  }
  
  if (!ss.getSheetByName(EMP_SHEET_NAME)) {
    const sheet = ss.insertSheet(EMP_SHEET_NAME);
    sheet.appendRow(['ユーザーID', '氏名', '休憩時間(分)']);
    sheet.appendRow(['user001', '山田 太郎', 120]);
    sheet.appendRow(['user002', '佐藤 花子', 60]);
  }
  
  if (!ss.getSheetByName(SETTING_SHEET_NAME)) {
    const sheet = ss.insertSheet(SETTING_SHEET_NAME);
    sheet.appendRow(['設定項目', '値']);
    sheet.appendRow(['ダッシュボードパスワード', 'admin']);
    sheet.appendRow(['管理者メールアドレス', 'your-email@gmail.com']);
  }
}

// --- 設定値の取得 ---
function getSettings() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SETTING_SHEET_NAME);
  if (!sheet) { setupSheets(); return { password: 'admin', email: 'your-email@gmail.com' }; }
  
  const data = sheet.getDataRange().getValues();
  let settings = { password: 'admin', email: 'your-email@gmail.com' };
  
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === 'ダッシュボードパスワード') settings.password = data[i][1];
    if (data[i][0] === '管理者メールアドレス') settings.email = data[i][1];
  }
  return settings;
}

// --- 従業員リストの取得 ---
function getEmployees() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMP_SHEET_NAME);
  if (!sheet) { setupSheets(); return {}; }
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return {};
  
  let employees = {};
  for (let i = 1; i < data.length; i++) {
    const id = data[i][0];
    const name = data[i][1];
    const breakMins = parseInt(data[i][2], 10) || 0;
    if (id) employees[String(id)] = { name: name, breakMinutes: breakMins };
  }
  return employees;
}

// --- 打刻と管理機能の受付 (POST) ---
function doPost(e) {
  try {
    let payload = JSON.parse(e.postData.contents);
    const action = payload.action || 'clock_in_out'; // デフォルトは打刻
    
    const settings = getSettings();

    // --- 設定保存アクション ---
    if (action === 'save_settings') {
      if (payload.adminPassword !== settings.password) throw new Error('認証エラー');
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SETTING_SHEET_NAME);
      const data = sheet.getDataRange().getValues();
      for (let i = 0; i < data.length; i++) {
        if (data[i][0] === 'ダッシュボードパスワード') sheet.getRange(i+1, 2).setValue(payload.settings.password);
        if (data[i][0] === '管理者メールアドレス') sheet.getRange(i+1, 2).setValue(payload.settings.email);
      }
      return createSuccessResponse('設定を保存しました。');
    }
    
    // --- 従業員追加/更新アクション ---
    if (action === 'save_user') {
      if (payload.adminPassword !== settings.password) throw new Error('認証エラー');
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMP_SHEET_NAME);
      const data = sheet.getDataRange().getValues();
      let found = false;
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(payload.user.id)) {
          sheet.getRange(i+1, 2).setValue(payload.user.name);
          sheet.getRange(i+1, 3).setValue(payload.user.breakMinutes);
          found = true;
          break;
        }
      }
      if (!found) sheet.appendRow([payload.user.id, payload.user.name, payload.user.breakMinutes]);
      return createSuccessResponse('従業員を保存しました。');
    }
    
    // --- 従業員削除アクション ---
    if (action === 'delete_user') {
      if (payload.adminPassword !== settings.password) throw new Error('認証エラー');
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMP_SHEET_NAME);
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(payload.userId)) {
          sheet.deleteRow(i+1);
          return createSuccessResponse('従業員を削除しました。');
        }
      }
      throw new Error('ユーザーが見つかりません。');
    }

    // --- 打刻アクション (通常) ---
    if (action === 'clock_in_out') {
      const { userId, userName, type, timestamp } = payload;
      const serverTime = new Date();
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_SHEET_NAME);
      if (!sheet) { setupSheets(); throw new Error(`シート「${LOG_SHEET_NAME}」が見つかりません。`); }
      const typeText = type === 'in' ? '出勤' : (type === 'out' ? '退勤' : type);
      sheet.appendRow([serverTime, userId, userName, typeText, timestamp]);
      return createSuccessResponse('打刻が正常に記録されました。');
    }

  } catch (error) {
    return createErrorResponse(error.message);
  }
}

// --- データ取得 (GET) ---
function doGet(e) {
  try {
    const action = e.parameter.action;
    
    if (action === 'get_users') {
      const users = getEmployees();
      return createSuccessResponse(null, users);
    }
    
    if (action === 'get_settings') {
      const settings = getSettings();
      if (e.parameter.password !== settings.password) throw new Error('認証エラー');
      return createSuccessResponse(null, settings);
    }
    
    if (action === 'get_data') {
      const settings = getSettings();
      if (e.parameter.password !== settings.password) throw new Error('パスワードが間違っています。');

      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_SHEET_NAME);
      if (!sheet) { setupSheets(); return createSuccessResponse(null, []); }
      
      const data = sheet.getDataRange().getValues();
      if (data.length <= 1) return createSuccessResponse(null, []);
      
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
      
      return createSuccessResponse(null, resultData);
    }
    
    return ContentService.createTextOutput("API is running.");
    
  } catch (error) {
    return createErrorResponse(error.message);
  }
}

function createSuccessResponse(message, data) {
  const obj = { status: 'success' };
  if (message) obj.message = message;
  if (data) obj.data = data;
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function createErrorResponse(message) {
  return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: message })).setMimeType(ContentService.MimeType.JSON);
}

// --- 月次集計とメール送信 ---
function monthlyAggregationAndNotify() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_SHEET_NAME);
  if (!sheet) return;
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;
  
  const rows = data.slice(1);
  const settings = getSettings();
  const employees = getEmployees();
  
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
    
    const breakMinutes = employees[userId] ? employees[userId].breakMinutes : 0;
    
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
      
      let todayBreak = (dayOfWeek === 6) ? 0 : breakMinutes; // 土曜は休憩なし
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

  if (settings.email && settings.email !== 'your-email@gmail.com') {
    try {
      MailApp.sendEmail({
        to: settings.email,
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
