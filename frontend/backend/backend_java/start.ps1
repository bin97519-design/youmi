$env:JAVA_HOME = "D:\Program Files\Java\jdk-17"
$env:PATH = "$env:JAVA_HOME\bin;D:\Program Files\apache-maven-3.8.3\bin;$env:PATH"
cd "D:\youmi\youmi\backend"
& "D:\Program Files\apache-maven-3.8.3\bin\mvn.cmd" spring-boot:run -Dspring-boot.run.profiles=dev
