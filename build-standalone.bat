@echo off
setlocal
cd /d "%~dp0"
echo Building roc_desk-sql (Release)...
cargo build --release -p roc_desk_sql_standalone
if errorlevel 1 (
  echo BUILD FAILED: roc_desk-sql
  exit /b 1
)
if not exist bin mkdir bin
copy /Y "target\release\roc_desk_sql_standalone.exe" "bin\roc_desk-sql.exe" >nul
if errorlevel 1 (
  echo COPY FAILED: roc_desk-sql
  exit /b 1
)
echo BUILD OK: bin\roc_desk-sql.exe
exit /b 0
