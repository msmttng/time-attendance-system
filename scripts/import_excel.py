import pandas as pd
import urllib.request
import json
import ssl
import datetime

URL = 'https://script.google.com/macros/s/AKfycbzL9bLmEB9EAy5dyeFUpZfn5OIpXW3ILWTLBvCfKb7adYbheY-23spINckRHRJRfBiU/exec'

def send_update(date_str, user_id, user_name, in_time, out_time):
    payload = {
        'action': 'update_daily_status',
        'adminPassword': 'admin',
        'date': date_str,
        'userId': user_id,
        'userName': user_name,
        'type': '出勤',
        'status': '承認済み'
    }
    
    # If in_time or out_time are not empty strings, pass them to update log
    if in_time:
        payload['inTime'] = in_time
    if out_time:
        payload['outTime'] = out_time
        
    req = urllib.request.Request(URL, data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(req, context=ctx) as response:
            result = json.loads(response.read().decode())
            print(f"[{date_str}] {user_name} (in:{in_time} out:{out_time}) -> {result}")
    except Exception as e:
        print(f"Error on {date_str} for {user_name}: {e}")

def format_time(t):
    if pd.isna(t):
        return ''
    s = str(t)
    # Check if it's already HH:MM format
    if len(s) >= 5 and s[2] == ':':
        return s[:5]
    return ''

def process_file(filepath, user_id, user_name):
    print(f"\nProcessing {filepath} for {user_name}...")
    df = pd.read_excel(filepath, header=None)
    
    # Rows 13+ (index 12+)
    for i in range(12, len(df)):
        date_val = df.iloc[i, 0]
        if pd.isna(date_val):
            continue
            
        try:
            date_num = float(date_val)
            dt = datetime.datetime(1899, 12, 30) + datetime.timedelta(days=date_num)
            date_str = dt.strftime('%Y-%m-%d')
        except:
            continue
            
        in_time = format_time(df.iloc[i, 4])
        out_time = format_time(df.iloc[i, 10])
        
        if not in_time and not out_time:
            continue
            
        send_update(date_str, user_id, user_name, in_time, out_time)

process_file(r'C:\Users\masam\Desktop\202606_勤務表 (3).xlsx', 'kayo', '木場 佳代')
process_file(r'C:\Users\masam\Desktop\202606_勤務表 (4).xlsx', 'mari', '大内 麻里')
