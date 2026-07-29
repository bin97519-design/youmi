package com.youmi.api.file;

import com.youmi.api.common.ApiException;
import com.youmi.api.common.ApiResponse;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/public/report-files")
public class PublicReportFileController {
  private static final ZoneId STORAGE_ZONE = ZoneId.of("Asia/Shanghai");
  private static final DateTimeFormatter DATE_FOLDER_FORMAT = DateTimeFormatter.ofPattern("yyMMdd");

  private final Path basePath;
  private final Clock clock;

  @Autowired
  public PublicReportFileController(
      @Value("${youmi.report-file.base-path:/opt/projects/data-capture-report}")
          String basePath) {
    this(Paths.get(basePath), Clock.system(STORAGE_ZONE));
  }

  PublicReportFileController(Path basePath, Clock clock) {
    this.basePath = basePath.toAbsolutePath().normalize();
    this.clock = clock;
  }

  @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public ApiResponse<Map<String, Object>> upload(@RequestParam("file") MultipartFile file)
      throws IOException {
    if (file == null || file.isEmpty()) {
      throw new ApiException(400, "上传文件不能为空");
    }

    String dateFolder = LocalDate.now(clock).format(DATE_FOLDER_FORMAT);
    Path datePath = basePath.resolve(dateFolder).normalize();
    if (!datePath.startsWith(basePath)) {
      throw new ApiException(400, "上传目录不合法");
    }
    Files.createDirectories(datePath);

    String originalName = safeOriginalName(file.getOriginalFilename());
    String storedName = uniqueStoredName(originalName);
    Path target = datePath.resolve(storedName).normalize();
    if (!target.startsWith(datePath)) {
      throw new ApiException(400, "上传文件名不合法");
    }

    try (InputStream inputStream = file.getInputStream()) {
      Files.copy(inputStream, target);
    }

    Map<String, Object> data = new LinkedHashMap<>();
    data.put("dateFolder", dateFolder);
    data.put("originalName", originalName);
    data.put("storedName", storedName);
    data.put("relativePath", dateFolder + "/" + storedName);
    data.put("absolutePath", target.toString());
    data.put("size", file.getSize());
    data.put("contentType", file.getContentType());
    return ApiResponse.ok(data);
  }

  private String safeOriginalName(String originalName) {
    String value = originalName == null ? "" : originalName.replace('\\', '/');
    int slash = value.lastIndexOf('/');
    if (slash >= 0) value = value.substring(slash + 1);
    value = value.replaceAll("[\\p{Cntrl}<>:\"/\\\\|?*]", "_").trim();
    if (value.isBlank() || ".".equals(value) || "..".equals(value)) {
      return "file";
    }
    return value;
  }

  private String uniqueStoredName(String originalName) {
    String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    int dot = originalName.lastIndexOf('.');
    if (dot <= 0 || dot == originalName.length() - 1) {
      return originalName + "-" + suffix;
    }
    return originalName.substring(0, dot) + "-" + suffix + originalName.substring(dot);
  }
}
