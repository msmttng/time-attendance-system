/**
 * スマート打刻システム - GAS バックエンド (従業員個別詳細勤務表・契約個人設定・承認管理対応版)
 */

const LOG_SHEET_NAME = '打刻履歴';
const EMP_SHEET_NAME = '従業員';
const DAILY_SHEET_NAME = '日別勤務データ';
const SETTING_SHEET_NAME = '設定';

function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. 打刻履歴シートの初期化
  if (!ss.getSheetByName(LOG_SHEET_NAME)) {
    const sheet = ss.insertSheet(LOG_SHEET_NAME);
    sheet.appendRow(['サーバー時刻', 'ユーザーID', '氏名', '打刻種類', 'クライアント時刻']);
  }
  
  // 2. 従業員シートの初期化およびカラム拡張
  let empSheet = ss.getSheetByName(EMP_SHEET_NAME);
  const empHeaders = ['ユーザーID', '氏名', '休憩時間(分)', 'メールアドレス', '基本出勤時間', '基本退勤時間', '所定労働時間', '給与', '勤務タイプ', 'アバターURL'];
  if (!empSheet) {
    empSheet = ss.insertSheet(EMP_SHEET_NAME);
    empSheet.appendRow(empHeaders);
    empSheet.appendRow(['user001', '月村 佳世', 120, 'masamitting@gmail.com', '13:00', '19:00', 120, 200000, '勤務タイプ①', '']);
    empSheet.appendRow(['user002', '佐藤 花子', 60, 'sato@gmail.com', '09:00', '18:00', 160, 250000, '勤務タイプ①', '']);
  } else {
    // 既存シートのヘッダーを上書き拡張（データは保持）
    const range = empSheet.getRange(1, 1, 1, empHeaders.length);
    range.setValues([empHeaders]);
  }
  
  // 3. 日別勤務データシートの新設
  if (!ss.getSheetByName(DAILY_SHEET_NAME)) {
    const sheet = ss.insertSheet(DAILY_SHEET_NAME);
    sheet.appendRow(['日付', 'ユーザーID', '区分', '承認ステータス', '日報内容']);
  }
  
  // 4. 設定シートの初期化
  if (!ss.getSheetByName(SETTING_SHEET_NAME)) {
    const sheet = ss.insertSheet(SETTING_SHEET_NAME);
    sheet.appendRow(['設定項目', '値']);
    sheet.appendRow(['ダッシュボードパスワード', 'admin']);
    sheet.appendRow(['管理者メールアドレス', 'your-email@gmail.com']);
  }
}

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

function getEmployees() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMP_SHEET_NAME);
  if (!sheet) { setupSheets(); return {}; }
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return {};
  let employees = {};
  for (let i = 1; i < data.length; i++) {
    const id = data[i][0];
    if (id) {
      employees[String(id)] = {
        name: data[i][1] || '',
        breakMinutes: parseInt(data[i][2], 10) || 0,
        email: data[i][3] || '',
        startTime: data[i][4] instanceof Date ? Utilities.formatDate(data[i][4], Session.getScriptTimeZone(), 'HH:mm') : (data[i][4] || ''),
        endTime: data[i][5] instanceof Date ? Utilities.formatDate(data[i][5], Session.getScriptTimeZone(), 'HH:mm') : (data[i][5] || ''),
        standardHours: parseInt(data[i][6], 10) || 0,
        salary: parseInt(data[i][7], 10) || 0,
        workType: data[i][8] || '',
        avatarUrl: data[i][9] || ''
      };
    }
  }
  return employees;
}

function getPublicEmployees() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('users_v1');
  if (cached) return JSON.parse(cached);
  
  const employees = getEmployees();
  const publicEmployees = {};
  for (const id in employees) {
    publicEmployees[id] = { name: employees[id].name };
  }
  
  cache.put('users_v1', JSON.stringify(publicEmployees), 21600);
  return publicEmployees;
}

