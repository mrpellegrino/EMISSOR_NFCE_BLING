@echo off
setlocal

cd /d "%~dp0"

echo Iniciando banco de dados...
docker compose up -d
if errorlevel 1 (
  echo.
  echo Nao foi possivel iniciar o Docker. Verifique se o Docker Desktop esta aberto.
  echo O backend e o frontend continuarao sendo iniciados.
)

echo.
echo Iniciando backend em http://localhost:3000...
start "Emissor NFC-e - Backend" cmd /k "cd /d ""%~dp0backend"" && yarn start:dev"

echo Iniciando frontend em http://localhost:5173...
start "Emissor NFC-e - Frontend" cmd /k "cd /d ""%~dp0frontend"" && yarn dev"

timeout /t 3 /nobreak >nul
start "" http://localhost:5173

endlocal
