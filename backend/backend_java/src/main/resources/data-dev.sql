-- H2 compatible data initialization
MERGE INTO ym_sys_role (code, name) KEY (code)
VALUES ('ADMIN', '管理员'),
       ('USER', '普通用户'),
       ('OPERATOR', '运营'),
       ('DESIGNER', '设计师');

MERGE INTO ym_sys_user (id, account, phone, nickname, password_hash, password_salt, status, mi_value, plan_name) KEY (id)
VALUES
  (1, 'admin', '13900139000', '管理员', '00a3684242cc0e9ce9c301a29b0e91b17df11345ba5b11f0d42577c4c5255573', 'youmi-demo-salt', 'ACTIVE', 9999, '管理员'),
  (85296258, '85296258', '13800138000', '用户8529...', '00a3684242cc0e9ce9c301a29b0e91b17df11345ba5b11f0d42577c4c5255573', 'youmi-demo-salt', 'ACTIVE', 100, '普通用户');

MERGE INTO ym_sys_user_role (user_id, role_id) KEY (user_id, role_id)
VALUES (1, (SELECT id FROM ym_sys_role WHERE code = 'ADMIN'));

MERGE INTO ym_sys_user_role (user_id, role_id) KEY (user_id, role_id)
VALUES (1, (SELECT id FROM ym_sys_role WHERE code = 'USER'));

MERGE INTO ym_sys_user_role (user_id, role_id) KEY (user_id, role_id)
VALUES (85296258, (SELECT id FROM ym_sys_role WHERE code = 'USER'));

MERGE INTO ym_sys_role_permission (role_id, permission_code) KEY (role_id, permission_code)
VALUES ((SELECT id FROM ym_sys_role WHERE code = 'ADMIN'), 'console:all');

MERGE INTO ym_sys_role_permission (role_id, permission_code) KEY (role_id, permission_code)
VALUES ((SELECT id FROM ym_sys_role WHERE code = 'USER'), 'image:generate');

MERGE INTO ym_sys_role_permission (role_id, permission_code) KEY (role_id, permission_code)
VALUES ((SELECT id FROM ym_sys_role WHERE code = 'OPERATOR'), 'image:generate');

MERGE INTO ym_sys_role_permission (role_id, permission_code) KEY (role_id, permission_code)
VALUES ((SELECT id FROM ym_sys_role WHERE code = 'DESIGNER'), 'image:generate');

MERGE INTO ym_sys_role_permission (role_id, permission_code) KEY (role_id, permission_code)
VALUES ((SELECT id FROM ym_sys_role WHERE code = 'OPERATOR'), 'gallery:manage');
