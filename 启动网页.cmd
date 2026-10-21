@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22.13 或更新版本。
  pause
  exit /b 1
)
node scripts\prepare-local-config.js
if errorlevel 1 exit /b 1
if not exist node_modules (
  call npm ci --no-audit --no-fund
  if errorlevel 1 exit /b 1
)
echo 服务启动后，打开 http://127.0.0.1:3188
echo 用登记的手机号获取短信验证码，再输入收到的验证码登录。
call npm start
pause
