package com.youmi.api.canvas;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/**
 * 实证：CanvasRepository.save() 是否真的把 title 写入 ym_canvas_document.title。
 *
 * <p>直接构造 JdbcTemplate 指向真实 RDS（youmi_ai），绕过 HTTP / token，
 * 依次验证 INSERT 与 UPDATE 两条路径都会把 title 落库，并回读断言。
 *
 * <p>使用种子用户 85296258 与一个唯一的测试 docId，跑完即清理。
 */
public class CanvasRepositorySaveTitleTest {

  private static final String DOC_ID = "test_title_proof_" + System.nanoTime();
  private static final Long USER_ID = 85296258L;

  private CanvasRepository buildRepository() {
    DriverManagerDataSource ds = new DriverManagerDataSource();
    ds.setDriverClassName("com.mysql.cj.jdbc.Driver");
    ds.setUrl(
        "jdbc:mysql://rm-uf65sj38p60279hc04o.mysql.rds.aliyuncs.com:3306/youmi_ai"
            + "?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai"
            + "&allowPublicKeyRetrieval=true&useSSL=false");
    ds.setUsername("hm_rds");
    ds.setPassword("hm321@2023");
    JdbcTemplate jdbcTemplate = new JdbcTemplate(ds);
    return new CanvasRepository(jdbcTemplate, new ObjectMapper());
  }

  @Test
  public void titleIsPersistedToMysqlOnInsertAndUpdate() {
    CanvasRepository repo = buildRepository();
    CanvasPayload payload = new CanvasPayload();
    try {
      // 1) INSERT：新文档，title = 初始
      repo.save(new CanvasDocument(null, DOC_ID, USER_ID, "初始标题ABC", payload, "", false, 0, 0));
      CanvasDocument afterInsert = repo.findByDocIdAndUserId(DOC_ID, USER_ID).orElseThrow();
      Assertions.assertEquals("初始标题ABC", afterInsert.title(), "INSERT 后 title 未落库到 ym_canvas_document.title");

      // 2) UPDATE：修改 title（复用同一 docId + userId → 走 UPDATE 分支）
      repo.save(new CanvasDocument(null, DOC_ID, USER_ID, "改名后标题XYZ", payload, "", false, 0, 0));
      CanvasDocument afterUpdate = repo.findByDocIdAndUserId(DOC_ID, USER_ID).orElseThrow();
      Assertions.assertEquals("改名后标题XYZ", afterUpdate.title(), "UPDATE 后 title 未更新落库");

      System.out.println("[CanvasRepositorySaveTitleTest] OK: title 已落库并成功 UPDATE -> " + afterUpdate.title());
    } finally {
      repo.deleteByDocIdAndUserId(DOC_ID, USER_ID);
    }
  }
}
