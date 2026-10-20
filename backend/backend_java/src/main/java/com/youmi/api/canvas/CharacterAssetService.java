package com.youmi.api.canvas;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class CharacterAssetService {
  private static final int MAX_CONFIG_BYTES = 65_536;
  private final CharacterAssetRepository repository;
  private final ObjectMapper objectMapper;

  public CharacterAssetService(CharacterAssetRepository repository, ObjectMapper objectMapper) {
    this.repository = repository;
    this.objectMapper = objectMapper;
  }

  public List<CharacterAssetDtos.CharacterAsset> list(Long userId) {
    return repository.findByUserId(requireOwner(userId));
  }

  public CharacterAssetDtos.CharacterAsset get(Long userId, String id) {
    return repository.findByIdAndUserId(validateId(id), requireOwner(userId))
        .orElseThrow(() -> new ApiException(404, "角色不存在或已删除"));
  }

  public CharacterAssetDtos.CharacterAsset save(Long userId, CharacterAssetDtos.SaveRequest request) {
    requireOwner(userId);
    CharacterAssetDtos.SaveRequest clean = validate(request);
    if (clean.id().isBlank()) return repository.create(userId, clean);
    return repository.update(clean.id(), userId, clean)
        .orElseThrow(() -> new ApiException(404, "角色不存在或无权修改"));
  }

  public void delete(Long userId, String id) {
    if (!repository.softDelete(validateId(id), requireOwner(userId))) {
      throw new ApiException(404, "角色不存在或无权删除");
    }
  }

  private Long requireOwner(Long userId) {
    if (userId == null || userId <= 0) throw new ApiException(401, "请先登录");
    return userId;
  }

  private CharacterAssetDtos.SaveRequest validate(CharacterAssetDtos.SaveRequest request) {
    if (request == null) throw new ApiException(400, "角色资料不能为空");
    String id = request.id() == null || request.id().isBlank() ? "" : validateId(request.id());
    String name = clean(request.name(), 80, "角色名称");
    if (name.isBlank()) throw new ApiException(400, "请输入角色名称");
    return new CharacterAssetDtos.SaveRequest(
        id, name, clean(request.description(), 4000, "角色描述"),
        clean(request.gender(), 80, "性别"), clean(request.ageGroup(), 80, "年龄"),
        clean(request.culture(), 80, "文化背景"), imageUrl(request.imageUrl()), imageUrl(request.coverUrl()),
        cleanConfig(request.config()));
  }

  private String validateId(String id) {
    String value = clean(id, 80, "角色标识");
    if (!value.matches("[A-Za-z0-9_-]{1,80}")) throw new ApiException(400, "角色标识无效");
    return value;
  }

  private String clean(String value, int limit, String label) {
    String result = value == null ? "" : value.trim();
    if (result.length() > limit) throw new ApiException(400, label + "不能超过 " + limit + " 个字符");
    if (result.indexOf('\0') >= 0) throw new ApiException(400, label + "包含无效字符");
    return result;
  }

  private String imageUrl(String value) {
    String result = clean(value, 4096, "图片地址");
    if (result.isBlank()) return "";
    try {
      URI uri = new URI(result);
      if (!("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme()))
          || uri.getHost() == null || uri.getUserInfo() != null) {
        throw new ApiException(400, "图片地址必须是已上传的 HTTP(S) 图片地址");
      }
    } catch (URISyntaxException error) {
      throw new ApiException(400, "图片地址格式无效");
    }
    // Stored as a reference only: this endpoint never fetches a client-provided URL.
    return result;
  }

  private Map<String, Object> cleanConfig(Map<String, Object> config) {
    if (config == null || config.isEmpty()) return Map.of();
    try {
      String json = objectMapper.writeValueAsString(config);
      if (json.getBytes(StandardCharsets.UTF_8).length > MAX_CONFIG_BYTES) {
        throw new ApiException(400, "角色配置不能超过 64 KiB");
      }
      JsonNode tree = objectMapper.readTree(json);
      validateJsonShape(tree, 0, new int[] {0});
      // Copy JSON input: no caller-owned mutable object is retained or interpreted.
      return objectMapper.convertValue(tree,
          new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});
    } catch (JsonProcessingException | IllegalArgumentException error) {
      throw new ApiException(400, "角色配置不是有效 JSON");
    }
  }

  private void validateJsonShape(JsonNode node, int depth, int[] visited) {
    if (depth > 12 || ++visited[0] > 4096) throw new ApiException(400, "角色配置层级或内容过多");
    if (node.isContainerNode()) {
      for (JsonNode child : node) validateJsonShape(child, depth + 1, visited);
    }
  }
}
