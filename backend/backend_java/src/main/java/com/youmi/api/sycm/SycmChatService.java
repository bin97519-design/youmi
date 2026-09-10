package com.youmi.api.sycm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.youmi.api.common.ApiException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SycmChatService {
  private final JdbcTemplate jdbc;
  private final ObjectMapper mapper;

  public SycmChatService(JdbcTemplate jdbc, ObjectMapper mapper) {
    this.jdbc = jdbc;
    this.mapper = mapper;
  }

  @Transactional
  public SycmChatDtos.ImportResult ingest(long userId, SycmChatDtos.ImportRequest request) {
    if (request == null) throw bad("请求不能为空");
    String batchId = required(request.batchId(), "batchId", 128);
    String shopId = required(request.shopId(), "shopId", 128);
    String shopName = limited(request.shopName(), "shopName", 256);
    List<JsonNode> consultations = request.consultations() == null ? List.of() : request.consultations();
    List<JsonNode> messages = request.messages() == null ? List.of() : request.messages();
    if (consultations.size() > 500 || messages.size() > 1000) throw bad("单批最多 500 条咨询、1000 条聊天消息，请分批上传");
    if (consultations.isEmpty() && messages.isEmpty()) throw bad("至少上传一条咨询或聊天消息");

    // Validate the complete batch before making any changes.
    List<Object[]> consultationRows = new ArrayList<>();
    List<Object[]> messageRows = new ArrayList<>();
    for (JsonNode row : consultations) {
      validateRow(row);
      LocalDate date = date(value(row, "咨询日期", "dateId"));
      String agent = required(value(row, "客服ID", "accountId"), "客服ID", 128);
      String buyer = required(value(row, "买家ID", "buyerId"), "买家ID", 128);
      LocalDateTime start = time(value(row, "开始时间", "startedAt"));
      String end = value(row, "结束时间", "endedAt");
      String key = hash(mapper.valueToTree(List.of(userId, shopId, date.toString(), start.toString(), agent, buyer)));
      consultationRows.add(new Object[]{key, userId, shopId, shopName, Date.valueOf(date), agent, buyer,
          Timestamp.valueOf(start), end.isEmpty() ? null : Timestamp.valueOf(time(end)),
          limited(value(row, "dataId"), "dataId", 256), row.toString(), batchId});
    }
    for (JsonNode row : messages) {
      validateRow(row);
      LocalDate date = date(value(row, "咨询日期", "dateId"));
      String agent = required(value(row, "客服ID", "accountId"), "客服ID", 128);
      String buyer = required(value(row, "买家ID", "buyerId"), "买家ID", 128);
      String messageId = limited(value(row, "msgId", "messageId"), "msgId", 256);
      LocalDateTime sent = time(value(row, "gmtCreated", "sentAt"));
      // Message IDs are stable across overlapping collection windows; dataId is not part of this identity.
      JsonNode identity = messageId.isEmpty()
          ? mapper.valueToTree(List.of("fallback", sent.toString(), value(row, "userNickFrom"), value(row, "userNickTo"), value(row, "msg")))
          : mapper.valueToTree(List.of("message-id", messageId));
      String key = hash(mapper.valueToTree(List.of(userId, shopId, agent, buyer, identity)));
      messageRows.add(new Object[]{key, userId, shopId, shopName, Date.valueOf(date), agent, buyer,
          messageId, Timestamp.valueOf(sent), limited(value(row, "dataId"), "dataId", 256), row.toString(), batchId});
    }
    JsonNode canonicalRequest = canonical(mapper.valueToTree(request));
    if (canonicalRequest.toString().getBytes(StandardCharsets.UTF_8).length > 6 * 1024 * 1024) throw bad("单批 JSON 超过 6 MiB，请缩小批次");
    String requestHash = hash(canonicalRequest);
    try {
      requireShop(userId, shopId);
      try {
        jdbc.update("""
            INSERT INTO ym_sycm_import_batch
              (user_id, batch_id, shop_id, request_hash, consultation_count, message_count)
            VALUES (?, ?, ?, ?, ?, ?)
            """, userId, batchId, shopId, requestHash, consultations.size(), messages.size());
      } catch (DuplicateKeyException duplicate) {
        String previous = jdbc.queryForObject("""
            SELECT request_hash FROM ym_sycm_import_batch WHERE user_id = ? AND batch_id = ? FOR UPDATE
            """, String.class, userId, batchId);
        if (!requestHash.equals(previous)) throw new ApiException(409, "batchId 已用于不同的数据，请重试原批次或使用新的 batchId");
        return new SycmChatDtos.ImportResult(batchId, shopId, consultations.size(), messages.size(), true);
      }
      if (!consultationRows.isEmpty()) jdbc.batchUpdate("""
          INSERT INTO ym_sycm_consultation
            (record_key,user_id,shop_id,shop_name,consultation_date,agent_id,buyer_id,started_at,ended_at,data_id,raw_json,last_batch_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
          ON DUPLICATE KEY UPDATE shop_name=VALUES(shop_name),ended_at=VALUES(ended_at),
            data_id=VALUES(data_id),raw_json=VALUES(raw_json),last_batch_id=VALUES(last_batch_id),updated_at=CURRENT_TIMESTAMP(3)
          """, consultationRows);
      if (!messageRows.isEmpty()) jdbc.batchUpdate("""
          INSERT INTO ym_sycm_chat_message
            (record_key,user_id,shop_id,shop_name,consultation_date,agent_id,buyer_id,message_id,sent_at,data_id,raw_json,last_batch_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
          ON DUPLICATE KEY UPDATE shop_name=VALUES(shop_name),data_id=VALUES(data_id),raw_json=VALUES(raw_json),
            last_batch_id=VALUES(last_batch_id),updated_at=CURRENT_TIMESTAMP(3)
          """, messageRows);
      return new SycmChatDtos.ImportResult(batchId, shopId, consultations.size(), messages.size(), false);
    } catch (DataAccessException error) {
      // Do not expose SQL parameters (chat content or customer identities) via the global error handler.
      throw new ApiException(503, "聊天记录入库失败，本批次已回滚，请稍后使用相同 batchId 重试");
    }
  }

  public SycmChatDtos.Page list(long userId, String shopId, String startDate, String endDate,
      String agentId, String buyerId, int page, int pageSize) {
    shopId = required(shopId, "shopId", 128);
    if (page < 1 || page > 100000 || pageSize < 1 || pageSize > 500) throw bad("page 为 1–100000，pageSize 为 1–500");
    LocalDate start = blank(startDate) ? null : date(startDate);
    LocalDate end = blank(endDate) ? null : date(endDate);
    if (start != null && end != null && start.isAfter(end)) throw bad("开始日期不能晚于结束日期");
    StringBuilder where = new StringBuilder(" WHERE user_id=? AND shop_id=?");
    List<Object> args = new ArrayList<>(List.of(userId, shopId));
    if (start != null) { where.append(" AND consultation_date>=?"); args.add(Date.valueOf(start)); }
    if (end != null) { where.append(" AND consultation_date<=?"); args.add(Date.valueOf(end)); }
    if (!blank(agentId)) { where.append(" AND agent_id=?"); args.add(limited(agentId, "agentId", 128)); }
    if (!blank(buyerId)) { where.append(" AND buyer_id=?"); args.add(limited(buyerId, "buyerId", 128)); }
    try {
      requireShop(userId, shopId);
      Long total = jdbc.queryForObject("SELECT COUNT(*) FROM ym_sycm_chat_message" + where, Long.class, args.toArray());
      args.add(pageSize);
      args.add((long) (page - 1) * pageSize);
      List<JsonNode> rows = jdbc.query("SELECT raw_json FROM ym_sycm_chat_message" + where
          + " ORDER BY sent_at, record_key LIMIT ? OFFSET ?", (rs, n) -> {
            try { return mapper.readTree(rs.getString(1)); }
            catch (Exception e) { throw new ApiException(503, "已存聊天记录格式异常"); }
          }, args.toArray());
      return new SycmChatDtos.Page(total == null ? 0 : total, page, pageSize, rows);
    } catch (DataAccessException error) {
      throw new ApiException(503, "聊天记录查询失败，请稍后重试");
    }
  }

  private void requireShop(long userId, String shopId) {
    Integer count = jdbc.queryForObject("""
        SELECT COUNT(*) FROM ym_session_credential WHERE user_id=? AND platform='sycm' AND shop_id=?
        """, Integer.class, userId, shopId);
    if (count == null || count == 0) throw new ApiException(403, "当前账号没有该店铺的生意参谋凭证，不能读写此店铺聊天记录");
  }

  private void validateRow(JsonNode row) {
    if (row == null || !row.isObject()) throw bad("每条记录必须是 JSON 对象");
    if (row.toString().getBytes(StandardCharsets.UTF_8).length > 256 * 1024) throw bad("单条记录超过 256 KiB");
    for (String forbidden : List.of("cookies", "cookie", "token", "authorization", "password", "deviceToken")) {
      if (row.has(forbidden)) throw bad("请仅上传聊天业务数据，不要上传登录凭证字段");
    }
  }

  private JsonNode canonical(JsonNode node) {
    if (node.isObject()) {
      ObjectNode result = mapper.createObjectNode();
      List<String> fields = new ArrayList<>();
      node.fieldNames().forEachRemaining(fields::add);
      Collections.sort(fields);
      fields.forEach(k -> result.set(k, canonical(node.get(k))));
      return result;
    }
    if (node.isArray()) {
      var result = mapper.createArrayNode();
      node.forEach(item -> result.add(canonical(item)));
      return result;
    }
    return node;
  }

  private static String hash(JsonNode value) {
    try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.toString().getBytes(StandardCharsets.UTF_8))); }
    catch (Exception e) { throw new IllegalStateException("SHA-256 unavailable", e); }
  }

  private static LocalDate date(String value) {
    try { return value.matches("[0-9]{8}") ? LocalDate.parse(value, DateTimeFormatter.BASIC_ISO_DATE) : LocalDate.parse(value); }
    catch (Exception e) { throw bad("咨询日期必须是 yyyyMMdd 或 yyyy-MM-dd"); }
  }

  private static LocalDateTime time(String value) {
    try { return LocalDateTime.parse(value.trim().replace(' ', 'T')); }
    catch (Exception e) { throw bad("时间必须是北京时间 yyyy-MM-dd HH:mm:ss，可带毫秒"); }
  }

  private static String value(JsonNode node, String... keys) {
    for (String key : keys) {
      JsonNode value = node.get(key);
      if (value != null && !value.isNull() && value.isValueNode() && !value.asText().trim().isEmpty()) return value.asText().trim();
    }
    return "";
  }

  private static String required(String value, String field, int max) {
    String result = limited(value, field, max);
    if (result.isEmpty()) throw bad(field + " 不能为空");
    return result;
  }

  private static String limited(String value, String field, int max) {
    String result = value == null ? "" : value.trim();
    if (result.length() > max) throw bad(field + " 超过长度限制 " + max);
    return result;
  }

  private static boolean blank(String value) { return value == null || value.isBlank(); }
  private static ApiException bad(String message) { return new ApiException(400, message); }
}