function getTodayPunchStatus(userId) {
  const cache = CacheService.getScriptCache();
  const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const cacheKey = `punch_${todayStr}_${userId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_SHEET_NAME);
  if (!sheet) return 'none';
  
  const data = sheet.getDataRange().getValues();
  let punchStatus = 'none';
  let hasIn = false;
  let hasOut = false;
  
  for (let i = data.length - 1; i >= 1; i--) {
    const rowDate = data[i][0];
    if (!rowDate) continue;
    
    const rowDateStr = rowDate instanceof Date ? Utilities.formatDate(rowDate, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(rowDate).substring(0, 10);
    if (rowDateStr < todayStr) break;
    
    if (rowDateStr === todayStr && String(data[i][1]) === String(userId)) {
      const type = data[i][3];
      if (type === '出勤') hasIn = true;
      if (type === '退勤') hasOut = true;
    }
  }
  
  if (hasIn && !hasOut) punchStatus = 'in';
  else if (hasIn && hasOut) punchStatus = 'out';
  
  cache.put(cacheKey, punchStatus, 64800);
  return punchStatus;
}

function invalidatePunchCache(userId) {
  const cache = CacheService.getScriptCache();
  const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  cache.remove(`punch_${todayStr}_${userId}`);
}

function doPost(e) {
  try {
    let payload = JSON.parse(e.postData.contents);
    const action = payload.action || 'clock_in_out';
    const settings = getSettings();

    // 管理者認証が必要なアクション
    if (['save_settings', 'save_user', 'delete_user', 'update_log', 'delete_log', 'add_log', 'update_daily_status', 'get_settings', 'get_data'].includes(action)) {
      if (payload.adminPassword !== settings.password) throw new Error('認証エラー');
    }

    if (action === 'get_settings') {
      return createSuccessResponse(null, settings);
    }

    if (action === 'get_data') {
      const logSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_SHEET_NAME);
      const dailySheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DAILY_SHEET_NAME);
      const targetMonth = payload.month;
      
      // 1. 打刻履歴の取得
      let logs = [];
      if (logSheet) {
        const data = logSheet.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          if (!row[0]) continue;
          const serverTimeStr = row[0] instanceof Date ? row[0].toISOString() : row[0];
          
          if (targetMonth) {
            const dateObj = new Date(serverTimeStr);
            const yyyy = dateObj.getFullYear();
            const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
            if (`${yyyy}-${mm}` !== targetMonth) continue;
          }
          
          logs.push({
            rowNumber: i + 1,
            serverTime: serverTimeStr,
            userId: row[1],
            userName: row[2],
            type: row[3],
            clientTime: row[4]
          });
        }
      }
      
      // 2. 日別勤務データの取得
      let dailyData = [];
      if (dailySheet) {
        const data = dailySheet.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          const dateObj = row[0] instanceof Date ? row[0] : new Date(row[0]);
          const dateStr = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), 'yyyy-MM-dd');
          
          if (targetMonth) {
            if (!dateStr.startsWith(targetMonth)) continue;
          }
          
          dailyData.push({
            date: dateStr,
            userId: String(row[1]),
            type: row[2] || '',
            status: row[3] || '',
            report: row[4] || ''
          });
        }
      }
      
      return createSuccessResponse(null, { logs: logs, dailyData: dailyData });
    }

    if (action === 'save_settings') {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SETTING_SHEET_NAME);
      const data = sheet.getDataRange().getValues();
      for (let i = 0; i < data.length; i++) {
        if (data[i][0] === 'ダッシュボードパスワード') sheet.getRange(i+1, 2).setValue(payload.settings.password);
        if (data[i][0] === '管理者メールアドレス') sheet.getRange(i+1, 2).setValue(payload.settings.email);
      }
      return createSuccessResponse('設定を保存しました。');
    }
    
    // 従業員の保存・更新 (下位互換性を保ちながら拡張パラメータに対応)
    if (action === 'save_user') {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMP_SHEET_NAME);
      setupSheets(); // 拡張列が未作成の場合はここで自動作成
      const data = sheet.getDataRange().getValues();
      let found = false;
      const user = payload.user; // id, name, breakMinutes, email, startTime, endTime, standardHours, salary, workType, avatarUrl
      
      const newRow = [
        user.id,
        user.name,
        parseInt(user.breakMinutes, 10) || 0,
        user.email || '',
        user.startTime || '',
        user.endTime || '',
        parseInt(user.standardHours, 10) || 0,
        parseInt(user.salary, 10) || 0,
        user.workType || '',
        user.avatarUrl || ''
      ];

      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(user.id)) {
          const oldRow = data[i];
          const mergedRow = [
            user.id,
            user.name !== undefined ? user.name : oldRow[1],
            user.breakMinutes !== undefined ? parseInt(user.breakMinutes, 10) : oldRow[2],
            user.email !== undefined ? user.email : (oldRow[3] || ''),
            user.startTime !== undefined ? user.startTime : (oldRow[4] || ''),
            user.endTime !== undefined ? user.endTime : (oldRow[5] || ''),
            user.standardHours !== undefined ? parseInt(user.standardHours, 10) : (oldRow[6] || 0),
            user.salary !== undefined ? parseInt(user.salary, 10) : (oldRow[7] || 0),
            user.workType !== undefined ? user.workType : (oldRow[8] || ''),
            user.avatarUrl !== undefined ? user.avatarUrl : (oldRow[9] || '')
          ];
          sheet.getRange(i+1, 1, 1, mergedRow.length).setValues([mergedRow]);
          found = true;
          break;
        }
      }
      if (!found) sheet.appendRow(newRow);
      CacheService.getScriptCache().remove('users_v1');
      return createSuccessResponse('従業員情報を保存しました。');
    }
    
    if (action === 'delete_user') {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMP_SHEET_NAME);
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(payload.userId)) {
          sheet.deleteRow(i+1);
          CacheService.getScriptCache().remove('users_v1');
          return createSuccessResponse('従業員を削除しました。');
        }
      }
      throw new Error('ユーザーが見つかりません。');
    }

    // --- 打刻履歴の更新 ---
    if (action === 'update_log') {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_SHEET_NAME);
      if (!sheet) throw new Error('打刻履歴シートが見つかりません');
      const row = payload.rowNumber;
      const userId = sheet.getRange(row, 2).getValue();
      if (payload.newServerTime) {
        sheet.getRange(row, 1).setValue(new Date(payload.newServerTime));
      }
      if (payload.newType) {
        sheet.getRange(row, 4).setValue(payload.newType);
      }
      invalidatePunchCache(userId);
      return createSuccessResponse('打刻データを更新しました。');
    }

    // --- 打刻履歴の削除 ---
    if (action === 'delete_log') {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_SHEET_NAME);
      if (!sheet) throw new Error('打刻履歴シートが見つかりません');
      const userId = sheet.getRange(payload.rowNumber, 2).getValue();
      sheet.deleteRow(payload.rowNumber);
      invalidatePunchCache(userId);
      return createSuccessResponse('打刻データを削除しました。');
    }

    // --- 打刻の手動追加 ---
    if (action === 'add_log') {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_SHEET_NAME);
      if (!sheet) throw new Error('打刻履歴シートが見つかりません');
      const serverTime = new Date(payload.serverTime);
      sheet.appendRow([serverTime, payload.userId, payload.userName, payload.type, payload.clientTime || '手動追加']);
      
      const lastRow = sheet.getLastRow();
      if (lastRow > 2) {
        sheet.getRange(2, 1, lastRow - 1, 5).sort({column: 1, ascending: true});
      }
      invalidatePunchCache(payload.userId);
      return createSuccessResponse('打刻データを追加しました。');
    }

    // --- 日別勤務データの保存（有給/欠勤などの区分、承認/差戻し状態、日報メモ） ---
    if (action === 'update_daily_status') {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DAILY_SHEET_NAME);
      if (!sheet) throw new Error('日別勤務データシートが見つかりません');
      const data = sheet.getDataRange().getValues();
      const { date, userId, type, status, report } = payload; // date: YYYY-MM-DD
      let found = false;
      
      for (let i = 1; i < data.length; i++) {
        const rowDateStr = data[i][0] instanceof Date ? Utilities.formatDate(data[i][0], Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(data[i][0]);
        if (rowDateStr === date && String(data[i][1]) === String(userId)) {
          if (type !== undefined) sheet.getRange(i+1, 3).setValue(type);
          if (status !== undefined) sheet.getRange(i+1, 4).setValue(status);
          if (report !== undefined) sheet.getRange(i+1, 5).setValue(report);
          found = true;
          break;
        }
      }
      if (!found) {
        sheet.appendRow([new Date(date), userId, type || '', status || '', report || '']);
      }
      // --- 出勤・退勤時刻の修正処理 ---
      if (payload.inTime !== undefined || payload.outTime !== undefined) {
        const logSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_SHEET_NAME);
        if (logSheet) {
          const logData = logSheet.getDataRange().getValues();
          let inRowIndex = -1;
          let outRowIndex = -1;
          
          for (let j = 1; j < logData.length; j++) {
            const logDateStr = logData[j][0] instanceof Date ? Utilities.formatDate(logData[j][0], Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(logData[j][0]).substring(0,10);
            if (logDateStr === date && String(logData[j][1]) === String(userId)) {
              if (logData[j][3] === '出勤') inRowIndex = j + 1;
              if (logData[j][3] === '退勤') outRowIndex = j + 1;
            }
          }
          
          let rowsToDelete = [];
          
          if (payload.inTime !== undefined) {
            if (payload.inTime === '') {
              if (inRowIndex !== -1) rowsToDelete.push(inRowIndex);
            } else {
              const newInDate = new Date(`${date}T${payload.inTime}:00+09:00`);
              if (inRowIndex !== -1) {
                logSheet.getRange(inRowIndex, 1).setValue(newInDate);
              } else {
                logSheet.appendRow([newInDate, userId, payload.userName || '', '出勤', '管理者修正']);
              }
            }
          }
          
          if (payload.outTime !== undefined) {
            if (payload.outTime === '') {
              if (outRowIndex !== -1) rowsToDelete.push(outRowIndex);
            } else {
              const newOutDate = new Date(`${date}T${payload.outTime}:00+09:00`);
              if (outRowIndex !== -1) {
                logSheet.getRange(outRowIndex, 1).setValue(newOutDate);
              } else {
                logSheet.appendRow([newOutDate, userId, payload.userName || '', '退勤', '管理者修正']);
              }
            }
          }
          
          rowsToDelete.sort((a,b) => b - a).forEach(r => logSheet.deleteRow(r));
          invalidatePunchCache(userId);
        }
      }

      return createSuccessResponse('日別勤務データを更新しました。');
    }

    // --- 通常の打刻 ---
    if (action === 'clock_in_out') {
      const { userId, userName, type, timestamp } = payload;
      
      const publicUsers = getPublicEmployees();
      if (!publicUsers[userId]) throw new Error('未登録のユーザーです。');
      
      const lock = LockService.getScriptLock();
      try {
        lock.waitLock(10000);
        
        const currentStatus = getTodayPunchStatus(userId);
        if (type === 'in' && currentStatus === 'in') throw new Error('本日は既に出勤済みです');
        if (type === 'out' && currentStatus === 'none') throw new Error('本日の出勤打刻がありません');
        if (type === 'out' && currentStatus === 'out') throw new Error('本日は既に退勤済みです');
        
        const serverTime = new Date();
        const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_SHEET_NAME);
        if (!sheet) { setupSheets(); throw new Error(`シート「${LOG_SHEET_NAME}」が見つかりません。`); }
        
        const typeText = type === 'in' ? '出勤' : '退勤';
        sheet.appendRow([serverTime, userId, userName, typeText, timestamp]);
        
        const newStatus = type === 'in' ? 'in' : 'out';
        const todayStr = Utilities.formatDate(serverTime, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        CacheService.getScriptCache().put(`punch_${todayStr}_${userId}`, newStatus, 64800);
        
        return createSuccessResponse('打刻が正常に記録されました。');
      } finally {
        lock.releaseLock();
      }
    }

    return createErrorResponse('不明なアクションです');

  } catch (error) {
    return createErrorResponse(error.message);
  }
}

function doGet(e) {
  try {
    const action = e.parameter.action;
    
    if (action === 'get_users') {
      const publicUsers = getPublicEmployees();
      const responseData = {};
      for (const id in publicUsers) {
        responseData[id] = {
          name: publicUsers[id].name,
          todayStatus: getTodayPunchStatus(id)
        };
      }
      return createSuccessResponse(null, responseData);
    }
    
    if (action === 'get_punch_status') {
      const userId = e.parameter.userId;
      const status = getTodayPunchStatus(userId);
      return createSuccessResponse(null, { status: status });
    }
    
    if (action === 'get_settings') {
      const settings = getSettings();
      if (e.parameter.password !== settings.password) throw new Error('認証エラー');
      return createSuccessResponse(null, settings);
    }
    
    if (action === 'get_data') {
      const settings = getSettings();
      if (e.parameter.password !== settings.password) throw new Error('パスワードが間違っています。');
      
      const logSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_SHEET_NAME);
      const dailySheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DAILY_SHEET_NAME);
      
      const targetMonth = e.parameter.month;
      
      // 1. 打刻履歴の取得
      let logs = [];
      if (logSheet) {
        const data = logSheet.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          if (!row[0]) continue;
          const serverTimeStr = row[0] instanceof Date ? row[0].toISOString() : row[0];
          
          if (targetMonth) {
            const dateObj = new Date(serverTimeStr);
            const yyyy = dateObj.getFullYear();
            const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
            if (`${yyyy}-${mm}` !== targetMonth) continue;
          }
          
          logs.push({
            rowNumber: i + 1,
            serverTime: serverTimeStr,
            userId: row[1],
            userName: row[2],
            type: row[3],
            clientTime: row[4]
          });
        }
      }
      
      // 2. 日別勤務データの取得
      let dailyData = [];
      if (dailySheet) {
        const data = dailySheet.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          const dateObj = row[0] instanceof Date ? row[0] : new Date(row[0]);
          const dateStr = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), 'yyyy-MM-dd');
          
          if (targetMonth) {
            if (!dateStr.startsWith(targetMonth)) continue;
          }
          
          dailyData.push({
            date: dateStr,
            userId: String(row[1]),
            type: row[2] || '',
            status: row[3] || '',
            report: row[4] || ''
          });
        }
      }
      
      return createSuccessResponse(null, { logs: logs, dailyData: dailyData });
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

function monthlyAggregationAndNotify() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_SHEET_NAME);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  
  const rows = data.length > 1 ? data.slice(1) : [];
  const settings = getSettings();
  const employees = getEmployees();
  
  const today = new Date();
  today.setMonth(today.getMonth() - 1);
  const targetYear = today.getFullYear();
  const targetMonth = today.getMonth() + 1;
  
  let holidaysData = {};
  try {
    const res = UrlFetchApp.fetch('https://holidays-jp.github.io/api/v1/date.json');
    holidaysData = JSON.parse(res.getContentText());
  } catch (e) {}

  // 日別勤務データ（有給・特別休暇など）の取得
  const dailySheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DAILY_SHEET_NAME);
  let dailyData = {};
  if (dailySheet) {
    const dData = dailySheet.getDataRange().getValues();
    for (let i = 1; i < dData.length; i++) {
      const rowDate = dData[i][0];
      const dateStr = rowDate instanceof Date ? Utilities.formatDate(rowDate, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(rowDate).substring(0, 10);
      const rowUserId = String(dData[i][1]);
      const type = dData[i][2] || '';
      const key = `${rowUserId}_${dateStr}`;
      dailyData[key] = type;
    }
  }
  
  // 従業員ごとに初期化
  const userLogs = {};
  for (const empId in employees) {
    userLogs[empId] = { name: employees[empId].name, days: {} };
  }
  
  rows.forEach(row => {
    if (!row[0]) return;
    const dateObj = new Date(row[0]);
    if (dateObj.getFullYear() !== targetYear || (dateObj.getMonth() + 1) !== targetMonth) return;
    const userId = String(row[1]), userName = row[2], type = row[3];
    const dayStr = String(dateObj.getDate()).padStart(2, '0');
    
    if (!userLogs[userId]) userLogs[userId] = { name: userName, days: {} };
    if (!userLogs[userId].days[dayStr]) userLogs[userId].days[dayStr] = { date: dateObj, in: null, out: null };
    const dayLog = userLogs[userId].days[dayStr];
    if (type === '出勤' && !dayLog.in) dayLog.in = dateObj;
    else if (type === '退勤') dayLog.out = dateObj;
  });
  
  let reportText = `お疲れ様です。\n${targetYear}年${targetMonth}月度の労働時間集計が完了しました。\n\n【月次サマリー】\n`;
  let hasData = false;
  
  for (const userId in userLogs) {
    hasData = true;
    const user = userLogs[userId];
    const breakMinutes = employees[userId] ? employees[userId].breakMinutes : 0;
    let totalNetMinutes = 0, totalOvertimeMinutes = 0, workDays = 0;
    
    const lastDay = new Date(targetYear, targetMonth, 0).getDate();
    for (let d = 1; d <= lastDay; d++) {
      const dayStr = String(d).padStart(2, '0');
      const dateObj = new Date(targetYear, targetMonth - 1, d);
      const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${dayStr}`;
      const dayOfWeek = dateObj.getDay();
      
      const log = user.days[dayStr] || { date: dateObj, in: null, out: null };
      const typeVal = dailyData[`${userId}_${dateStr}`] || '';
      const isHoliday = !!holidaysData[dateStr] || dayOfWeek === 0;
      
      const empSetting = employees[userId] || {};
      const empStart = empSetting.startTime || '09:00';
      let empEnd = empSetting.endTime || '18:00';
      if (dayOfWeek === 6 && !empSetting.endTime) {
        empEnd = '13:30';
      }
      const [startH, startM] = empStart.split(':').map(Number);
      const [endH, endM] = empEnd.split(':').map(Number);
      const standardStart = startH * 60 + startM;
      const standardEnd = endH * 60 + endM;
      
      if (log.in && log.out) {
        workDays++;
        const inMins = log.in.getHours() * 60 + log.in.getMinutes();
        const outMins = log.out.getHours() * 60 + log.out.getMinutes();
        let grossMins = outMins - inMins;
        if (grossMins < 0) grossMins = 0;
        let todayBreak = (dayOfWeek === 6) ? 0 : breakMinutes;
        let netMins = grossMins - todayBreak;
        if (netMins < 0) netMins = 0;
        totalNetMinutes += netMins;
        
        let dailyOvertime = 0;
        for (let m = inMins; m < outMins; m++) {
            if (isHoliday || m < standardStart || m >= standardEnd) dailyOvertime++;
        }
        totalOvertimeMinutes += dailyOvertime;
      } else if (typeVal === '有給' || typeVal === '特別休暇' || typeVal === '半給') {
        let factor = 1.0;
        if (typeVal === '半給') factor = 0.5;
        
        const todayBreak = (dayOfWeek === 6) ? 0 : breakMinutes;
        const standardDailyMinutes = standardEnd - standardStart - todayBreak;
        let netMins = Math.round(standardDailyMinutes * factor);
        if (netMins < 0) netMins = 0;
        totalNetMinutes += netMins;
      }
    }
    const formatTime = (mins) => `${Math.floor(mins / 60)}時間 ${mins % 60}分`;
    reportText += `👤 ${user.name}: 出勤 ${workDays}日 / 実働 ${formatTime(totalNetMinutes)} / 残業 ${formatTime(totalOvertimeMinutes)}\n`;
  }

  if (!hasData) reportText += "※ 当月の打刻データはありませんでした。\n";
  reportText += `\n詳細はダッシュボードからご確認ください。`;

  if (settings.email && settings.email !== 'your-email@gmail.com') {
    try {
      MailApp.sendEmail({ to: settings.email, subject: `【自動集計】${targetYear}年${targetMonth}月度 労働時間レポート`, body: reportText });
    } catch (e) {}
  }
}
