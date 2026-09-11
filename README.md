# 糖尿病预治智能助手

基于DeepSeek大模型与Dify平台的糖尿病健康管理Web应用

## 功能特性

- 用户登录注册
- 系统首页（轮播图、快捷入口、文章列表）
- 糖尿病风险预测
- 生活方案管理（饮食、运动）
- 健康资讯浏览与收藏
- 医师在线咨询
- AI智能助手对话
- 个人中心

## 技术栈

- HTML5 + CSS3 + JavaScript
- 响应式设计
- localStorage本地存储

## 测试账号

- 管理员：admin / admin123
- 普通用户：user / user123

## 项目结构

```
├── index.html              # 登录/注册页面
├── home.html               # 系统首页
├── personal.html           # 个人中心
├── doctor.html             # 医师咨询
├── risk-prediction.html    # 糖尿病风险预测
├── life-plan.html          # 生活方案
├── health-news.html        # 健康资讯
├── assistant.html          # AI智能助手
└── css/
    └── common.css          # 公共样式
```

## 本地运行

```bash
npx http-server -p 8080
```

访问 http://localhost:8080
