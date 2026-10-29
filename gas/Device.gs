/**
 * スマート打刻システム - 出退勤スイッチ（ESP32 端末）連携  v1.5.0
 *
 * 物理スイッチ端末（ATOM Lite＋トグルスイッチ2個）からの打刻を、
 * 既存の「打刻履歴」シートに Web 画面の打刻と同じ形式で書き込みます。
 * 管理ダッシュボード・月次集計はそのまま使えます。
 *
 * 導入（くわしくは手順書）:
 *   1. このファイルを gas フォルダ（Apps Script エディタ）に「Device.gs」として追加
 *   2. Code.gs の doGet の先頭に 1 行追加（手順書を参照）
 *   3. 関数 setupDevice を 1 回実行 → 実行ログに「端末用 TOKEN」と従業員の一覧が出る
 *   4. 設定シートの「スイッチ左ユーザーID」「スイッチ右ユーザーID」に従業員IDを入れる
 *   5. デプロイを管理 → 既存のデプロイを編集 → 新しいバージョン（URL は変わりません）
 *
 * 端末からの呼び出し（端末のプログラムは変更不要。GAS_URL と TOKEN を書き換えるだけ）:
 *   GET <URL>?token=...&ping=1
 *   GET <URL>?token=...&slot=a|b&action=in|out&id=<イベントID>&age=<押してからの秒数>
 *   v1.4.0〜 端末は次も付けて送る（無くても動く）:
 *     &wifi=<つながっているWi-Fi名>&place=<自宅|薬局>&rssi=<電波dBm>&ip=<端末のアドレス>&fw=<ファームウェア>&pend=<未送信の件数>
 *   → 「端末状態」シートの2行目に、最後に通信した時刻と一緒に上書きで記録する（1行だけ。増えない）
 *   v1.5.0〜（ファームウェア v1.8.0 以降。無くても動く）:
 *     &ts=<押した時刻（UNIX秒）>  … 端末がネットの時計で覚えた正確な時刻。あれば age より優先
 *     GET <URL>?token=...&slot=a|b&action=cancel&cid=<取り消すイベントID>&id=<このイベントID>
 *       … レバーを10秒以内に戻したとき、直前の記録（端末が送ったもの）を1件取り消す
 *   返り値に today_a / today_b（今日の出勤・退勤の時刻）を追加
 *   見守り：関数 devWatchdog を10分ごとに実行（setupDeviceTriggers で登録）。営業時間中に端末から
 *     30分以上連絡がないと、設定シートの「管理者メールアドレス」へメール。連絡が戻ったらもう一度メール
 *   月次集計：setupDeviceTriggers で、既存の monthlyAggregationAndNotify を毎月1日 8時に実行するよう登録
 * 返り値(JSON): {code:"ok"|"warn"|"error", msg, action, st_a, st_b, retry?}
 *   st_a / st_b … "on"（出勤中）/ "off"（出勤中でない）/ "stale"（出勤のまま16時間以上）
 *
 * ※ このファイルは UTF-8 で保存してください（Apps Script エディタに直接貼るか、clasp push で反映）。
 */

const DEV_PROP_TOKEN = 'DEVICE_TOKEN';
const DEV_KEY_LEFT = 'スイッチ左ユーザーID';
const DEV_KEY_RIGHT = 'スイッチ右ユーザーID';
const DEV_CLIENT_LABEL = '出退勤スイッチ';
const DEV_STALE_HOURS = 16;     // これ以上前の「出勤のみ」は退勤の押し忘れとみなす
const DEV_SCAN_ROWS = 600;      // 打刻履歴を下から何行さかのぼって探すか
const DEV_MAX_AGE_SEC = 48 * 3600;
const DEV_STATUS_SHEET = '端末状態';
const DEV_STATUS_HEAD = ['最終通信時刻', '種類', 'つながっているWi-Fi', '場所', '電波(dBm)', '端末のアドレス', 'ファームウェア', '未送信の記録'];
const DEV_TS_PAST_SEC = 48 * 3600;   // 端末の時刻（ts）を信じる範囲：過去48時間〜
const DEV_TS_FUTURE_SEC = 300;       //                             未来5分まで
const DEV_WD_GAP_MIN = 30;           // 営業時間中にこれ以上連絡がなければ知らせる
const DEV_WD_PROP = 'DEV_WD_ALERT';  // 知らせ済みの印（スクリプトプロパティ）

