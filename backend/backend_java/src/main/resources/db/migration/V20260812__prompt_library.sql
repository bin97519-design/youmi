CREATE TABLE IF NOT EXISTS ym_prompt_library (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NULL,
  scope VARCHAR(16) NOT NULL DEFAULT 'PERSONAL',
  template_key VARCHAR(64) NULL,
  title VARCHAR(128) NOT NULL,
  content TEXT NOT NULL,
  category VARCHAR(32) NOT NULL DEFAULT 'OTHER',
  tags_json TEXT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_ym_prompt_library_template (template_key),
  INDEX idx_ym_prompt_library_user_updated (user_id, updated_at DESC),
  INDEX idx_ym_prompt_library_scope_category (scope, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ym_prompt_library_usage (
  prompt_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  use_count INT NOT NULL DEFAULT 0,
  last_used_at DATETIME NULL,
  PRIMARY KEY (prompt_id, user_id),
  INDEX idx_ym_prompt_library_usage_user (user_id, last_used_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO ym_prompt_library
  (user_id, scope, template_key, title, content, category, tags_json, source)
VALUES
  (NULL, 'PUBLIC', 'official-general-product', '通用商品视觉',
   '请以参考图中的产品为唯一产品主体，完整保留产品的造型、结构、材质、颜色和关键细节。画面采用真实商业摄影质感，构图清晰，光线自然，产品边缘干净，背景与产品风格协调。不要改变产品本身，不要添加无关商品、文字、水印或品牌标识。',
   'GENERAL', '["商品摄影","通用"]', 'PUBLIC'),
  (NULL, 'PUBLIC', 'official-main-image', '电商主图',
   '根据参考图生成电商主图。保持产品外观、结构、材质与颜色完全一致，产品作为画面唯一视觉中心，主体完整且比例准确。背景简洁高级，光影真实，适合电商平台展示。不要出现无关人物、文字、水印、Logo、变形或多余配件。',
   'MAIN_IMAGE', '["主图","电商"]', 'PUBLIC'),
  (NULL, 'PUBLIC', 'official-detail-page', '详情页视觉',
   '根据参考图生成电商详情页视觉。保持产品本身不变，围绕产品卖点组织场景、细节特写、材质展示和使用效果，画面层次清楚并保留足够文案空间。整体风格统一、真实可信，不要虚构产品功能，不要添加水印、Logo或乱码文字。',
   'DETAIL', '["详情页","卖点"]', 'PUBLIC'),
  (NULL, 'PUBLIC', 'official-scene-image', '真实使用场景',
   '将参考图中的产品自然放入符合其用途的真实生活场景，保持产品造型、材质、颜色和比例不变。场景空间完整，光线方向统一，接触阴影自然，产品与环境融合但仍是视觉重点。不要改变产品，不要添加不相关物体、文字、水印或Logo。',
   'SCENE', '["场景图","真实感"]', 'PUBLIC'),
  (NULL, 'PUBLIC', 'official-selling-point', '核心卖点展示',
   '围绕参考图中的产品制作核心卖点视觉，使用清晰构图突出产品的材质、结构、功能或使用体验。产品外观必须与参考图一致，信息层级明确，并为后续文案排版预留空间。不要生成虚假功能、错误结构、乱码文字、水印或品牌标识。',
   'SELLING_POINT', '["卖点图","功能展示"]', 'PUBLIC'),
  (NULL, 'PUBLIC', 'official-image-edit', '参考图局部修改',
   '只修改我明确指定的内容，其余画面全部保持不变，包括产品、人物、构图、镜头、比例、材质、颜色、光线和背景。修改区域要与原图自然融合，边缘与透视准确。不要额外添加元素，不要改变未指定区域，不要出现文字、水印或Logo。',
   'EDIT', '["改图","局部修改"]', 'PUBLIC')
ON DUPLICATE KEY UPDATE
  title = VALUES(title),
  content = VALUES(content),
  category = VALUES(category),
  tags_json = VALUES(tags_json),
  source = VALUES(source);
