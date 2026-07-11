package com.youmi.api.admin;

import com.youmi.api.auth.PasswordHasher;
import com.youmi.api.common.ApiException;
import com.youmi.api.image.ImageGenerationProperties;
import com.youmi.api.shop.ShopRepository;
import java.math.BigDecimal;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class AdminService {
  private static final List<String> DEFAULT_USER_ROLES = List.of("USER");

  private final JdbcTemplate jdbcTemplate;
  private final PasswordHasher passwordHasher;
  private final ShopRepository shopRepository;
  private final ImageGenerationProperties imageProps;

  public AdminService(JdbcTemplate jdbcTemplate, PasswordHasher passwordHasher,
      ShopRepository shopRepository, ImageGenerationProperties imageProps) {
    this.jdbcTemplate = jdbcTemplate;
    this.passwordHasher = passwordHasher;
    this.shopRepository = shopRepository;
    this.imageProps = imageProps;
  }

  public AdminDtos.ConsoleOverview overview(Long scopeUserId) {
    Map<String, Object> users = new LinkedHashMap<>();
    if (scopeUserId == null) {
      users.put("total", jdbcTemplate.queryForObject("SELECT COUNT(*) FROM ym_sys_user", Long.class));
      users.put("active", jdbcTemplate.queryForObject("SELECT COUNT(*) FROM ym_sys_user WHERE status = 'ACTIVE'", Long.class));
    } else {
      users.put("total", 1L);
      users.put("active", jdbcTemplate.queryForObject("SELECT COUNT(*) FROM ym_sys_user WHERE id = ? AND status = 'ACTIVE'", Long.class, scopeUserId));
    }

    Map<String, Object> roles = new LinkedHashMap<>();
    if (scopeUserId == null) {
      roles.put("total", jdbcTemplate.queryForObject("SELECT COUNT(*) FROM ym_sys_role", Long.class));
    } else {
      roles.put("total", jdbcTemplate.queryForObject(
          "SELECT COUNT(DISTINCT r.id) FROM ym_sys_role r INNER JOIN ym_sys_user_role ur ON ur.role_id = r.id WHERE ur.user_id = ?",
          Long.class, scopeUserId));
    }

    AdminDtos.ImageStatsSummary summary = imageSummary(scopeUserId);
    Map<String, Object> images = new LinkedHashMap<>();
    images.put("totalTasks", summary.totalTasks());
    images.put("completedTasks", summary.completedTasks());
    images.put("totalImages", summary.totalImages());
    images.put("totalMiCost", summary.totalMiCost());

    return new AdminDtos.ConsoleOverview(users, roles, images);
  }

  public List<AdminDtos.UserRow> listUsers(Long shopId) {
    StringBuilder sql = new StringBuilder("""
        SELECT u.id, u.account, u.phone, u.nickname, u.status, u.mi_value, u.plan_name,
               u.shop_id, s.`name` AS shop_name, s.platform AS shop_platform, u.created_at, u.updated_at
        FROM ym_sys_user u
        LEFT JOIN ym_shop s ON s.id = u.shop_id
        """);
    List<Object> args = new ArrayList<>();
    if (shopId != null) {
      sql.append(" WHERE u.shop_id = ?");
      args.add(shopId);
    }
    sql.append(" ORDER BY u.id DESC");
    return jdbcTemplate.query(sql.toString(), (rs, rowNum) -> mapUser(rs), args.toArray());
  }

  @Transactional
  public AdminDtos.UserRow createUser(AdminDtos.UserCreateRequest request) {
    String account = normalizeRequired(request.account(), "账号不能为空");
    String password = normalizeRequired(request.password(), "密码不能为空");
    String nickname = StringUtils.hasText(request.nickname()) ? request.nickname().trim() : account;
    String status = normalizeStatus(request.status());
    int miValue = request.miValue() == null ? 0 : Math.max(0, request.miValue());
    String planName = StringUtils.hasText(request.planName()) ? request.planName().trim() : "普通用户";
    Long shopId = request.shopId();
    String shopName = request.shopName();

    /* 优先用已传的 shopId；若未传但给了 shopName，则按名称查找或自动创建 */
    if (shopId == null && StringUtils.hasText(shopName)) {
      Optional<Long> existing = shopRepository.findIdByName(shopName.trim());
      if (existing.isPresent()) {
        shopId = existing.get();
      } else {
        String code = "SHOP-" + UUID.randomUUID().toString().replace("-", "").substring(0, 8).toUpperCase(Locale.ROOT);
        String platform = StringUtils.hasText(request.shopPlatform()) ? request.shopPlatform().trim() : "manual";
        shopId = shopRepository.insert(shopName.trim(), code, platform, "ACTIVE");
      }
    }
    if (shopId != null && !shopRepository.existsActiveById(shopId)) {
      throw new ApiException(400, "请选择有效的店铺");
    }
    final Long resolvedShopId = shopId; /* effectively final，供 lambda 捕获 */
    String salt = "youmi-" + UUID.randomUUID().toString().replace("-", "");
    String hash = passwordHasher.sha256(password, salt);

    KeyHolder keyHolder = new GeneratedKeyHolder();
    try {
      jdbcTemplate.update(connection -> {
        PreparedStatement ps = connection.prepareStatement("""
            INSERT INTO ym_sys_user (account, phone, nickname, password_hash, password_salt, status, mi_value, plan_name, shop_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, Statement.RETURN_GENERATED_KEYS);
        ps.setString(1, account);
        ps.setString(2, blankToNull(request.phone()));
        ps.setString(3, nickname);
        ps.setString(4, hash);
        ps.setString(5, salt);
        ps.setString(6, status);
        ps.setInt(7, miValue);
        ps.setString(8, planName);
        ps.setObject(9, resolvedShopId);
        return ps;
      }, keyHolder);
    } catch (DuplicateKeyException exception) {
      throw new ApiException(400, "账号或手机号已存在");
    }

    Long id = keyHolder.getKey().longValue();
    replaceUserRoles(id, request.roles());
    return getUser(id);
  }

  @Transactional
  public AdminDtos.UserRow updateUser(Long id, AdminDtos.UserUpdateRequest request) {
    ensureUserExists(id);
    StringBuilder sql = new StringBuilder("UPDATE ym_sys_user SET phone = ?, nickname = ?, status = ?, mi_value = ?, plan_name = ?");
    List<Object> args = new ArrayList<>();
    args.add(blankToNull(request.phone()));
    args.add(StringUtils.hasText(request.nickname()) ? request.nickname().trim() : "未命名用户");
    args.add(normalizeStatus(request.status()));
    args.add(request.miValue() == null ? 0 : Math.max(0, request.miValue()));
    args.add(StringUtils.hasText(request.planName()) ? request.planName().trim() : "普通用户");

    if (StringUtils.hasText(request.password())) {
      String salt = "youmi-" + UUID.randomUUID().toString().replace("-", "");
      sql.append(", password_hash = ?, password_salt = ?");
      args.add(passwordHasher.sha256(request.password().trim(), salt));
      args.add(salt);
    }

    if (request.shopId() != null) {
      if (!shopRepository.existsActiveById(request.shopId())) {
        throw new ApiException(400, "请选择有效的店铺");
      }
      sql.append(", shop_id = ?");
      args.add(request.shopId());
      /* 同步更新店铺平台 */
      if (StringUtils.hasText(request.shopPlatform())) {
        jdbcTemplate.update("UPDATE ym_shop SET platform = ? WHERE id = ?", request.shopPlatform().trim(), request.shopId());
      }
    } else {
      sql.append(", shop_id = NULL");
    }

    sql.append(" WHERE id = ?");
    args.add(id);
    try {
      jdbcTemplate.update(sql.toString(), args.toArray());
    } catch (DuplicateKeyException exception) {
      throw new ApiException(400, "手机号已被占用");
    }

    replaceUserRoles(id, request.roles());
    return getUser(id);
  }

  @Transactional
  public void deleteUser(Long id) {
    ensureUserExists(id);
    jdbcTemplate.update("DELETE FROM ym_sys_user_role WHERE user_id = ?", id);
    jdbcTemplate.update("DELETE FROM ym_sys_user WHERE id = ?", id);
  }

  public AdminDtos.UserRow getUser(Long id) {
    String sql = """
        SELECT u.id, u.account, u.phone, u.nickname, u.status, u.mi_value, u.plan_name,
               u.shop_id, s.`name` AS shop_name, s.platform AS shop_platform, u.created_at, u.updated_at
        FROM ym_sys_user u
        LEFT JOIN ym_shop s ON s.id = u.shop_id
        WHERE u.id = ?
        """;
    List<AdminDtos.UserRow> rows = jdbcTemplate.query(sql, (rs, rowNum) -> mapUser(rs), id);
    if (rows.isEmpty()) throw new ApiException(404, "用户不存在");
    return rows.get(0);
  }

  public List<AdminDtos.RoleRow> listRoles() {
    String sql = """
        SELECT r.id, r.code, r.name, r.created_at, COUNT(ur.user_id) AS user_count
        FROM ym_sys_role r
        LEFT JOIN ym_sys_user_role ur ON ur.role_id = r.id
        GROUP BY r.id, r.code, r.name, r.created_at
        ORDER BY r.id
        """;
    return jdbcTemplate.query(sql, (rs, rowNum) -> mapRole(rs));
  }

  @Transactional
  public AdminDtos.RoleRow createRole(AdminDtos.RoleCreateRequest request) {
    String code = normalizeRoleCode(request.code());
    String name = normalizeRequired(request.name(), "角色名称不能为空");
    KeyHolder keyHolder = new GeneratedKeyHolder();
    try {
      jdbcTemplate.update(connection -> {
        PreparedStatement ps = connection.prepareStatement(
            "INSERT INTO ym_sys_role (code, name) VALUES (?, ?)",
            Statement.RETURN_GENERATED_KEYS);
        ps.setString(1, code);
        ps.setString(2, name);
        return ps;
      }, keyHolder);
    } catch (DuplicateKeyException exception) {
      throw new ApiException(400, "角色编码已存在");
    }
    Long id = keyHolder.getKey().longValue();
    replaceRolePermissions(id, request.permissions());
    return getRole(id);
  }

  @Transactional
  public AdminDtos.RoleRow updateRole(Long id, AdminDtos.RoleUpdateRequest request) {
    getRole(id);
    jdbcTemplate.update(
        "UPDATE ym_sys_role SET name = ? WHERE id = ?",
        normalizeRequired(request.name(), "角色名称不能为空"),
        id);
    replaceRolePermissions(id, request.permissions());
    return getRole(id);
  }

  @Transactional
  public void deleteRole(Long id) {
    getRole(id);
    jdbcTemplate.update("DELETE FROM ym_sys_user_role WHERE role_id = ?", id);
    jdbcTemplate.update("DELETE FROM ym_sys_role_permission WHERE role_id = ?", id);
    jdbcTemplate.update("DELETE FROM ym_sys_role WHERE id = ?", id);
  }

  public AdminDtos.RoleRow getRole(Long id) {
    String sql = """
        SELECT r.id, r.code, r.name, r.created_at, COUNT(ur.user_id) AS user_count
        FROM ym_sys_role r
        LEFT JOIN ym_sys_user_role ur ON ur.role_id = r.id
        WHERE r.id = ?
        GROUP BY r.id, r.code, r.name, r.created_at
        """;
    List<AdminDtos.RoleRow> rows = jdbcTemplate.query(sql, (rs, rowNum) -> mapRole(rs), id);
    if (rows.isEmpty()) throw new ApiException(404, "角色不存在");
    return rows.get(0);
  }

  public AdminDtos.ImageStatsResponse imageStats(Long scopeUserId, String dateFrom, String dateTo) {
    return new AdminDtos.ImageStatsResponse(
        imageSummary(scopeUserId),
        recentImageTasks(scopeUserId, dateFrom, dateTo),
        dailyImageStats(scopeUserId),
        modelImageStats(scopeUserId));
  }

  private AdminDtos.ImageStatsSummary imageSummary(Long scopeUserId) {
    String sql;
    Object[] args;
    if (scopeUserId != null) {
      sql = """
          SELECT
            COUNT(*) AS total_tasks,
            SUM(CASE WHEN status IN ('completed', 'succeeded', 'success', 'done') THEN 1 ELSE 0 END) AS completed_tasks,
            SUM(CASE WHEN status IN ('failed', 'error', 'cancelled', 'canceled') THEN 1 ELSE 0 END) AS failed_tasks,
            SUM(CASE WHEN status NOT IN ('completed', 'succeeded', 'success', 'done', 'failed', 'error', 'cancelled', 'canceled') THEN 1 ELSE 0 END) AS processing_tasks,
            SUM(CASE WHEN DATE(created_at) = CURRENT_DATE THEN 1 ELSE 0 END) AS today_tasks,
            COALESCE(SUM(image_count), 0) AS total_images,
            COALESCE(SUM(mi_cost), 0) AS total_mi_cost,
            COALESCE(SUM(money_cost), 0) AS total_money_cost
          FROM ym_image_task
          WHERE user_id = ?
          """;
      args = new Object[]{scopeUserId};
    } else {
      sql = """
          SELECT
            COUNT(*) AS total_tasks,
            SUM(CASE WHEN status IN ('completed', 'succeeded', 'success', 'done') THEN 1 ELSE 0 END) AS completed_tasks,
            SUM(CASE WHEN status IN ('failed', 'error', 'cancelled', 'canceled') THEN 1 ELSE 0 END) AS failed_tasks,
            SUM(CASE WHEN status NOT IN ('completed', 'succeeded', 'success', 'done', 'failed', 'error', 'cancelled', 'canceled') THEN 1 ELSE 0 END) AS processing_tasks,
            SUM(CASE WHEN DATE(created_at) = CURRENT_DATE THEN 1 ELSE 0 END) AS today_tasks,
            COALESCE(SUM(image_count), 0) AS total_images,
            COALESCE(SUM(mi_cost), 0) AS total_mi_cost,
            COALESCE(SUM(money_cost), 0) AS total_money_cost
          FROM ym_image_task
          """;
      args = new Object[]{};
    }
    return jdbcTemplate.queryForObject(sql, (rs, rowNum) -> new AdminDtos.ImageStatsSummary(
        rs.getLong("total_tasks"),
        rs.getLong("completed_tasks"),
        rs.getLong("failed_tasks"),
        rs.getLong("processing_tasks"),
        rs.getLong("today_tasks"),
        rs.getInt("total_images"),
        rs.getInt("total_mi_cost"),
        rs.getBigDecimal("total_money_cost")), args);
  }

  private List<AdminDtos.ImageTaskRow> recentImageTasks(Long scopeUserId, String dateFrom, String dateTo) {
    String baseSql = """
        SELECT t.id, t.task_id, t.user_id, u.nickname AS user_name, t.provider, t.prompt, t.model, t.requested_model,
               t.size, t.resolution, t.requested_count, t.status, t.progress, t.image_count, t.mi_cost,
               t.money_cost, t.error_message, t.created_at, t.updated_at, t.completed_at
        FROM ym_image_task t
        LEFT JOIN ym_sys_user u ON u.id = t.user_id
        WHERE 1=1
        """;
    StringBuilder sql = new StringBuilder(baseSql);
    List<Object> argList = new ArrayList<>();
    if (scopeUserId != null) {
      sql.append(" AND t.user_id = ?");
      argList.add(scopeUserId);
    }
    if (dateFrom != null && !dateFrom.isEmpty()) {
      sql.append(" AND DATE(t.created_at) >= ?");
      argList.add(dateFrom);
    }
    if (dateTo != null && !dateTo.isEmpty()) {
      sql.append(" AND DATE(t.created_at) <= ?");
      argList.add(dateTo);
    }
    sql.append(" ORDER BY t.created_at DESC LIMIT 500");
    return jdbcTemplate.query(sql.toString(), (rs, rowNum) -> mapImageTask(rs), argList.toArray());
  }

  private List<AdminDtos.DailyImageStat> dailyImageStats(Long scopeUserId) {
    String sql;
    Object[] args;
    if (scopeUserId != null) {
      sql = """
          SELECT DATE(created_at) AS day, COUNT(*) AS tasks, COALESCE(SUM(image_count), 0) AS images,
                 COALESCE(SUM(mi_cost), 0) AS mi_cost, COALESCE(SUM(money_cost), 0) AS money_cost
          FROM ym_image_task
          WHERE created_at >= DATE_SUB(CURRENT_DATE, INTERVAL 13 DAY) AND user_id = ?
          GROUP BY DATE(created_at)
          ORDER BY day
          """;
      args = new Object[]{scopeUserId};
    } else {
      sql = """
          SELECT DATE(created_at) AS day, COUNT(*) AS tasks, COALESCE(SUM(image_count), 0) AS images,
                 COALESCE(SUM(mi_cost), 0) AS mi_cost, COALESCE(SUM(money_cost), 0) AS money_cost
          FROM ym_image_task
          WHERE created_at >= DATE_SUB(CURRENT_DATE, INTERVAL 13 DAY)
          GROUP BY DATE(created_at)
          ORDER BY day
          """;
      args = new Object[]{};
    }
    return jdbcTemplate.query(sql, (rs, rowNum) -> new AdminDtos.DailyImageStat(
        rs.getString("day"),
        rs.getLong("tasks"),
        rs.getInt("images"),
        rs.getInt("mi_cost"),
        rs.getBigDecimal("money_cost")), args);
  }

  private List<AdminDtos.ModelImageStat> modelImageStats(Long scopeUserId) {
    String sql;
    Object[] args;
    if (scopeUserId != null) {
      sql = """
          SELECT COALESCE(requested_model, model, 'unknown') AS model, COUNT(*) AS tasks,
                 COALESCE(SUM(image_count), 0) AS images, COALESCE(SUM(mi_cost), 0) AS mi_cost,
                 COALESCE(SUM(money_cost), 0) AS money_cost
          FROM ym_image_task
          WHERE user_id = ?
          GROUP BY COALESCE(requested_model, model, 'unknown')
          ORDER BY tasks DESC
          LIMIT 12
          """;
      args = new Object[]{scopeUserId};
    } else {
      sql = """
          SELECT COALESCE(requested_model, model, 'unknown') AS model, COUNT(*) AS tasks,
                 COALESCE(SUM(image_count), 0) AS images, COALESCE(SUM(mi_cost), 0) AS mi_cost,
                 COALESCE(SUM(money_cost), 0) AS money_cost
          FROM ym_image_task
          GROUP BY COALESCE(requested_model, model, 'unknown')
          ORDER BY tasks DESC
          LIMIT 12
          """;
      args = new Object[]{};
    }
    return jdbcTemplate.query(sql, (rs, rowNum) -> new AdminDtos.ModelImageStat(
        rs.getString("model"),
        rs.getLong("tasks"),
        rs.getInt("images"),
        rs.getInt("mi_cost"),
        rs.getBigDecimal("money_cost")), args);
  }

  private AdminDtos.UserRow mapUser(ResultSet rs) throws SQLException {
    Long id = rs.getLong("id");
    return new AdminDtos.UserRow(
        id,
        rs.getString("account"),
        rs.getString("phone"),
        rs.getString("nickname"),
        rs.getString("status"),
        rs.getInt("mi_value"),
        rs.getString("plan_name"),
        nullableLong(rs, "shop_id"),
        rs.getString("shop_name"),
        rs.getString("shop_platform"),
        findUserRoleCodes(id),
        time(rs, "created_at"),
        time(rs, "updated_at"));
  }

  private AdminDtos.RoleRow mapRole(ResultSet rs) throws SQLException {
    Long id = rs.getLong("id");
    return new AdminDtos.RoleRow(
        id,
        rs.getString("code"),
        rs.getString("name"),
        findRolePermissions(id),
        rs.getInt("user_count"),
        time(rs, "created_at"));
  }

  private AdminDtos.ImageTaskRow mapImageTask(ResultSet rs) throws SQLException {
    /* 兜底判定：proxy 中转站（47.90.226.52）永远是 failover 备用通道，
       从不会被用户直接选择，因此 provider 字段等于 'proxy' 即代表该图由兜底通道生成。
       imageProps 已注入，预留用于将来可配置化的兜底通道识别。 */
    String provider = rs.getString("provider");
    boolean isFallback = provider != null && "proxy".equalsIgnoreCase(provider.trim());
    return new AdminDtos.ImageTaskRow(
        rs.getLong("id"),
        rs.getString("task_id"),
        nullableLong(rs, "user_id"),
        rs.getString("user_name"),
        rs.getString("provider"),
        rs.getString("prompt"),
        rs.getString("model"),
        rs.getString("requested_model"),
        rs.getString("size"),
        rs.getString("resolution"),
        rs.getInt("requested_count"),
        rs.getString("status"),
        rs.getInt("progress"),
        rs.getInt("image_count"),
        rs.getInt("mi_cost"),
        rs.getBigDecimal("money_cost"),
        rs.getString("error_message"),
        time(rs, "created_at"),
        time(rs, "updated_at"),
        time(rs, "completed_at"),
        isFallback);
  }

  private void ensureUserExists(Long id) {
    Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM ym_sys_user WHERE id = ?", Integer.class, id);
    if (count == null || count == 0) throw new ApiException(404, "用户不存在");
  }

  private void replaceUserRoles(Long userId, List<String> roleCodes) {
    List<String> codes = normalizeRoleCodes(roleCodes == null || roleCodes.isEmpty() ? DEFAULT_USER_ROLES : roleCodes);
    jdbcTemplate.update("DELETE FROM ym_sys_user_role WHERE user_id = ?", userId);
    for (String code : codes) {
      List<Long> roleIds = jdbcTemplate.queryForList("SELECT id FROM ym_sys_role WHERE code = ?", Long.class, code);
      if (roleIds.isEmpty()) continue;
      jdbcTemplate.update("INSERT IGNORE INTO ym_sys_user_role (user_id, role_id) VALUES (?, ?)", userId, roleIds.get(0));
    }
  }

  private void replaceRolePermissions(Long roleId, List<String> permissions) {
    jdbcTemplate.update("DELETE FROM ym_sys_role_permission WHERE role_id = ?", roleId);
    if (permissions == null) return;
    for (String permission : permissions) {
      if (!StringUtils.hasText(permission)) continue;
      jdbcTemplate.update(
          "INSERT IGNORE INTO ym_sys_role_permission (role_id, permission_code) VALUES (?, ?)",
          roleId,
          permission.trim());
    }
  }

  private List<String> findUserRoleCodes(Long userId) {
    String sql = """
        SELECT r.code
        FROM ym_sys_role r
        INNER JOIN ym_sys_user_role ur ON ur.role_id = r.id
        WHERE ur.user_id = ?
        ORDER BY r.id
        """;
    return jdbcTemplate.queryForList(sql, String.class, userId);
  }

  private List<String> findRolePermissions(Long roleId) {
    return jdbcTemplate.queryForList(
        "SELECT permission_code FROM ym_sys_role_permission WHERE role_id = ? ORDER BY permission_code",
        String.class,
        roleId);
  }

  private String normalizeRequired(String value, String message) {
    if (!StringUtils.hasText(value)) throw new ApiException(400, message);
    return value.trim();
  }

  private String normalizeStatus(String value) {
    String normalized = StringUtils.hasText(value) ? value.trim().toUpperCase(Locale.ROOT) : "ACTIVE";
    if (!List.of("ACTIVE", "DISABLED").contains(normalized)) return "ACTIVE";
    return normalized;
  }

  private String normalizeRoleCode(String value) {
    String code = normalizeRequired(value, "角色编码不能为空")
        .toUpperCase(Locale.ROOT)
        .replaceAll("[^A-Z0-9_:.-]", "_");
    if (code.length() > 64) code = code.substring(0, 64);
    return code;
  }

  private List<String> normalizeRoleCodes(List<String> values) {
    List<String> result = new ArrayList<>();
    for (String value : values) {
      if (!StringUtils.hasText(value)) continue;
      String code = normalizeRoleCode(value);
      if (!result.contains(code)) result.add(code);
    }
    return result.isEmpty() ? DEFAULT_USER_ROLES : result;
  }

  private String blankToNull(String value) {
    return StringUtils.hasText(value) ? value.trim() : null;
  }

  private Long nullableLong(ResultSet rs, String field) throws SQLException {
    long value = rs.getLong(field);
    return rs.wasNull() ? null : value;
  }

  private String time(ResultSet rs, String field) throws SQLException {
    Timestamp timestamp = rs.getTimestamp(field);
    if (timestamp == null) return null;
    LocalDateTime value = timestamp.toLocalDateTime();
    return value.toString();
  }
}
