@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "APP_DIR=%~dp0"
cd /d "%APP_DIR%"

if exist "%APP_DIR%.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%APP_DIR%.env") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

call :strip_quotes MYSQL_URL
call :strip_quotes MYSQL_USER
call :strip_quotes MYSQL_PASSWORD
call :strip_quotes REDIS_PASSWORD
call :strip_quotes OSS_ACCESS_KEY_ID
call :strip_quotes OSS_ACCESS_KEY_SECRET
call :strip_quotes APIMART_API_KEY
call :strip_quotes YOUMI_IMAGE_API_KEY
call :strip_quotes APIMART_IMAGE_API_KEY
call :strip_quotes GETTOKEN_API_KEY
call :strip_quotes MINIMAX_API_KEY

if "%SERVER_PORT%"=="" set "SERVER_PORT=8083"
if "%SPRING_PROFILES_ACTIVE%"=="" set "SPRING_PROFILES_ACTIVE=dev"
if "%REDIS_HOST%"=="" set "REDIS_HOST=127.0.0.1"
if "%REDIS_PORT%"=="" set "REDIS_PORT=6379"
if "%REDIS_DATABASE%"=="" set "REDIS_DATABASE=0"

set "CONFIG_LOCATION=optional:file:%APP_DIR:\=/%"

java %JAVA_OPTS% -jar "%APP_DIR%youmi-api-0.1.0.jar" ^
  --spring.profiles.active="%SPRING_PROFILES_ACTIVE%" ^
  --spring.config.additional-location="%CONFIG_LOCATION%" ^
  --server.port="%SERVER_PORT%" ^
  %*

set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%

:strip_quotes
set "VALUE=!%~1!"
if "!VALUE:~0,1!"=="'" if "!VALUE:~-1!"=="'" set "VALUE=!VALUE:~1,-1!"
if "!VALUE:~0,1!"=="""" if "!VALUE:~-1!"=="""" set "VALUE=!VALUE:~1,-1!"
set "%~1=!VALUE!"
exit /b 0
