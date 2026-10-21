@echo off
cd /d "%~dp0"
docker compose up -d --build --wait
if errorlevel 1 (
  echo Docker startup failed. Check Docker Desktop and run docker compose logs app.
  pause
  exit /b 1
)
echo Open http://localhost:8080 or http://SERVER-IP:8080 from your phone.
pause
