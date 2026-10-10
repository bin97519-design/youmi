package com.youmi.api.admin;

import com.youmi.api.common.ApiException;
import com.youmi.api.image.ModelApiKeyDtos;
import com.youmi.api.image.ModelApiKeyService;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

@Service
public class AiFeatureMappingService {
  private static final Map<String, String> FEATURE_TYPES = Map.of(
      "canvas-image", ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION,
      "canvas-layering", ModelApiKeyService.MODEL_TYPE_VISION_REASONING,
      "canvas-agent", ModelApiKeyService.MODEL_TYPE_VISION_REASONING,
      "canvas-video", ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION);

  private final ModelApiKeyService modelApiKeys;
  private final AiFeatureMappingRepository repository;

  public AiFeatureMappingService(ModelApiKeyService modelApiKeys, AiFeatureMappingRepository repository) {
    this.modelApiKeys = modelApiKeys;
    this.repository = repository;
  }

  public List<AiFeatureMappingDtos.Mapping> list() {
    List<ModelApiKeyDtos.Row> keys = modelApiKeys.list();
    return List.of(
        mapping("canvas-image", "画布下拉模型生图", ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION,
            "dropdown", "按此处勾选的模型提供画布生图选项；同一模型按优先级降序、ID升序。",
            "由用户在画布模型下拉框选择", "无额外默认线路", keys),
        mapping("canvas-layering", "画布图片智能分层", ModelApiKeyService.MODEL_TYPE_VISION_REASONING,
            "system_default", "此功能没有模型下拉框，使用此处指定的默认识图推理模型。",
            preferredVisionRoute(keys), "指定模型不可用或调用失败时回退到讯飞视觉，再回退 DashScope。", keys),
        mapping("canvas-agent", "画布 Agent 模型", ModelApiKeyService.MODEL_TYPE_VISION_REASONING,
            "dropdown", "按此处勾选的模型提供 Agent 选项，并按模型标识关联对应配置。",
            "default 选项使用全局 Agent 配置；自定义模型使用对应识图推理模型配置。",
            "未选自定义模型时按现有 GEM / 全局 Agent 路由。", keys),
        mapping("canvas-video", "画布下拉模型视频生成", ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION,
            "dropdown", "按此处勾选的模型提供画布视频选项，并路由到对应配置。",
            "配置模型使用对应视频密钥；内置视频模型使用各自通道配置。",
            "无额外默认模型；任务按所选模型对应通道提交。", keys));
  }

  public AiFeatureMappingDtos.Mapping save(String featureCode, AiFeatureMappingDtos.SaveRequest request) {
    String type = FEATURE_TYPES.get(featureCode);
    if (type == null) throw new ApiException(404, "AI 功能映射不存在");
    List<ModelApiKeyDtos.Row> keys = modelApiKeys.list();
    if ("canvas-layering".equals(featureCode)) {
      Long id = request == null ? null : request.defaultApiKeyId();
      if (id == null) throw new ApiException(400, "请选择一个默认识图推理模型");
      if (id != null && keys.stream().noneMatch(key -> key.id().equals(id)
          && key.enabled() && type.equals(key.modelType()))) {
        throw new ApiException(400, "默认模型必须是已启用的识图推理模型");
      }
      repository.saveDefault(featureCode, id);
    } else {
      List<Long> ids = request == null || request.selectedApiKeyIds() == null ? List.of()
          : request.selectedApiKeyIds().stream().filter(java.util.Objects::nonNull).distinct().toList();
      Set<Long> validIds = keys.stream().filter(ModelApiKeyDtos.Row::enabled)
          .filter(key -> type.equals(key.modelType())).map(ModelApiKeyDtos.Row::id)
          .collect(Collectors.toSet());
      if (!validIds.containsAll(ids)) throw new ApiException(400, "只能选择已启用且类型匹配的模型密钥");
      repository.saveDropdown(featureCode, ids);
    }
    return list().stream().filter(row -> row.featureCode().equals(featureCode)).findFirst().orElseThrow();
  }

  private AiFeatureMappingDtos.Mapping mapping(String code, String name, String type, String mode,
      String policy, String defaultRoute, String fallbackRoute, List<ModelApiKeyDtos.Row> keys) {
    List<AiFeatureMappingDtos.KeyRoute> routes = keys.stream().filter(row -> type.equals(row.modelType()))
        .sorted(Comparator.comparingInt(ModelApiKeyDtos.Row::priority).reversed()
            .thenComparing(ModelApiKeyDtos.Row::id))
        .map(row -> new AiFeatureMappingDtos.KeyRoute(row.id(), row.name(), row.model(),
            row.provider(), row.priority(), row.enabled())).toList();
    AiFeatureMappingRepository.MappingState state = repository.find(code).orElse(null);
    boolean configured = state != null && state.configured();
    List<Long> selected = configured ? repository.selectedKeyIds(code) : routes.stream()
        .filter(AiFeatureMappingDtos.KeyRoute::enabled).map(AiFeatureMappingDtos.KeyRoute::apiKeyId).toList();
    Long defaultId = state == null ? null : state.defaultApiKeyId();
    String currentDefault = defaultId == null ? defaultRoute : routes.stream()
        .filter(route -> route.apiKeyId().equals(defaultId))
        .map(route -> route.apiKeyName() + " · " + route.model() + " · #" + route.apiKeyId())
        .findFirst().orElse("所选模型不可用");
    return new AiFeatureMappingDtos.Mapping(code, name, type, mode, policy, currentDefault,
        fallbackRoute, routes, configured, selected, defaultId);
  }

  private String preferredVisionRoute(List<ModelApiKeyDtos.Row> keys) {
    return keys.stream().filter(row -> ModelApiKeyService.MODEL_TYPE_VISION_REASONING.equals(row.modelType()))
        .filter(ModelApiKeyDtos.Row::enabled)
        .sorted(Comparator.comparingInt(ModelApiKeyDtos.Row::priority).reversed()
            .thenComparing(ModelApiKeyDtos.Row::id))
        .findFirst().map(row -> row.name() + " · " + row.model() + " · #" + row.id())
        .orElse("暂无启用的识图推理密钥，将尝试回退服务");
  }
}
