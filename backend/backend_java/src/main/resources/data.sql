INSERT INTO ym_sys_role (code, name)
VALUES ('ADMIN', '管理员'), ('USER', '普通用户'), ('OPERATOR', '运营'), ('DESIGNER', '设计师')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO ym_sys_user (id, account, phone, nickname, password_hash, password_salt, status, mi_value, plan_name)
VALUES
  (1, 'admin', '13900139000', '管理员', '00a3684242cc0e9ce9c301a29b0e91b17df11345ba5b11f0d42577c4c5255573', 'youmi-demo-salt', 'ACTIVE', 9999, '管理员'),
  (85296258, '85296258', '13800138000', '用户8529...', '00a3684242cc0e9ce9c301a29b0e91b17df11345ba5b11f0d42577c4c5255573', 'youmi-demo-salt', 'ACTIVE', 100, '普通用户')
ON DUPLICATE KEY UPDATE
  phone = VALUES(phone),
  nickname = VALUES(nickname),
  password_hash = VALUES(password_hash),
  password_salt = VALUES(password_salt),
  status = VALUES(status),
  mi_value = VALUES(mi_value),
  plan_name = VALUES(plan_name);

INSERT IGNORE INTO ym_sys_user_role (user_id, role_id)
SELECT 1, id FROM ym_sys_role WHERE code IN ('ADMIN', 'USER');

INSERT IGNORE INTO ym_sys_user_role (user_id, role_id)
SELECT 85296258, id FROM ym_sys_role WHERE code = 'USER';

INSERT IGNORE INTO ym_sys_role_permission (role_id, permission_code)
SELECT id, 'console:all' FROM ym_sys_role WHERE code = 'ADMIN';

INSERT IGNORE INTO ym_sys_role_permission (role_id, permission_code)
SELECT id, 'image:generate' FROM ym_sys_role WHERE code IN ('USER', 'OPERATOR', 'DESIGNER');

INSERT IGNORE INTO ym_sys_role_permission (role_id, permission_code)
SELECT id, 'gallery:manage' FROM ym_sys_role WHERE code = 'OPERATOR';
