"""
Tao anh trong ChatGPT - gui prompt va de Chrome tu dong tai anh ve
Usage: python generate_image.py "mo ta anh"
"""
import urllib.request
import json
import sys
import os

BACKEND = "http://127.0.0.1:5000"


def send_to_chatgpt(text, timeout=300):
    req = urllib.request.Request(
        f"{BACKEND}/send",
        data=json.dumps({"text": text}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    resp = urllib.request.urlopen(req, timeout=timeout)
    return json.loads(resp.read().decode("utf-8"))


if __name__ == "__main__":
    # Fix Windows encoding
    if sys.platform == 'win32':
        os.environ['PYTHONIOENCODING'] = 'utf-8'

    if len(sys.argv) < 2:
        prompt = "a futuristic city at night with neon lights, cyberpunk style"
    else:
        prompt = " ".join(sys.argv[1:])

    full_prompt = f"Generate an image: {prompt}"
    print(f"[*] Dang gui prompt: {prompt}")
    print("[*] Cho ChatGPT tao anh (30-90 giay)... Anh se tu dong tai xuong khi xong!")

    try:
        result = send_to_chatgpt(full_prompt, timeout=300)
        if result.get("ok"):
            reply = result.get('reply', '').encode('ascii', 'replace').decode()
            print(f"[+] ChatGPT da tra loi: {reply[:150]}")
        else:
            print(f"[-] Loi: {result}")
    except Exception as e:
        err = str(e).encode('ascii', 'replace').decode()
        print(f"[!] {err}")
        print("[i] Kiem tra tab ChatGPT - anh co the da duoc tao va tu dong tai xuong roi!")
