@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22.13 或更新版本。
  pause
  exit /b 1
)
if not exist .env.local (
  copy deploy\.env.local.example .env.local >nul
  echo 已生成.env.local，请生成并填写随机APP_SECRET后重新启动；填写腾讯云短信配置后重新启动。
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci --no-audit --no-fund
  if errorlevel 1 exit /b 1
)
echo 请先关闭占用3188端口的本机服务，再启动正式服务。
echo 手机与电脑连接同一Wi-Fi，用本机局域网IP和3188端口访问。
call npm run start:local
pause
