@REM Maven wrapper script for Windows
@echo off
setlocal

set MAVEN_PROJECTBASEDIR=%~dp0..
set WRAPPER_JAR="%MAVEN_PROJECTBASEDIR%\.mvn\wrapper\maven-wrapper.jar"
set WRAPPER_PROPERTIES="%MAVEN_PROJECTBASEDIR%\.mvn\wrapper\maven-wrapper.properties"

if exist %WRAPPER_PROPERTIES% (
    for /f "tokens=2 delims==" %%a in ('findstr "distributionUrl" %WRAPPER_PROPERTIES%') do set DIST_URL=%%a
)

if not exist "%MAVEN_PROJECTBASEDIR%\.mvn\wrapper\apache-maven" (
    echo Downloading Maven...
    powershell -Command "Invoke-WebRequest -Uri '%DIST_URL%' -OutFile '%MAVEN_PROJECTBASEDIR%\.mvn\wrapper\maven-dist.zip'"
    powershell -Command "Expand-Archive -Path '%MAVEN_PROJECTBASEDIR%\.mvn\wrapper\maven-dist.zip' -DestinationPath '%MAVEN_PROJECTBASEDIR%\.mvn\wrapper' -Force"
    for /d %%d in ("%MAVEN_PROJECTBASEDIR%\.mvn\wrapper\apache-maven*") do set MAVEN_HOME=%%d
) else (
    for /d %%d in ("%MAVEN_PROJECTBASEDIR%\.mvn\wrapper\apache-maven*") do set MAVEN_HOME=%%d
)

"%MAVEN_HOME%\bin\mvn.cmd" %*
