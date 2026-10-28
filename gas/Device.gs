/**
 * スマート打刻システム - 出退勤スイッチ（ESP32 端末）連携  v1.4.0
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
      const st = devStateOf_(ss, map, new Date());
      return devJson_({ code: 'ok', msg: 'pong', st_a: st.a, st_b: st.b });
    }

    const slot = String(p.slot || '');
    const action = String(p.action || '');
    if (['a', 'b'].indexOf(slot) < 0 || ['in', 'out'].indexOf(action) < 0) {
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
          const st = devStateOf_(ss, map, new Date());
          r.st_a = st.a; r.st_b = st.b;
          return devJson_(r);
        }
      }

      // 打刻時刻 = 受信時刻 − age（通信が切れていた分をさかのぼる）
      const now = new Date();
      let age = Number(p.age || 0);
      if (!(age >= 0) || age > DEV_MAX_AGE_SEC) age = 0;
      const when = new Date(now.getTime() - age * 1000);

      const employees = getPublicEmployees();
      const name = employees[userId] ? employees[userId].name : '';
      if (!name) return devJson_({ code: 'error', msg: '従業員ID「' + userId + '」が従業員シートにありません' });

      const sheet = ss.getSheetByName(LOG_SHEET_NAME);
      if (!sheet) throw new Error('打刻履歴シートが見つかりません');
      const res = action === 'in' ? devPunchIn_(sheet, userId, name, when, age)
                                  : devPunchOut_(sheet, userId, name, when, age);
      res.action = action;
      const st = devStateOf_(ss, map, now);
      res.st_a = st.a; res.st_b = st.b;
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
    const kind = p.ping ? '接続確認' : ((p.slot === 'a' ? '左' : '右') + (p.action === 'in' ? ' 出勤' : ' 退勤'));
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
  return { code: 'ok', msg: name + ' 出勤 ' + devFmt_(when, 'HH:mm') };
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
    return { code: 'ok', msg: name + ' 退勤 ' + devFmt_(when, 'HH:mm') + '（' + Math.floor(min / 60) + '時間' + (min % 60) + '分）' };
  }
  // 今日の出勤記録がない退勤：記録は残し、管理画面で直せるようにする
  devAppend_(sheet, userId, name, '退勤', when, age, '・出勤の記録なし');
  return { code: 'warn', msg: name + ' 出勤の記録がないため、退勤だけ記録しました' };
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
