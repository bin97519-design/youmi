package com.youmi.api.admin;

import com.youmi.api.auth.PasswordHasher;
import com.youmi.api.common.ApiException;
import com.youmi.api.image.ImageGenerationProperties;
import com.youmi.api.platform.Platform;
import com.youmi.api.platform.PlatformRepository;
import com.youmi.api.shop.ShopRepository;
import java.math.BigDecimal;
import java.math.RoundingMode;
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
  private static final Long PROTECTED_ADMIN_USER_ID = 1L;
  private static final List<String> DEFAULT_USER_ROLES = List.of("USER");

  private final JdbcTemplate jdbcTemplate;
  private final PasswordHasher passwordHasher;
  private final ShopRepository shopRepository;
  private final PlatformRepository platformRepository;
  private final ImageGenerationProperties imageProps;

  public AdminService(JdbcTemplate jdbcTemplate, PasswordHasher passwordHasher,
      ShopRepository shopRepository, PlatformRepository platformRepository,
      ImageGenerationProperties imageProps) {
    this.jdbcTemplate = jdbcTemplate;
    this.passwordHasher = passwordHasher;
    this.shopRepository = shopRepository;
    this.platformRepository = platformRepository;
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
               u.shop_id, s.`name` AS shop_name,
               p.id AS shop_platform_id, p.code AS shop_platform_code,
               COALESCE(p.name, s.platform) AS shop_platform,
               u.created_by, creator.account AS creator_account,
               creator.nickname AS creator_nickname,
               u.created_at, u.updated_at
        FROM ym_sys_user u
        LEFT JOIN ym_shop s ON s.id = u.shop_id
        LEFT JOIN ym_platform p ON p.id = s.platform_id
        LEFT JOIN ym_sys_user creator ON creator.id = u.created_by
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
  public AdminDtos.UserRow createUser(AdminDtos.UserCreateRequest request, Long createdBy) {
    String account = normalizeRequired(request.account(), "账号不能为空");
    String password = normalizeRequired(request.password(), "密码不能为空");
    String nickname = StringUtils.hasText(request.nickname()) ? request.nickname().trim() : account;
    String status = normalizeStatus(request.status());
    int miValue = 0;
    String planName = StringUtils.hasText(request.planName()) ? request.planName().trim() : "普通用户";
    Long shopId = request.shopId();
    String shopName = request.shopName();

    /* 优先用已传的 shopId；若未传但给了 shopName，则按名称查找或自动创建 */
    if (shopId == null && StringUtils.hasText(shopName)) {
      String normalizedShopName = shopName.trim();
      boolean platformSpecified =
          request.shopPlatformId() != null || StringUtils.hasText(request.shopPlatform());
      Optional<Long> existing = platformSpecified
          ? shopRepository.findIdByNameAndPlatformId(
              normalizedShopName,
              resolvePlatform(request.shopPlatformId(), request.shopPlatform()).id())
          : shopRepository.findIdByName(normalizedShopName);
      if (existing.isPresent()) {
        shopId = existing.get();
      } else {
        Platform platform = resolvePlatform(request.shopPlatformId(), request.shopPlatform());
        String code = "SHOP-" + UUID.randomUUID().toString().replace("-", "").substring(0, 8).toUpperCase(Locale.ROOT);
        shopId = shopRepository.insert(
            normalizedShopName,
            code,
            platform.id(),
            platform.name(),
            "ACTIVE");
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
            INSERT INTO ym_sys_user (account, phone, nickname, password_hash, password_salt, status, mi_value, plan_name, shop_id, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        ps.setObject(10, createdBy);
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
    StringBuilder sql = new StringBuilder("UPDATE ym_sys_user SET phone = ?, nickname = ?, status = ?, plan_name = ?");
    List<Object> args = new ArrayList<>();
    args.add(blankToNull(request.phone()));
    args.add(StringUtils.hasText(request.nickname()) ? request.nickname().trim() : "未命名用户");
    args.add(normalizeStatus(request.status()));
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
  public void resetUserPassword(Long id, AdminDtos.UserPasswordResetRequest request) {
    ensureUserExists(id);
    String password = normalizeRequired(
        request == null ? null : request.password(), "新密码不能为空");
    if (password.length() < 6) {
      throw new ApiException(400, "新密码不能少于6位");
    }
    if (password.length() > 64) {
      throw new ApiException(400, "新密码不能超过64位");
    }

    String salt = "youmi-" + UUID.randomUUID().toString().replace("-", "");
    jdbcTemplate.update(
        "UPDATE ym_sys_user SET password_hash = ?, password_salt = ? WHERE id = ?",
        passwordHasher.sha256(password, salt), salt, id);
  }

  @Transactional
  public void deleteUser(Long id) {
    if (PROTECTED_ADMIN_USER_ID.equals(id)) {
      throw new ApiException(403, "系统管理员账号不可删除");
    }
    ensureUserExists(id);
    jdbcTemplate.update("DELETE FROM ym_sys_user_role WHERE user_id = ?", id);
    jdbcTemplate.update("DELETE FROM ym_sys_user WHERE id = ?", id);
  }

  public AdminDtos.UserRow getUser(Long id) {
    String sql = """
        SELECT u.id, u.account, u.phone, u.nickname, u.status, u.mi_value, u.plan_name,
               u.shop_id, s.`name` AS shop_name,
               p.id AS shop_platform_id, p.code AS shop_platform_code,
               COALESCE(p.name, s.platform) AS shop_platform,
               u.created_by, creator.account AS creator_account,
               creator.nickname AS creator_nickname,
               u.created_at, u.updated_at
        FROM ym_sys_user u
        LEFT JOIN ym_shop s ON s.id = u.shop_id
        LEFT JOIN ym_platform p ON p.id = s.platform_id
        LEFT JOIN ym_sys_user creator ON creator.id = u.created_by
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
        modelImageStats(scopeUserId),
        providerSuccessStats(scopeUserId),
        modelDailyTrends(scopeUserId),
        shopDailyTrends(scopeUserId),
        userDailyTrends(scopeUserId));
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
               t.money_cost, t.error_message, t.created_at, t.updated_at, t.completed_at,
               t.image_urls, t.result_urls, t.persist_status
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
          SELECT DATE(created_at) AS day, COUNT(*) AS tasks,
                 SUM(CASE WHEN LOWER(status) IN ('failed', 'error', 'cancelled', 'canceled') THEN 1 ELSE 0 END) AS failed_tasks,
                 COALESCE(SUM(image_count), 0) AS images,
                 COALESCE(SUM(mi_cost), 0) AS mi_cost, COALESCE(SUM(money_cost), 0) AS money_cost
          FROM ym_image_task
          WHERE created_at >= DATE_SUB(CURRENT_DATE, INTERVAL 13 DAY) AND user_id = ?
          GROUP BY DATE(created_at)
          ORDER BY day
          """;
      args = new Object[]{scopeUserId};
    } else {
      sql = """
          SELECT DATE(created_at) AS day, COUNT(*) AS tasks,
                 SUM(CASE WHEN LOWER(status) IN ('failed', 'error', 'cancelled', 'canceled') THEN 1 ELSE 0 END) AS failed_tasks,
                 COALESCE(SUM(image_count), 0) AS images,
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
        rs.getLong("failed_tasks"),
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
          """;
      args = new Object[]{scopeUserId};
    } else {
      sql = """
          SELECT COALESCE(requested_model, model, 'unknown') AS model, COUNT(*) AS tasks,
                 COALESCE(SUM(image_count), 0) AS images, COALESCE(SUM(mi_cost), 0) AS mi_cost,
                 COALESCE(SUM(money_cost), 0) AS money_cost
          FROM ym_image_task
          GROUP BY COALESCE(requested_model, model, 'unknown')
          """;
      args = new Object[]{};
    }
    List<AdminDtos.ModelImageStat> rawStats = jdbcTemplate.query(sql, (rs, rowNum) -> new AdminDtos.ModelImageStat(
        rs.getString("model"),
        rs.getLong("tasks"),
        rs.getInt("images"),
        rs.getInt("mi_cost"),
        rs.getBigDecimal("money_cost")), args);

    Map<String, AdminDtos.ModelImageStat> merged = new LinkedHashMap<>();
    for (AdminDtos.ModelImageStat stat : rawStats) {
      String model = imageProps.canonicalDisplayModel(stat.model());
      merged.merge(model, new AdminDtos.ModelImageStat(
              model, stat.tasks(), stat.images(), stat.miCost(), stat.moneyCost()),
          (left, right) -> new AdminDtos.ModelImageStat(
              model,
              left.tasks() + right.tasks(),
              left.images() + right.images(),
              left.miCost() + right.miCost(),
              left.moneyCost().add(right.moneyCost())));
    }
    List<AdminDtos.ModelImageStat> result = new ArrayList<>(merged.values());
    result.sort((left, right) -> Long.compare(right.tasks(), left.tasks()));
    return result.size() > 12 ? new ArrayList<>(result.subList(0, 12)) : result;
  }

  private List<AdminDtos.DimensionImageTrend> modelDailyTrends(Long scopeUserId) {
    String where = scopeUserId == null ? "" : " AND t.user_id = ?";
    String sql = """
        SELECT COALESCE(t.requested_model, t.model, 'unknown') AS dimension_key,
               COALESCE(t.requested_model, t.model, 'unknown') AS dimension_label,
               DATE(t.created_at) AS day,
               COUNT(*) AS tasks,
               SUM(CASE WHEN LOWER(t.status) IN ('failed', 'error', 'cancelled', 'canceled') THEN 1 ELSE 0 END) AS failed_tasks,
               COALESCE(SUM(t.image_count), 0) AS images,
               COALESCE(SUM(t.mi_cost), 0) AS mi_cost,
               COALESCE(SUM(t.money_cost), 0) AS money_cost
        FROM ym_image_task t
        WHERE t.created_at >= DATE_SUB(CURRENT_DATE, INTERVAL 13 DAY)
        """ + where + """
        GROUP BY COALESCE(t.requested_model, t.model, 'unknown'), DATE(t.created_at)
        ORDER BY day
        """;
    return buildDimensionTrends(queryDimensionTrendRows(sql, scopeUserId), true);
  }

  private List<AdminDtos.DimensionImageTrend> shopDailyTrends(Long scopeUserId) {
    String where = scopeUserId == null ? "" : " AND t.user_id = ?";
    String sql = """
        SELECT COALESCE(CAST(s.id AS CHAR), 'unbound') AS dimension_key,
               CASE
                 WHEN s.id IS NULL THEN '未绑定店铺'
                 WHEN COALESCE(NULLIF(p.name, ''), NULLIF(s.platform, '')) IS NULL THEN s.name
                 ELSE CONCAT(s.name, '（', COALESCE(NULLIF(p.name, ''), NULLIF(s.platform, '')), '）')
               END AS dimension_label,
               DATE(t.created_at) AS day,
               COUNT(*) AS tasks,
               SUM(CASE WHEN LOWER(t.status) IN ('failed', 'error', 'cancelled', 'canceled') THEN 1 ELSE 0 END) AS failed_tasks,
               COALESCE(SUM(t.image_count), 0) AS images,
               COALESCE(SUM(t.mi_cost), 0) AS mi_cost,
               COALESCE(SUM(t.money_cost), 0) AS money_cost
        FROM ym_image_task t
        LEFT JOIN ym_sys_user u ON u.id = t.user_id
        LEFT JOIN ym_shop s ON s.id = u.shop_id
        LEFT JOIN ym_platform p ON p.id = s.platform_id
        WHERE t.created_at >= DATE_SUB(CURRENT_DATE, INTERVAL 13 DAY)
        """ + where + """
        GROUP BY s.id, s.name, p.name, s.platform, DATE(t.created_at)
        ORDER BY day
        """;
    return buildDimensionTrends(queryDimensionTrendRows(sql, scopeUserId), false);
  }

  private List<AdminDtos.DimensionImageTrend> userDailyTrends(Long scopeUserId) {
    String where = scopeUserId == null ? "" : " AND t.user_id = ?";
    String sql = """
        SELECT COALESCE(u.account, CONCAT('user-', t.user_id), 'unknown') AS dimension_key,
               COALESCE(NULLIF(u.nickname, ''), u.account, CONCAT('用户 #', t.user_id), '未知用户') AS dimension_label,
               DATE(t.created_at) AS day,
               COUNT(*) AS tasks,
               SUM(CASE WHEN LOWER(t.status) IN ('failed', 'error', 'cancelled', 'canceled') THEN 1 ELSE 0 END) AS failed_tasks,
               COALESCE(SUM(t.image_count), 0) AS images,
               COALESCE(SUM(t.mi_cost), 0) AS mi_cost,
               COALESCE(SUM(t.money_cost), 0) AS money_cost
        FROM ym_image_task t
        LEFT JOIN ym_sys_user u ON u.id = t.user_id
        WHERE t.created_at >= DATE_SUB(CURRENT_DATE, INTERVAL 13 DAY)
        """ + where + """
        GROUP BY t.user_id, u.account, u.nickname, DATE(t.created_at)
        ORDER BY day
        """;
    return buildDimensionTrends(queryDimensionTrendRows(sql, scopeUserId), false);
  }

  private List<RawDimensionTrend> queryDimensionTrendRows(String sql, Long scopeUserId) {
    Object[] args = scopeUserId == null ? new Object[]{} : new Object[]{scopeUserId};
    return jdbcTemplate.query(sql, (rs, rowNum) -> new RawDimensionTrend(
        rs.getString("dimension_key"),
        rs.getString("dimension_label"),
        new AdminDtos.DailyImageStat(
            rs.getString("day"),
            rs.getLong("tasks"),
            rs.getLong("failed_tasks"),
            rs.getInt("images"),
            rs.getInt("mi_cost"),
            rs.getBigDecimal("money_cost"))), args);
  }

  private List<AdminDtos.DimensionImageTrend> buildDimensionTrends(
      List<RawDimensionTrend> rows, boolean canonicalizeModel) {
    Map<String, TrendAccumulator> grouped = new LinkedHashMap<>();
    for (RawDimensionTrend row : rows) {
      String key = canonicalizeModel ? imageProps.canonicalDisplayModel(row.key()) : row.key();
      String label = canonicalizeModel ? key : row.label();
      TrendAccumulator accumulator = grouped.computeIfAbsent(key, ignored -> new TrendAccumulator(key, label));
      accumulator.add(row.daily());
    }

    List<AdminDtos.DimensionImageTrend> result = grouped.values().stream()
        .map(TrendAccumulator::toView)
        .sorted((left, right) -> Long.compare(right.totalTasks(), left.totalTasks()))
        .toList();
    return new ArrayList<>(result);
  }

  private record RawDimensionTrend(
      String key,
      String label,
      AdminDtos.DailyImageStat daily) {
  }

  private static final class TrendAccumulator {
    private final String key;
    private final String label;
    private final Map<String, AdminDtos.DailyImageStat> daily = new LinkedHashMap<>();

    private TrendAccumulator(String key, String label) {
      this.key = key;
      this.label = label;
    }

    private void add(AdminDtos.DailyImageStat point) {
      daily.merge(point.day(), point, TrendAccumulator::mergeDaily);
    }

    private AdminDtos.DimensionImageTrend toView() {
      List<AdminDtos.DailyImageStat> points = new ArrayList<>(daily.values());
      points.sort((left, right) -> left.day().compareTo(right.day()));
      long totalTasks = points.stream().mapToLong(AdminDtos.DailyImageStat::tasks).sum();
      return new AdminDtos.DimensionImageTrend(key, label, totalTasks, points);
    }

    private static AdminDtos.DailyImageStat mergeDaily(
        AdminDtos.DailyImageStat left, AdminDtos.DailyImageStat right) {
      BigDecimal leftMoney = left.moneyCost() == null ? BigDecimal.ZERO : left.moneyCost();
      BigDecimal rightMoney = right.moneyCost() == null ? BigDecimal.ZERO : right.moneyCost();
      return new AdminDtos.DailyImageStat(
          left.day(),
          left.tasks() + right.tasks(),
          left.failedTasks() + right.failedTasks(),
          left.images() + right.images(),
          left.miCost() + right.miCost(),
          leftMoney.add(rightMoney));
    }
  }

  private List<AdminDtos.ProviderSuccessStat> providerSuccessStats(Long scopeUserId) {
    String where = scopeUserId == null ? "" : " WHERE user_id = ?";
    String sql = """
        SELECT COALESCE(provider, 'unknown') AS provider,
               COUNT(*) AS total_tasks,
               SUM(CASE WHEN LOWER(status) IN ('completed', 'succeeded', 'success', 'done') THEN 1 ELSE 0 END) AS successful_tasks,
               SUM(CASE WHEN LOWER(status) IN ('failed', 'error', 'cancelled', 'canceled') THEN 1 ELSE 0 END) AS failed_tasks
        FROM ym_image_task
        """ + where + " GROUP BY COALESCE(provider, 'unknown')";
    Object[] args = scopeUserId == null ? new Object[]{} : new Object[]{scopeUserId};
    List<AdminDtos.ProviderSuccessStat> rawStats = jdbcTemplate.query(sql, (rs, rowNum) -> {
      long successful = rs.getLong("successful_tasks");
      long failed = rs.getLong("failed_tasks");
      return new AdminDtos.ProviderSuccessStat(
          canonicalProvider(rs.getString("provider")),
          rs.getLong("total_tasks"),
          successful,
          failed,
          successful + failed,
          null);
    }, args);

    Map<String, AdminDtos.ProviderSuccessStat> merged = new LinkedHashMap<>();
    for (AdminDtos.ProviderSuccessStat stat : rawStats) {
      merged.merge(stat.provider(), stat, (left, right) -> new AdminDtos.ProviderSuccessStat(
          left.provider(),
          left.totalTasks() + right.totalTasks(),
          left.successfulTasks() + right.successfulTasks(),
          left.failedTasks() + right.failedTasks(),
          left.finishedTasks() + right.finishedTasks(),
          null));
    }

    List<AdminDtos.ProviderSuccessStat> result = new ArrayList<>();
    for (AdminDtos.ProviderSuccessStat stat : merged.values()) {
      BigDecimal rate = stat.finishedTasks() == 0 ? null : BigDecimal.valueOf(stat.successfulTasks())
          .multiply(BigDecimal.valueOf(100))
          .divide(BigDecimal.valueOf(stat.finishedTasks()), 1, RoundingMode.HALF_UP);
      result.add(new AdminDtos.ProviderSuccessStat(
          stat.provider(), stat.totalTasks(), stat.successfulTasks(), stat.failedTasks(), stat.finishedTasks(), rate));
    }
    result.sort((left, right) -> Integer.compare(providerOrder(left.provider()), providerOrder(right.provider())));
    return result;
  }

  private String canonicalProvider(String provider) {
    if (provider == null || provider.isBlank()) return "unknown";
    String value = provider.trim().toLowerCase(Locale.ROOT);
    if (value.startsWith("apimart")) return "apimart";
    if (value.startsWith("gettoken")) return "gettoken";
    if (value.startsWith("lk888")) return "lk888";
    if (value.startsWith("proxy")) return "proxy";
    if (value.startsWith("agnes")) return "agnes";
    return value;
  }

  private int providerOrder(String provider) {
    return switch (provider) {
      case "apimart" -> 0;
      case "gettoken" -> 1;
      case "lk888" -> 2;
      case "proxy" -> 3;
      case "agnes" -> 4;
      default -> 10;
    };
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
        consumedMi(id),
        rs.getString("plan_name"),
        nullableLong(rs, "shop_id"),
        rs.getString("shop_name"),
        nullableLong(rs, "shop_platform_id"),
        rs.getString("shop_platform_code"),
        rs.getString("shop_platform"),
        nullableLong(rs, "created_by"),
        rs.getString("creator_account"),
        rs.getString("creator_nickname"),
        findUserRoleCodes(id),
        time(rs, "created_at"),
        time(rs, "updated_at"));
  }

  private int consumedMi(Long userId) {
    try {
      Integer total = jdbcTemplate.queryForObject(
          "SELECT COALESCE(SUM(price), 0) FROM ym_mi_value_log"
              + " WHERE user_id = ? AND status = 'SUCCESS' AND biz_type IN ('IMAGE', 'VIDEO')",
          Integer.class, userId);
      return total == null ? 0 : total;
    } catch (org.springframework.dao.DataAccessException ignored) {
      // Compatibility for installations/tests upgrading before the ledger migration runs.
      return 0;
    }
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
    String model = imageProps.canonicalDisplayModel(rs.getString("model"));
    String requestedModel = rs.getString("requested_model");
    if (requestedModel != null && !requestedModel.isBlank()) {
      requestedModel = imageProps.canonicalDisplayModel(requestedModel);
    }
    return new AdminDtos.ImageTaskRow(
        rs.getLong("id"),
        rs.getString("task_id"),
        nullableLong(rs, "user_id"),
        rs.getString("user_name"),
        rs.getString("provider"),
        rs.getString("prompt"),
        model,
        requestedModel,
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
        isFallback,
        rs.getString("image_urls"),
        rs.getString("result_urls"),
        rs.getString("persist_status"));
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

  private Platform resolvePlatform(Long platformId, String legacyPlatform) {
    Platform platform;
    if (platformId != null) {
      platform = platformRepository.findById(platformId)
          .orElseThrow(() -> new ApiException(400, "请选择有效的平台"));
    } else if (StringUtils.hasText(legacyPlatform)) {
      platform = platformRepository.findByNameOrCode(legacyPlatform.trim())
          .orElseThrow(() -> new ApiException(400, "请选择有效的平台"));
    } else {
      platform = platformRepository.findByCode("OTHER")
          .orElseThrow(() -> new ApiException(500, "默认平台未初始化"));
    }
    if (!"ACTIVE".equals(platform.status())) {
      throw new ApiException(400, "请选择已启用的平台");
    }
    return platform;
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
