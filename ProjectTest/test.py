from google import genai

client = genai.Client(api_key="AIzaSyBAGEysf6hWNVwXjtpJb0zXsSrjq7y3h0o")

print("🔍 正在向 Google 查詢可用模型清單...")

try:
    # 列出所有可用的模型名字
    for m in client.models.list():
        print(f"✅ 找到可用模型: {m.name}")
        
    # 拿到清單後，我們挑第一個看到的 flash 模型直接衝撞測試
    # (假設清單裡有 gemini-1.5-flash)
        response = client.models.generate_content(
                # 換成這個，它是免費版最穩定的路徑
                model="gemini-flash-latest", 
                contents="Please say YES if you work."
            )    
        print("\n🚀 衝撞測試結果：" + response.text)

except Exception as e:
    print("\n❌ 還是失敗，錯誤訊息：" + str(e))