/* ======================= 初期設定（エディタから1回実行） ======================= */
function setupDevice() {
  setupSheets();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const conf = ss.getSheetByName(SETTING_SHEET_NAME);
  const keys = conf.getRange(1, 1, Math.max(1, conf.getLastRow()), 1).getValues().map(r => String(r[0]));
  if (keys.indexOf(DEV_KEY_LEFT) < 0) conf.appendRow([DEV_KEY_LEFT, '']);
  if (keys.indexOf(DEV_KEY_RIGHT) < 0) conf.appendRow([DEV_KEY_RIGHT, '']);

  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty(DEV_PROP_TOKEN);
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '');
    props.setProperty(DEV_PROP_TOKEN, token);
  }
  Logger.log('端末用 TOKEN = ' + token);
  const emps = getEmployees();
  Logger.log('従業員の一覧（設定シートの「' + DEV_KEY_LEFT + '」「' + DEV_KEY_RIGHT + '」に ID を入れてください）:');
  Object.keys(emps).forEach(id => Logger.log('  ' + id + ' : ' + emps[id].name));
}

/** 端末用 TOKEN を作り直す（漏れたときなど）。端末側の TOKEN も書き換えが必要 */
function resetDeviceToken() {
  const token = Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty(DEV_PROP_TOKEN, token);
  Logger.log('新しい端末用 TOKEN = ' + token);
}

/* ======================= 受付（Code.gs の doGet から呼ばれる） ======================= */
function handleDeviceRequest_(e) {
  const p = (e && e.parameter) || {};
  const token = PropertiesService.getScriptProperties().getProperty(DEV_PROP_TOKEN);
  if (!token || p.token !== token) return devJson_({ code: 'error', msg: 'トークンが違います' });

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    devSaveStatus_(ss, p);
    const map = devSlotMap_(ss);

    if (p.ping) {
      const now0 = new Date();
      const st = devStateOf_(ss, map, now0);
      const td = devTodayOf_(ss, map, now0);
      return devJson_({ code: 'ok', msg: 'pong', st_a: st.a, st_b: st.b, today_a: td.a, today_b: td.b });
    }

    const slot = String(p.slot || '');
    const action = String(p.action || '');
    if (['a', 'b'].indexOf(slot) < 0 || ['in', 'out', 'cancel'].indexOf(action) < 0) {
      return devJson_({ code: 'error', msg: 'パラメータが不正です' });
    }
    const userId = map[slot];
    if (!userId) {
      return devJson_({ code: 'error', msg: '設定シートの「' + (slot === 'a' ? DEV_KEY_LEFT : DEV_KEY_RIGHT) + '」が空です' });
    }
    const id = String(p.id || '').slice(0, 40);

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) return devJson_({ code: 'error', msg: '混み合っています', retry: true });
    try {
      // 同じイベントの再送なら前回の結果を返す（二重記録防止）
      const cache = CacheService.getScriptCache();
      if (id) {
        const prev = cache.get('dev_ev_' + id);
        if (prev) {
          const r = JSON.parse(prev);
          const now1 = new Date();
          const st = devStateOf_(ss, map, now1);
          const td = devTodayOf_(ss, map, now1);
          r.st_a = st.a; r.st_b = st.b; r.today_a = td.a; r.today_b = td.b;
          return devJson_(r);
        }
      }

      // 打刻時刻：端末の正確な時刻（ts）があればそれ、なければ 受信時刻 − age（通信が切れていた分をさかのぼる）
      const now = new Date();
      let age = Number(p.age || 0);
      if (!(age >= 0) || age > DEV_MAX_AGE_SEC) age = 0;
      let when = new Date(now.getTime() - age * 1000);
      const ts = Number(p.ts || 0);
      if (ts > 0) {
        const diff = now.getTime() / 1000 - ts;
        if (diff >= -DEV_TS_FUTURE_SEC && diff <= DEV_TS_PAST_SEC) {
          when = new Date(Math.min(ts * 1000, now.getTime()));
          age = Math.max(0, Math.round((now.getTime() - when.getTime()) / 1000));
        }
      }

      const employees = getPublicEmployees();
      const name = employees[userId] ? employees[userId].name : '';
      if (!name) return devJson_({ code: 'error', msg: '従業員ID「' + userId + '」が従業員シートにありません' });

      const sheet = ss.getSheetByName(LOG_SHEET_NAME);
      if (!sheet) throw new Error('打刻履歴シートが見つかりません');
      let res;
      if (action === 'cancel') {
        res = devCancel_(sheet, userId, name, String(p.cid || '').slice(0, 40));
      } else {
        res = action === 'in' ? devPunchIn_(sheet, userId, name, when, age)
                              : devPunchOut_(sheet, userId, name, when, age);
        // 取り消しに備えて、追加した行の中身をイベントIDで覚えておく（6時間）
        if (id && res.added) cache.put('dev_row_' + id, JSON.stringify(res.added), 21600);
        delete res.added;
      }
      res.action = action;
      const st = devStateOf_(ss, map, now);
      const td = devTodayOf_(ss, map, now);
      res.st_a = st.a; res.st_b = st.b; res.today_a = td.a; res.today_b = td.b;
      if (id) cache.put('dev_ev_' + id, JSON.stringify(res), 21600);
      return devJson_(res);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return devJson_({ code: 'error', msg: 'サーバーエラー: ' + err.message, retry: true });
  }
}

