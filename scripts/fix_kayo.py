import pandas as pd
import urllib.request
import json
import ssl

URL = 'https://script.google.com/macros/s/AKfycbzL9bLmEB9EAy5dyeFUpZfn5OIpXW3ILWTLBvCfKb7adYbheY-23spINckRHRJRfBiU/exec'

def send_update(date_str, user_id, user_name, in_time, out_time):
    payload = {
        'action': 'update_daily_status',
        'adminPassword': 'admin',
        'date': date_str,
        'userId': user_id,
        'userName': user_name,
        'type': '出勤',
        'status': '承認済み',
        'inTime': in_time,
        'outTime': out_time
    }
    
    req = urllib.request.Request(URL, data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(req, context=ctx) as response:
            result = json.loads(response.read().decode())
            print(f"[{date_str}] {user_name} (in:'{in_time}' out:'{out_time}') -> {result}")
    except Exception as e:
        print(f"Error on {date_str} for {user_name}: {e}")

# 1. まず「木場 佳代」として登録されてしまったログを削除（inTime, outTimeを空文字で送信）
print("--- Deleting incorrect logs ---")
send_update('2026-06-01', 'kayo', '木場 佳代', '', '')
send_update('2026-06-02', 'kayo', '木場 佳代', '', '')

# 2. 次に正しい名前「月村 佳世」として正しい時間を再登録
print("\n--- Re-inserting correct logs ---")
send_update('2026-06-01', 'kayo', '月村 佳世', '09:28', '18:30')
send_update('2026-06-02', 'kayo', '月村 佳世', '09:28', '18:21')
