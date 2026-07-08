@echo off
echo ============================================
echo  有米后端服务启动脚本
echo ============================================
echo.

:: 设置 Java 环境
set "JAVA_HOME=D:\Program Files\Java\jdk-17"
set "MAVEN_HOME=D:\Program Files\apache-maven-3.8.3"
set "PATH=%JAVA_HOME%\bin;%MAVEN_HOME%\bin;%PATH%"

echo [INFO] Java 路径: %JAVA_HOME%
echo [INFO] Maven 路径: %MAVEN_HOME%
echo.

:: 切换到后端目录
cd /d "D:\youmi\youmi\backend"

:: 启动 Spring Boot (使用完整 plugin 坐标)
echo [INFO] 正在启动有米后端服务...
echo [INFO] 使用配置文件: application-dev.yml (端口 8083)
echo [INFO] 数据库: MySQL (阿里云 RDS)
echo.

"%MAVEN_HOME%\bin\mvn.cmd" org.springframework.boot:spring-boot-maven-plugin:3.3.6:run -Dspring-boot.run.profiles=dev

if errorlevel 1 (
    echo.
    echo [ERROR] 后端服务启动失败！
    pause
)
