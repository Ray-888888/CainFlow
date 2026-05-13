@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title CainFlow Launcher

set "APP_DIR=%~dp0"
set "PYTHON_CMD="
set "CAINFLOW_PORT=8767"

cls
echo ==========================================
echo       CainFlow - Starting Environment
echo ==========================================
echo.

if exist "%APP_DIR%python_runtime\python.exe" (
    set "PYTHON_CMD=%APP_DIR%python_runtime\python.exe"
) else (
    where python >nul 2>nul
    if !ERRORLEVEL! EQU 0 (
        set "PYTHON_CMD=python"
    ) else (
        where py >nul 2>nul
        if !ERRORLEVEL! EQU 0 (
            set "PYTHON_CMD=py"
        )
    )
)

if not defined PYTHON_CMD goto python_missing

%PYTHON_CMD% --version >nul 2>nul
if !ERRORLEVEL! NEQ 0 goto python_missing

echo Detecting Python: Success.
echo Starting server...
echo ------------------------------------------

pushd "%APP_DIR%"
call :ensure_port_available
if !ERRORLEVEL! NEQ 0 (
    set "EXIT_CODE=!ERRORLEVEL!"
    popd
    exit /b !EXIT_CODE!
)
set "CAINFLOW_LAUNCHED_FROM_BAT=1"
%PYTHON_CMD% "%APP_DIR%server.py"
set "EXIT_CODE=!ERRORLEVEL!"
popd

if !EXIT_CODE! NEQ 0 (
    echo.
    echo 启动失败，错误代码: !EXIT_CODE!
    echo 上方已显示具体原因，请按提示处理后再重新启动 CainFlow。
    echo.
    echo 请手动关闭此窗口，或按任意键退出。
    pause >nul
)

exit /b !EXIT_CODE!

:python_missing
echo 错误：未安装 Python，或 Python 不在 PATH 中。
echo 按回车键打开 Python 官方下载页面。
echo.
pause >nul
start "" "https://www.python.org/downloads/"
exit /b 1

:ensure_port_available
set "PORT_PID="
set "PORT_PROC="
set "PORT_CMDLINE="
set "PORT_CONFLICT_KIND=port"

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%CAINFLOW_PORT% .*LISTENING"') do (
    set "PORT_PID=%%P"
    goto port_found
)

exit /b 0

:port_found
for /f "tokens=1 delims=," %%A in ('tasklist /FI "PID eq !PORT_PID!" /FO CSV /NH 2^>nul') do (
    set "PORT_PROC=%%~A"
)

if not defined PORT_PROC set "PORT_PROC=Unknown"

for /f "usebackq delims=" %%C in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Get-CimInstance Win32_Process -Filter 'ProcessId = !PORT_PID!' -ErrorAction SilentlyContinue; if ($p -and $p.CommandLine) { $p.CommandLine }" 2^>nul`) do (
    if not defined PORT_CMDLINE set "PORT_CMDLINE=%%C"
)

call :classify_port_owner

echo.
echo ==========================================
if /I "!PORT_CONFLICT_KIND!"=="already_running" (
    echo 启动冲突：CainFlow 已在运行
    echo ==========================================
    echo 检测到 CainFlow 正在占用端口 %CAINFLOW_PORT%。
    echo 已运行地址: http://127.0.0.1:%CAINFLOW_PORT%
    echo.
    echo 请不要重复启动；如需重启，请先关闭已运行的 CainFlow 窗口或进程。
) else (
    echo 启动冲突：端口 %CAINFLOW_PORT% 已被占用
    echo ==========================================
    echo CainFlow 需要使用端口 %CAINFLOW_PORT%，但该端口当前被其他程序占用。
    echo.
    echo 请关闭占用该端口的程序，或释放端口后再重新启动 CainFlow。
)
echo.
echo 占用进程 ID: !PORT_PID!
echo 占用进程名: !PORT_PROC!
if defined PORT_CMDLINE echo 命令行: !PORT_CMDLINE!
echo.
echo 请手动关闭此窗口，或按任意键退出。
pause >nul

exit /b 1

:classify_port_owner
if /I "!PORT_PROC!"=="CainFlow.exe" set "PORT_CONFLICT_KIND=already_running"
if /I "!PORT_PROC!"=="CainFlow_Launcher.exe" set "PORT_CONFLICT_KIND=already_running"
if defined PORT_CMDLINE (
    echo(!PORT_CMDLINE! | findstr /I /C:"CainFlow.exe" /C:"CainFlow_Launcher.exe" >nul && set "PORT_CONFLICT_KIND=already_running"
    echo(!PORT_CMDLINE! | findstr /I /C:"%APP_DIR%server.py" >nul && set "PORT_CONFLICT_KIND=already_running"
    echo(!PORT_CMDLINE! | findstr /I /C:"server.py" >nul && echo(!PORT_CMDLINE! | findstr /I /C:"CainFlow" >nul && set "PORT_CONFLICT_KIND=already_running"
)
exit /b 0
