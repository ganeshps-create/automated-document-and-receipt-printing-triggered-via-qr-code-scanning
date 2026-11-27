@echo off
cd /d "%~dp0"
if not exist agent-config.json (
  echo agent-config.json missing. Copy agent-config.example.json to agent-config.json and fill values.
  pause
  exit /b 1
)
node agent.js test --config agent-config.json
echo.
node agent.js run --once --dry-run --config agent-config.json
pause
