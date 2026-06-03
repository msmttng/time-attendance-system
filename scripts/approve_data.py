import urllib.request
import json
import ssl

URL = 'https://script.google.com/macros/s/AKfycbzL9bLmEB9EAy5dyeFUpZfn5OIpXW3ILWTLBvCfKb7adYbheY-23spINckRHRJRfBiU/exec'

def update_daily_status(date, user_id, type_val, status):
    payload = {
        'action': 'update_daily_status',
        'adminPassword': 'admin',
        'date': date,
        'userId': user_id,
        'type': type_val,
        'status': status
    }
    
    req = urllib.request.Request(URL, data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    
    # Create SSL context to ignore certificate errors if any
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    with urllib.request.urlopen(req, context=ctx) as response:
        result = json.loads(response.read().decode())
        print(f"Updated {user_id} on {date}: {result}")

# For mari
update_daily_status('2026-06-01', 'mari', '出勤', '承認済み')
update_daily_status('2026-06-02', 'mari', '出勤', '承認済み')

# For kayo
update_daily_status('2026-06-01', 'kayo', '出勤', '承認済み')
update_daily_status('2026-06-02', 'kayo', '出勤', '承認済み')

print("All requests completed.")
