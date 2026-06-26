@echo off
cd /d D:\youmi\youmi\backend
set JAVA_HOME=D:\Program Files\Java\jdk-17
set PATH=%JAVA_HOME%\bin;D:\Program Files\apache-maven-3.8.3\bin;%PATH%
"D:\Program Files\apache-maven-3.8.3\bin\mvn.cmd" spring-boot:run -Dspring-boot.run.profiles=dev
