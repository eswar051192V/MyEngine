"""
Exchange Upstox authorization code for an access token.

Set credentials in the environment (do not commit secrets):
  export UPSTOX_API_KEY="your_client_id"
  export UPSTOX_API_SECRET="your_client_secret"
  export UPSTOX_AUTH_CODE="code_from_redirect"

Then run: python get_token.py
"""
import os
import sys

import requests

API_KEY = os.environ.get("UPSTOX_API_KEY")
API_SECRET = os.environ.get("UPSTOX_API_SECRET")
CODE = os.environ.get("UPSTOX_AUTH_CODE")

if not all([API_KEY, API_SECRET, CODE]):
    print(
        "Missing env vars. Set UPSTOX_API_KEY, UPSTOX_API_SECRET, and UPSTOX_AUTH_CODE."
    )
    sys.exit(1)

url = "https://api.upstox.com/v2/login/authorization/token"
headers = {
    "accept": "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
}
data = {
    "code": CODE,
    "client_id": API_KEY,
    "client_secret": API_SECRET,
    "redirect_uri": "https://localhost:3000",
    "grant_type": "authorization_code",
}

response = requests.post(url, headers=headers, data=data)

if response.status_code == 200:
    token = response.json().get("access_token")
    print("\n✅ SUCCESS! === YOUR UPSTOX ACCESS TOKEN ===")
    print(token)
    print("\nCopy the token above into UPSTOX_ACCESS_TOKEN (env or secure config).")
else:
    print("\n❌ FAILED. The code may be expired or invalid. Generate a new code.")
    try:
        print(response.json())
    except Exception:
        print(response.text)
