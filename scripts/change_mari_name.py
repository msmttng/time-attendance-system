import requests
import json

# URL of the GAS web app (extracted from admin.js)
GAS_URL = "https://script.google.com/macros/s/AKfycbzL9bLmEB9EAy5dyeFUpZfn5OIpXW3ILWTLBvCfKb7adYbheY-23spINckRHRJRfBiU/exec"

def change_name():
    payload = {
        "action": "save_user",
        "adminPassword": "admin",
        "user": {
            "id": "mari",
            "name": "大内 麻里"
        }
    }
    
    headers = {'Content-Type': 'application/json'}
    
    print(f"Sending request to update mari's name...")
    
    response = requests.post(GAS_URL, json=payload, headers=headers)
    
    try:
        result = response.json()
        print(f"Response: {result}")
        if result.get("status") == "success":
            print("Successfully updated the name!")
        else:
            print("Failed to update.")
    except Exception as e:
        print(f"Error parsing response: {e}")
        print(response.text)

if __name__ == "__main__":
    change_name()
