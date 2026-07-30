package com.youmi.api.admin;

import com.youmi.api.common.ApiResponse;
import java.nio.charset.StandardCharsets;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/finance")
public class FinanceController {
  private final AdminAuthService adminAuthService;
  private final FinanceService financeService;

  public FinanceController(AdminAuthService adminAuthService, FinanceService financeService) {
    this.adminAuthService = adminAuthService;
    this.financeService = financeService;
  }

  @GetMapping("/report")
  public ApiResponse<FinanceDtos.FinanceReport> report(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestParam(required = false) String dateFrom,
      @RequestParam(required = false) String dateTo,
      @RequestParam(required = false) Long platformId,
      @RequestParam(required = false) Long shopId) {
    adminAuthService.requireAdmin(authorization);
    return ApiResponse.ok(financeService.report(dateFrom, dateTo, platformId, shopId));
  }

  @GetMapping(value = "/export", produces = "text/csv;charset=UTF-8")
  public ResponseEntity<byte[]> export(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestParam(required = false) String dateFrom,
      @RequestParam(required = false) String dateTo,
      @RequestParam(required = false) Long platformId,
      @RequestParam(required = false) Long shopId) {
    adminAuthService.requireAdmin(authorization);
    FinanceDtos.FinanceReport report =
        financeService.report(dateFrom, dateTo, platformId, shopId);
    byte[] content = financeService.exportCsv(report);
    String filename = "youmi-finance-" + report.period().dateFrom()
        + "-to-" + report.period().dateTo() + ".csv";
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(new MediaType("text", "csv", StandardCharsets.UTF_8));
    headers.setContentDisposition(ContentDisposition.attachment().filename(filename).build());
    headers.setContentLength(content.length);
    return ResponseEntity.ok().headers(headers).body(content);
  }
}
