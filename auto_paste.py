"""
Auto-update Tampermonkey script:
1. Mo Tampermonkey editor
2. Ctrl+A → Ctrl+V → Ctrl+S
"""
import subprocess
import time
import pyautogui
import pyperclip

# Step 1: Doc noi dung script moi
with open('userscript/chatgpt_bridge.user.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Step 2: Copy vao clipboard
pyperclip.copy(content)
print("[+] Da copy script vao clipboard")

# Step 3: Mo Tampermonkey editor (tab moi trong Chrome)
subprocess.Popen(
    'start chrome "chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/options.html#nav=dashboard"',
    shell=True
)
print("[*] Dang mo Tampermonkey Dashboard...")
time.sleep(4)

# Step 4: Activate Chrome
pyautogui.hotkey('alt', 'tab')
time.sleep(1)
print("[*] Vui long click vao o edit cua script 'ChatGPT WebUI Bridge' trong 5 giay...")
time.sleep(5)

# Step 5: Ctrl+A Ctrl+V Ctrl+S
print("[*] Dang paste va luu...")
pyautogui.hotkey('ctrl', 'a')
time.sleep(0.3)
pyautogui.hotkey('ctrl', 'v')
time.sleep(0.5)
pyautogui.hotkey('ctrl', 's')
time.sleep(0.5)
print("[+] Hoan thanh! Script da duoc cap nhat.")
