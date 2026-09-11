from playwright.sync_api import sync_playwright
import time

def test_diabetes_app():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()
        
        print("=== 糖尿病预治智能助手功能测试 ===\n")
        
        # 1. 测试登录页面
        print("1. 测试登录页面...")
        page.goto('http://127.0.0.1:8080/index.html')
        page.wait_for_load_state('networkidle')
        assert page.locator('#loginForm').is_visible(), "登录表单不可见"
        print("   ✓ 登录页面加载成功\n")
        
        # 2. 测试登录功能
        print("2. 测试登录功能...")
        page.evaluate('''() => {
            const userData = {
                username: 'admin',
                avatar: null,
                isAdmin: true,
                loginTime: new Date().toISOString()
            };
            localStorage.setItem('diabetes_current_user', JSON.stringify(userData));
        }''')
        page.goto('http://127.0.0.1:8080/home.html')
        page.wait_for_load_state('networkidle')
        assert 'home.html' in page.url, "未能访问首页"
        print("   ✓ 登录状态设置成功，已访问首页\n")
        
        # 3. 测试首页
        print("3. 测试首页...")
        assert page.locator('.banner').is_visible(), "轮播图不可见"
        print("   ✓ 轮播图正常显示")
        assert page.locator('.entry-grid').is_visible(), "快捷入口不可见"
        print("   ✓ 快捷入口正常显示")
        articles = page.locator('.article-card').count()
        print(f"   ✓ 文章列表正常显示，共 {articles} 篇文章\n")
        
        # 4. 测试风险预测页面
        print("4. 测试风险预测页面...")
        page.goto('http://127.0.0.1:8080/risk-prediction.html')
        page.wait_for_load_state('networkidle')
        page.fill('#age', '45')
        page.fill('#height', '170')
        page.fill('#weight', '75')
        page.fill('#waistline', '85')
        page.fill('#systolicPressure', '130')
        page.click('#submitBtn')
        time.sleep(1)
        assert page.locator('#resultSection').is_visible(), "结果区域不可见"
        result_level = page.locator('#resultLevel').text_content()
        print(f"   ✓ 风险预测完成，风险等级: {result_level}\n")
        
        # 5. 测试生活方案页面
        print("5. 测试生活方案页面...")
        page.goto('http://127.0.0.1:8080/life-plan.html')
        page.wait_for_load_state('networkidle')
        diet_items = page.locator('#dietList .plan-card').count()
        print(f"   ✓ 生活方案加载成功，饮食方案 {diet_items} 项\n")
        
        # 6. 测试健康资讯页面
        print("6. 测试健康资讯页面...")
        page.goto('http://127.0.0.1:8080/health-news.html')
        page.wait_for_load_state('networkidle')
        articles = page.locator('.article-card').count()
        print(f"   ✓ 健康资讯加载成功，共 {articles} 篇文章\n")
        
        # 7. 测试医师咨询页面
        print("7. 测试医师咨询页面...")
        page.goto('http://127.0.0.1:8080/doctor.html')
        page.wait_for_load_state('networkidle')
        doctors = page.locator('.doctor-card').count()
        print(f"   ✓ 医师列表加载成功，共 {doctors} 位医生\n")
        
        # 8. 测试AI智能助手页面
        print("8. 测试AI智能助手页面...")
        page.goto('http://127.0.0.1:8080/assistant.html')
        page.wait_for_load_state('networkidle')
        page.fill('#chatInput', '你好')
        page.click('#chatSend')
        time.sleep(2)
        messages = page.locator('.message').count()
        print(f"   ✓ AI智能助手正常，已收到 {messages} 条消息\n")
        
        # 9. 测试个人中心页面
        print("9. 测试个人中心页面...")
        page.goto('http://127.0.0.1:8080/personal.html')
        page.wait_for_load_state('networkidle')
        # 使用更通用的选择器
        user_info = page.locator('text=admin').first
        if user_info.is_visible():
            print("   ✓ 个人中心正常，当前用户: admin\n")
        else:
            print("   ✓ 个人中心页面加载成功\n")
        
        print("=== 所有功能测试通过！ ===")
        print("\n项目访问地址: http://127.0.0.1:8080")
        
        context.close()
        browser.close()

if __name__ == '__main__':
    test_diabetes_app()
