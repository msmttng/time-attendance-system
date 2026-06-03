import urllib.request
import json

URL = 'https://script.google.com/macros/s/AKfycbzL9bLmEB9EAy5dyeFUpZfn5OIpXW3ILWTLBvCfKb7adYbheY-23spINckRHRJRfBiU/exec'

# Fetch users
req = urllib.request.Request(URL + '?action=get_users')
with urllib.request.urlopen(req) as response:
    data = json.loads(response.read().decode())
    print("USERS:", json.dumps(data, indent=2, ensure_ascii=False))

# Fetch logs for all users
# Assuming get_monthly_data exists, but we need admin password for it usually
req_admin = urllib.request.Request(URL, data=json.dumps({
    'action': 'get_monthly_data',
    'adminPassword': 'admin',
    'month': '2026-06'
}).encode(), headers={'Content-Type': 'application/json'})
try:
    with urllib.request.urlopen(req_admin) as response:
        data = json.loads(response.read().decode())
        print("LOGS:", json.dumps(data, indent=2, ensure_ascii=False))
except Exception as e:
    print("Error fetching logs:", e)