/* ======================= 端末の状態（つながっているWi-Fiなど） ======================= */
/** 端末から届いた状態を「端末状態」シートの2行目に上書きする。失敗しても打刻は止めない */
function devSaveStatus_(ss, p) {
  try {
    if (!p.fw && !p.wifi) return;   // 古いファームウェア（状態を送らない）
    let sh = ss.getSheetByName(DEV_STATUS_SHEET);
    if (!sh) {
      sh = ss.insertSheet(DEV_STATUS_SHEET);
      sh.getRange(1, 1, 1, DEV_STATUS_HEAD.length).setValues([DEV_STATUS_HEAD]);
      sh.setFrozenRows(1);
    }
    const kind = p.ping ? '接続確認' : ((p.slot === 'a' ? '左' : '右') + (p.action === 'in' ? ' 出勤' : (p.action === 'cancel' ? ' 取り消し' : ' 退勤')));
    const rssi = Number(p.rssi);
    const pend = Number(p.pend);
    sh.getRange(2, 1, 1, DEV_STATUS_HEAD.length).setValues([[
      new Date(), kind, devSafe_(p.wifi, 64), devSafe_(p.place, 16), isFinite(rssi) ? rssi : '',
      devSafe_(p.ip, 40), devSafe_(p.fw, 20), isFinite(pend) ? pend : ''
    ]]);
  } catch (err) {
    // 状態の記録だけ失敗した場合は何もしない
  }
}
/** シートに書く文字列：長さを切り、数式として解釈される先頭文字を無害化する */
function devSafe_(v, max) {
  let s = String(v == null ? '' : v).slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

/* ======================= 出勤・退勤 ======================= */
function devPunchIn_(sheet, userId, name, when, age) {
  const last = devLastPunch_(sheet, userId, when);
  if (last && last.type === '出勤' && devDay_(last.time) === devDay_(when)) {
    return { code: 'warn', msg: name + ' はすでに出勤中です（' + devFmt_(last.time, 'HH:mm') + '〜）' };
  }
  devAppend_(sheet, userId, name, '出勤', when, age, '');
  return { code: 'ok', msg: name + ' 出勤 ' + devFmt_(when, 'HH:mm'), added: { u: userId, t: '出勤', ms: when.getTime() } };
}

function devPunchOut_(sheet, userId, name, when, age) {
  const last = devLastPunch_(sheet, userId, when);
  const sameDay = last && devDay_(last.time) === devDay_(when);
  if (sameDay && last.type === '退勤') {
    return { code: 'warn', msg: name + ' はすでに退勤済みです（' + devFmt_(last.time, 'HH:mm') + '）' };
  }
  if (sameDay && last.type === '出勤') {
    devAppend_(sheet, userId, name, '退勤', when, age, '');
    const min = Math.max(0, Math.round((when.getTime() - last.time.getTime()) / 60000));
    return { code: 'ok', msg: name + ' 退勤 ' + devFmt_(when, 'HH:mm') + '（' + Math.floor(min / 60) + '時間' + (min % 60) + '分）',
             added: { u: userId, t: '退勤', ms: when.getTime() } };
  }
  // 今日の出勤記録がない退勤：記録は残し、管理画面で直せるようにする
  devAppend_(sheet, userId, name, '退勤', when, age, '・出勤の記録なし');
  return { code: 'warn', msg: name + ' 出勤の記録がないため、退勤だけ記録しました', added: { u: userId, t: '退勤', ms: when.getTime() } };
}

/** 打刻履歴に1行追加。時刻順が崩れたら並べ替える（既存の当日判定が時刻順を前提にしているため） */
function devAppend_(sheet, userId, name, typeText, when, age, note) {
  let label = DEV_CLIENT_LABEL;
  if (age >= 60) label += '（' + Math.round(age / 60) + '分遅れで送信）';
  label += note;
  const lastRow = sheet.getLastRow();
  let needSort = false;
  if (lastRow >= 2) {
    const lastTime = sheet.getRange(lastRow, 1).getValue();
    if (lastTime instanceof Date && lastTime.getTime() > when.getTime()) needSort = true;
  }
  sheet.appendRow([when, userId, name, typeText, label]);
  if (needSort) {
    const n = sheet.getLastRow();
    sheet.getRange(2, 1, n - 1, 5).sort({ column: 1, ascending: true });
  }
  CacheService.getScriptCache().remove('punch_' + devDay_(when) + '_' + userId);
  CacheService.getScriptCache().remove('punch_' + devDay_(new Date()) + '_' + userId);
}

/* ======================= 取り消し（レバーを10秒以内に戻したとき） ======================= */
/** イベントID cid で端末が追加した行を1件消す。行が無い（記録しなかった・すでに消えた）ときも ok を返す */
function devCancel_(sheet, userId, name, cid) {
  if (!cid) return { code: 'ok', msg: '取り消す記録はありません' };
  const cache = CacheService.getScriptCache();
  const raw = cache.get('dev_row_' + cid);
  if (!raw) return { code: 'ok', msg: '取り消す記録はありません（記録していないか、時間が経っています）' };
  const a = JSON.parse(raw);
  if (String(a.u) !== String(userId)) return { code: 'ok', msg: '取り消す記録はありません' };
  const last = sheet.getLastRow();
  if (last < 2) return { code: 'ok', msg: '取り消す記録はありません' };
  const start = Math.max(2, last - DEV_SCAN_ROWS + 1);
  const vals = sheet.getRange(start, 1, last - start + 1, 5).getValues();
  for (let i = vals.length - 1; i >= 0; i--) {
    const v = vals[i];
    if (!(v[0] instanceof Date) || v[0].getTime() !== a.ms) continue;
    if (String(v[1]) !== String(a.u) || v[3] !== a.t) continue;
    if (String(v[4]).indexOf(DEV_CLIENT_LABEL) !== 0) continue;   // 端末が書いた行だけ
    sheet.deleteRow(start + i);
    cache.remove('dev_row_' + cid);
    cache.remove('punch_' + devDay_(new Date(a.ms)) + '_' + a.u);
    cache.remove('punch_' + devDay_(new Date()) + '_' + a.u);
    return { code: 'ok', msg: name + ' の ' + a.t + '（' + devFmt_(new Date(a.ms), 'HH:mm') + '）を取り消しました' };
  }
  return { code: 'ok', msg: '取り消す記録はありません（すでに消されています）' };
}

/** 状態ページ用：今日のその人の出勤・退勤の時刻（例「出勤 12:45／退勤 18:48」） */
function devTodayOf_(ss, map, now) {
  const out = { a: '', b: '' };
  const sheet = ss.getSheetByName(LOG_SHEET_NAME);
  if (!sheet) return out;
  const last = sheet.getLastRow();
  if (last < 2) { out.a = out.b = '記録なし'; return out; }
  const start = Math.max(2, last - 200 + 1);
  const vals = sheet.getRange(start, 1, last - start + 1, 4).getValues();
  const today = devDay_(now);
  ['a', 'b'].forEach(s => {
    if (!map[s]) return;
    const items = vals.filter(v => v[0] instanceof Date && String(v[1]) === String(map[s]) && devDay_(v[0]) === today &&
                                   (v[3] === '出勤' || v[3] === '退勤'))
                      .sort((x, y) => x[0].getTime() - y[0].getTime())
                      .map(v => v[3] + ' ' + devFmt_(v[0], 'HH:mm'));
    out[s] = items.length ? items.join('／') : '記録なし';
  });
  return out;
}

/* ======================= 見守り（時間で動く。setupDeviceTriggers で登録） ======================= */
/** 営業時間中に端末から30分以上連絡がなければメール。連絡が戻ったらもう一度メール */
function devWatchdog() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(DEV_STATUS_SHEET);
  if (!sh || sh.getLastRow() < 2) return;
  const row = sh.getRange(2, 1, 1, DEV_STATUS_HEAD.length).getValues()[0];
  const lastAt = row[0];
  if (!(lastAt instanceof Date)) return;
  const now = new Date();
  const gapMin = (now.getTime() - lastAt.getTime()) / 60000;
  const props = PropertiesService.getScriptProperties();
  const alerted = props.getProperty(DEV_WD_PROP);
  const info = '最後の連絡：' + devFmt_(lastAt, 'M/d HH:mm') + '\nつながっていた Wi-Fi：' + (row[2] || '不明') + '（' + (row[3] || '') + '）' +
               '\n端末のアドレス：' + (row[5] || '不明') + '\nファームウェア：' + (row[6] || '不明');
  if (alerted) {
    if (gapMin < 15) {
      props.deleteProperty(DEV_WD_PROP);
      devMail_('【出退勤スイッチ】連絡が戻りました', '出退勤スイッチからの連絡が戻りました。\n\n' + info + '\n\n（このメールはスマート打刻システムが自動で送っています）');
    }
    return;
  }
  if (gapMin < DEV_WD_GAP_MIN || !devIsOpen_(now) || !devIsOpen_(new Date(now.getTime() - DEV_WD_GAP_MIN * 60000))) return;
  props.setProperty(DEV_WD_PROP, String(lastAt.getTime()));
  devMail_('【出退勤スイッチ】' + Math.round(gapMin) + '分以上連絡がありません',
    '出退勤スイッチ（ATOM）から、営業時間中に ' + Math.round(gapMin) + ' 分以上連絡がありません。\n' +
    '打刻が記録されていない可能性があります。\n\n' + info + '\n\n' +
    '確認すること：\n・本体の USB 電源が抜けていないか\n・薬局の Wi-Fi が動いているか\n・受付LEDの点滅（2回ずつ＝Wi-Fi なし、3回ずつ＝記録先とやりとりできない）\n\n' +
    '（連絡が戻ったら、もう一度お知らせします。このメールはスマート打刻システムが自動で送っています）');
}
/** 薬局の営業時間か（平日 9:00〜19:00、土曜 9:15〜13:30。日曜・祝日は休み） */
function devIsOpen_(d) {
  const day = Number(Utilities.formatDate(d, Session.getScriptTimeZone(), 'u'));   // 1=月 … 7=日
  const hm = Number(Utilities.formatDate(d, Session.getScriptTimeZone(), 'HHmm'));
  if (day === 7 || devIsHoliday_(d)) return false;
  if (day === 6) return hm >= 915 && hm < 1330;
  return hm >= 900 && hm < 1900;
}
function devIsHoliday_(d) {
  const cache = CacheService.getScriptCache();
  let json = cache.get('dev_holidays');
  if (!json) {
    try {
      json = UrlFetchApp.fetch('https://holidays-jp.github.io/api/v1/date.json', { muteHttpExceptions: true }).getContentText();
      JSON.parse(json);
      cache.put('dev_holidays', json, 21600);
    } catch (e) { return false; }
  }
  try { return !!JSON.parse(json)[devDay_(d)]; } catch (e) { return false; }
}
function devMail_(subject, body) {
  const to = getSettings().email;
  if (!to || to === 'your-email@gmail.com') return;
  MailApp.sendEmail({ to: to, subject: subject, body: body });
}

