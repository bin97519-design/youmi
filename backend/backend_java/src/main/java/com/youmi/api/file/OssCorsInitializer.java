package com.youmi.api.file;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

@Component
public class OssCorsInitializer implements ApplicationRunner {
  private static final Logger log = LoggerFactory.getLogger(OssCorsInitializer.class);

  private final OssStorageProperties properties;
  private final OssStorageService ossStorageService;

  public OssCorsInitializer(OssStorageProperties properties, OssStorageService ossStorageService) {
    this.properties = properties;
    this.ossStorageService = ossStorageService;
  }

  @Override
  public void run(ApplicationArguments args) {
    if (!properties.isCorsAutoConfigure() || !ossStorageService.isConfigured()) {
      return;
    }
    try {
      Object result = ossStorageService.configureDirectUploadCors();
      log.info("OSS direct upload CORS configured: {}", result);
    } catch (Exception exception) {
      log.warn("OSS direct upload CORS auto configure failed: {}", exception.getMessage());
    }
  }
}