/* ======================= 時間で動く処理の登録（エディタから1回実行） ======================= */
/** devWatchdog（10分ごと）と monthlyAggregationAndNotify（毎月1日 8時）を登録する。何回実行しても重複しない */
function setupDeviceTriggers() {
  const names = ['devWatchdog', 'monthlyAggregationAndNotify'];
  ScriptApp.getProjectTriggers().forEach(t => { if (names.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('devWatchdog').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('monthlyAggregationAndNotify').timeBased().onMonthDay(1).atHour(8).inTimezone('Asia/Tokyo').create();
  Logger.log('登録しました：' + ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction()).join(', '));
}

/* ======================= 状態 ======================= */
/** その人の打刻のうち、時刻 limit 以前で最新のもの */
function devLastPunch_(sheet, userId, limit) {
  const last = sheet.getLastRow();
  if (last < 2) return null;
  const start = Math.max(2, last - DEV_SCAN_ROWS + 1);
  const vals = sheet.getRange(start, 1, last - start + 1, 4).getValues();
  let best = null;
  for (let i = vals.length - 1; i >= 0; i--) {
    const v = vals[i];
    if (String(v[1]) !== String(userId) || !(v[0] instanceof Date)) continue;
    if (v[3] !== '出勤' && v[3] !== '退勤') continue;
    if (limit && v[0].getTime() > limit.getTime()) continue;
    if (!best || v[0].getTime() > best.time.getTime()) best = { time: v[0], type: v[3] };
  }
  return best;
}

/** スイッチ端末の LED 用：左右それぞれ今出勤中か */
function devStateOf_(ss, map, now) {
  const sheet = ss.getSheetByName(LOG_SHEET_NAME);
  const out = { a: 'off', b: 'off' };
  if (!sheet) return out;
  ['a', 'b'].forEach(s => {
    if (!map[s]) return;
    const last = devLastPunch_(sheet, map[s], now);
    if (!last || last.type !== '出勤') return;
    const hours = (now.getTime() - last.time.getTime()) / 3600000;
    out[s] = hours < DEV_STALE_HOURS ? 'on' : 'stale';
  });
  return out;
}

/** 設定シートから左右のスイッチに割り当てた従業員IDを読む */
function devSlotMap_(ss) {
  const map = { a: '', b: '' };
  const conf = ss.getSheetByName(SETTING_SHEET_NAME);
  if (!conf) return map;
  const vals = conf.getDataRange().getValues();
  vals.forEach(r => {
    if (String(r[0]).trim() === DEV_KEY_LEFT) map.a = String(r[1]).trim();
    if (String(r[0]).trim() === DEV_KEY_RIGHT) map.b = String(r[1]).trim();
  });
  return map;
}

function devDay_(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function devFmt_(d, f) { return Utilities.formatDate(d, Session.getScriptTimeZone(), f); }
function devJson_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ======================= 動作テスト（エディタから実行） ======================= */
/** 端末なしで、左スイッチの人の出勤を1件記録してみる。確認後は打刻履歴の行を消してください */
function testDevicePunch() {
  const token = PropertiesService.getScriptProperties().getProperty(DEV_PROP_TOKEN);
  const r = handleDeviceRequest_({ parameter: { token: token, slot: 'a', action: 'in', id: 'test-' + Date.now(), age: '0' } });
  Logger.log(r.getContent());
}
