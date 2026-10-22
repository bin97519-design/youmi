package com.youmi.api.pricing;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.youmi.api.common.ApiException;
import com.youmi.api.image.ModelApiKeyService;
import com.youmi.api.image.ModelApiKeyService.ResolvedModelApiKey;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/** Read-only platform price snapshots; deliberately has no task, ledger or billing dependency. */
@Service
public class CanvasPricingService {
  private static final String SOURCE = "platform-pricing";
  private static final String NOTE = "平台算力×100，沿用本系统米值记账口径，不改变实际结算。实际消费以任务结算为准。";
  private static final Set<String> MODELS = Set.of("seedance-2.0-anci", "seedance-2.5-guanfang-anmiao",
      "minimax-h3", "kling-v3-omni-cankao", "kling-v3-omni-videoref", "kling-v3-omni-shouweizhen",
      "wan3.0-video-quannengcankao", "tt-image-2.5", "banana-2.1", "banana-pro");
  private static final Set<String> PARAMS = Set.of("version", "resolution", "duration", "ratio",
      "aspect_ratio", "aspectRatio", "mode", "refer_type", "keep_original_sound", "audio",
      "prompt_extend", "generate_audio", "web_search", "quality", "background", "size",
      "image_size", "imageSize", "thinkingLevel", "thinking_level", "thinkingBudget", "thinking_budget", "custom_size", "count", "n");
  private static final Set<String> MEDIA_IMAGE = Set.of("images", "image", "image_url", "image_urls");
  private static final Set<String> MEDIA_VIDEO = Set.of("video", "videos", "video_url", "video_urls");
  private static final Set<String> MEDIA_AUDIO = Set.of("audio_url", "audio_urls", "audios");
  private static final BigDecimal ZERO = BigDecimal.ZERO;
  private final ModelApiKeyService keys;
  private final ObjectMapper mapper;
  private final HttpClient http;
  private final Clock clock;
  private final LinkedHashMap<String, Snapshot> cache = new LinkedHashMap<>();
  private final ConcurrentHashMap<String, CompletableFuture<Snapshot>> inFlight = new ConcurrentHashMap<>();

  @Autowired
  public CanvasPricingService(ModelApiKeyService keys, ObjectMapper mapper) {
    this(keys, mapper, HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3))
        .followRedirects(HttpClient.Redirect.NEVER).build(), Clock.systemUTC());
  }

  CanvasPricingService(ModelApiKeyService keys, ObjectMapper mapper, HttpClient http, Clock clock) {
    this.keys = keys; this.mapper = mapper; this.http = http; this.clock = clock;
  }

  private record Reference(int images, int videos, int audios, BigDecimal videoSeconds, BigDecimal audioSeconds) {}
  private record Request(String kind, String model, String apiModel, Map<String, Object> params, Reference refs) {}
  private record Snapshot(JsonNode json, long fetched, long expires) {}
  private record Quote(BigDecimal value, boolean precharge) {}
  private static final class Unavailable extends RuntimeException {
    Unavailable(String message) { super(message); }
  }

  public CanvasPricingDtos.Estimate estimate(JsonNode body) {
    Request input = parse(body);
    String model = input.model();
    try {
      var credential = credential(input);
      model = canonical(credential.model());
      if (!MODELS.contains(model)) throw unavailable("该模型暂不支持参数估价");
      if (input.apiModel() != null && !model.equals(canonical(input.apiModel())))
        throw unavailable("所选模型与当前配置线路不一致，请重新选择模型");
      if (input.kind().equals("image") != Set.of("tt-image-2.5", "banana-2.1", "banana-pro").contains(model))
        throw unavailable("所选模型类型不匹配");
      URI origin = allowedOrigin(credential);
      Map<String, Object> params = normalize(input, credential, model);
      Snapshot snapshot = snapshot(credential, origin, model);
      JsonNode pricing = snapshot.json();
      if (!pricing.path("available_for_this_key").asBoolean(false))
        throw unavailable("当前模型密钥没有可用报价线路，请检查模型管理配置");
      if (!model.equals(canonical(pricing.path("name").asText())) || !input.kind().equals(pricing.path("type").asText()))
        throw unavailable("平台报价模型不匹配");
      if (!pricing.path("channel_groups").isArray()) throw unavailable("平台暂未返回可用报价");
      List<Quote> quotes = new ArrayList<>();
      for (JsonNode group : pricing.path("channel_groups")) {
        if (!group.path("is_active").asBoolean(false) || !group.path("in_key_whitelist").asBoolean(false)
            || group.path("excluded_for_this_key").asBoolean(false)) continue;
        if (!accepts(group, params, input.refs(), model)) continue;
        quotes.add(calculate(group, params, input, model));
      }
      if (quotes.isEmpty()) throw unavailable("当前参数组合没有可用报价线路");
      BigDecimal min = quotes.stream().map(Quote::value).min(BigDecimal::compareTo).orElseThrow();
      BigDecimal max = quotes.stream().map(Quote::value).max(BigDecimal::compareTo).orElseThrow();
      boolean same = min.compareTo(max) == 0;
      boolean precharge = quotes.stream().anyMatch(Quote::precharge);
      String message = (precharge ? "按平台规则估算预扣；" : "")
          + (same ? "按当前可用线路估算。" : "不同可用线路价格不同，显示候选价格范围。") + NOTE;
      return new CanvasPricingDtos.Estimate(true, same ? mi(min) : null, mi(min), mi(max), "米值",
          precharge ? "precharge" : "estimate", message, SOURCE, model,
          snapshot.fetched(), snapshot.expires(), "算力", same ? source(min) : null,
          source(min), source(max), 100);
    } catch (Unavailable ex) {
      return new CanvasPricingDtos.Estimate(false, null, null, null, "米值", "estimate",
          ex.getMessage(), SOURCE, model, null, null, "算力", null, null, null, 100);
    }
  }

  private Request parse(JsonNode body) {
    fields(body, Set.of("kind", "model", "apiModel", "params", "reference"), "估价请求");
    String kind = requiredText(body, "kind", 10);
    if (!Set.of("image", "video").contains(kind)) throw bad("kind 仅支持 image/video");
    String model = requiredText(body, "model", 180);
    String apiModel = body.hasNonNull("apiModel") ? requiredText(body, "apiModel", 180) : null;
    JsonNode parameters = body.path("params");
    if (!parameters.isObject() || parameters.size() > 24) throw bad("params 必须是标量参数对象");
    Map<String, Object> params = new LinkedHashMap<>();
    parameters.fields().forEachRemaining(entry -> {
      JsonNode value = entry.getValue();
      if (!PARAMS.contains(entry.getKey()) || !(value.isTextual() || value.isBoolean() || value.isNumber())
          || value.asText().length() > 100 || value.asText().contains("://") || value.asText().startsWith("data:"))
        throw bad("估价只接受模型标量参数，不接受提示词、密钥或素材地址");
      params.put(entry.getKey(), scalar(value));
    });
    JsonNode ref = body.path("reference");
    if (ref.isMissingNode() || ref.isNull()) ref = mapper.createObjectNode();
    fields(ref, Set.of("imageCount", "videoCount", "audioCount", "videoDurationSeconds", "audioDurationSeconds"), "参考素材");
    int images = count(ref, "imageCount", 100), videos = count(ref, "videoCount", 30), audios = count(ref, "audioCount", 30);
    BigDecimal videoSeconds = seconds(ref, "videoDurationSeconds"), audioSeconds = seconds(ref, "audioDurationSeconds");
    if ((videos == 0 && videoSeconds != null && videoSeconds.signum() > 0)
        || (audios == 0 && audioSeconds != null && audioSeconds.signum() > 0)) throw bad("参考素材数量与时长不一致");
    return new Request(kind, model, apiModel, params, new Reference(images, videos, audios, videoSeconds, audioSeconds));
  }

  private ResolvedModelApiKey credential(Request input) {
    String type = input.kind().equals("image") ? ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION : ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION;
    String feature = "canvas-" + input.kind();
    Optional<ResolvedModelApiKey> result;
    if (input.model().startsWith(ModelApiKeyService.FEATURE_ROUTE_OPTION_PREFIX)) {
      result = keys.resolveFeatureRouteOption(input.model(), type, feature);
    } else {
      String requested = selectedModel(input.model());
      // Legacy UI alias is ambiguous: its documented API identity must be explicit.
      if (input.model().equalsIgnoreCase("Kling 3.0") || input.model().equals("可灵-Omni")) {
        if (input.apiModel() == null || !canonical(input.apiModel()).startsWith("kling-v3-omni-"))
          throw unavailable("请先选择可灵-Omni 生成模式");
        requested = canonical(input.apiModel());
      }
      result = keys.resolve(requested, type, feature);
      if (result.isEmpty() && !requested.equals(input.model())) result = keys.resolve(input.model(), type, feature);
    }
    return result.orElseThrow(() -> unavailable("当前模型尚未配置可用密钥或绑定画布功能"));
  }

  private URI allowedOrigin(ResolvedModelApiKey credential) {
    try {
      URI uri = URI.create(credential.baseUrl());
      if ("https".equals(uri.getScheme()) && "api.lk888.ai".equalsIgnoreCase(uri.getHost())
          && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getRawUserInfo() == null
          && uri.getRawQuery() == null && uri.getRawFragment() == null
          && Set.of("", "/", "/api", "/api/", "/v1", "/v1/", "/api/v1", "/api/v1/").contains(uri.getPath())
          && credential.apiKey() != null && !credential.apiKey().isBlank()) return URI.create("https://api.lk888.ai");
    } catch (IllegalArgumentException ignored) { }
    throw unavailable("该配置线路暂不支持安全读取平台报价");
  }

  private Map<String, Object> normalize(Request input, ResolvedModelApiKey credential, String model) {
    Map<String, Object> params = new LinkedHashMap<>(input.params());
    alias(params, "aspect_ratio", "ratio");
    if (input.kind().equals("image")) {
      // The canvas size field is the request-level ratio, not the provider's native pixel size.
      if (params.containsKey("custom_size")) throw unavailable("自定义图片尺寸暂无可精确核对的报价规则");
      alias(params, "aspect_ratio", "size");
      params.remove("size");
      params.remove("ratio");
      if (model.startsWith("banana")) {
        alias(params, "aspectRatio", "aspect_ratio"); alias(params, "imageSize", "resolution");
        alias(params, "imageSize", "image_size"); alias(params, "thinkingLevel", "thinking_level");
        params.remove("aspect_ratio"); params.remove("resolution"); params.remove("image_size"); params.remove("thinking_level");
        if (model.equals("banana-pro")) params.put("n", 1);
      } else {
        alias(params, "resolution", "image_size");
        params.remove("image_size");
      }
      if (model.equals("tt-image-2.5") && !params.containsKey("version")) {
        Object configured = credential.defaultData().get("version");
        params.put("version", configured != null ? configured :
            credential.model().toLowerCase(Locale.ROOT).contains("sunburst") ? "sunburst" : "flare");
      }
      // These adapters merge managed defaults only after building the explicit generation parameters.
      for (var entry : credential.defaultData().entrySet()) {
        if (params.containsKey(entry.getKey())) continue;
        Object value = entry.getValue();
        if (!PARAMS.contains(entry.getKey()) || !(value instanceof String || value instanceof Number || value instanceof Boolean))
          throw unavailable("模型配置包含无法核对的默认入参，暂不能完整预估");
        params.put(entry.getKey(), value);
      }
    }
    if (model.equals("tt-image-2.5")) {
      if (!params.containsKey("version")) params.put("version", credential.model().toLowerCase(Locale.ROOT).contains("sunburst") ? "sunburst" : "flare");
      if (params.containsKey("size")) throw unavailable("自定义图片尺寸暂无可精确核对的报价规则");
      if (!params.containsKey("aspect_ratio") || equal(params.get("aspect_ratio"), "auto")) params.put("resolution", "auto");
    }
    if (model.equals("seedance-2.5-guanfang-anmiao") || model.equals("minimax-h3")) {
      boolean frames = input.refs().videos() == 0 && input.refs().audios() == 0
          && input.refs().images() >= 1 && input.refs().images() <= 2;
      params.put("mode", frames ? "shouweizhen" : "cankaosheng");
    }
    if (model.equals("kling-v3-omni-videoref") && equal(params.get("refer_type"), "base")) params.remove("duration");
    List<String> required = switch (model) {
      case "seedance-2.0-anci" -> List.of("version", "duration", "resolution");
      case "wan3.0-video-quannengcankao" -> List.of("version", "duration", "resolution");
      case "minimax-h3", "seedance-2.5-guanfang-anmiao" -> List.of("resolution");
      case "kling-v3-omni-cankao", "kling-v3-omni-shouweizhen" -> List.of("mode", "duration");
      case "kling-v3-omni-videoref" -> List.of("mode", "refer_type");
      default -> List.of();
    };
    for (String name : required) if (!present(params.get(name))) throw unavailable("请完善模型参数后再估价");
    return params;
  }

  private Snapshot snapshot(ResolvedModelApiKey credential, URI origin, String model) {
    String cacheKey = credential.id() + ":" + model + ":" + digest(credential.apiKey());
    long now = clock.millis();
    final long cacheCutoff = now;
    synchronized (cache) {
      cache.entrySet().removeIf(entry -> entry.getValue().expires() <= cacheCutoff);
      Snapshot hit = cache.get(cacheKey);
      if (hit != null) return hit;
    }
    CompletableFuture<Snapshot> pending = new CompletableFuture<>();
    CompletableFuture<Snapshot> existing = inFlight.putIfAbsent(cacheKey, pending);
    if (existing != null) {
      try { return existing.get(); }
      catch (InterruptedException ex) { Thread.currentThread().interrupt(); throw unavailable("报价查询已中断"); }
      catch (ExecutionException ex) { throw unavailable("平台报价暂不可用，请稍后重试"); }
    }
    try {
      Snapshot fresh = fetchSnapshot(credential, origin, model, now);
      synchronized (cache) {
        while (cache.size() >= 128) cache.remove(cache.keySet().iterator().next());
        cache.put(cacheKey, fresh);
      }
      pending.complete(fresh);
      return fresh;
    } catch (RuntimeException ex) {
      pending.completeExceptionally(ex);
      throw ex;
    } finally { inFlight.remove(cacheKey, pending); }
  }

  private Snapshot fetchSnapshot(ResolvedModelApiKey credential, URI origin, String model, long started) {
    // Requests are GET-only, same-origin, with redirects disabled. Never log upstream bodies/headers.
    JsonNode json;
    try {
      HttpRequest request = HttpRequest.newBuilder(origin.resolve("/api/v1/skills/models/" + model + "/pricing"))
          .timeout(Duration.ofSeconds(8)).header("Authorization", "Bearer " + credential.apiKey())
          .header("Accept", "application/json").GET().build();
      HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
      if (response.statusCode() < 200 || response.statusCode() >= 300) throw unavailable("平台报价暂不可用，请稍后重试");
      if (response.body() == null || response.body().length() > 2_000_000) throw unavailable("平台报价响应无效");
      json = mapper.readTree(response.body());
      if (json.has("code")) {
        if (json.path("code").asInt() != 200) throw unavailable("平台暂未提供该密钥的报价");
        json = json.path("data");
      }
      if (!json.isObject()) throw unavailable("平台报价响应无效");
    } catch (Unavailable ex) { throw ex; }
    catch (InterruptedException ex) { Thread.currentThread().interrupt(); throw unavailable("报价查询已中断"); }
    catch (Exception ex) { throw unavailable("平台报价暂不可用，请稍后重试"); }
    long expires = expiry(json, started);
    if (expires <= clock.millis()) throw unavailable("报价跨越价格时段，请稍后重新预估");
    return new Snapshot(json, started, expires);
  }

  private long expiry(JsonNode pricing, long now) {
    long expiry = now + 30_000;
    ZonedDateTime beijing = Instant.ofEpochMilli(now).atZone(ZoneId.of("Asia/Shanghai"));
    for (JsonNode group : pricing.path("channel_groups")) for (JsonNode discount : group.path("time_discounts")) {
      for (String field : List.of("start", "end")) try {
        String time = discount.path(field).asText();
        LocalTime boundary = time.equals("24:00") ? LocalTime.MIDNIGHT : LocalTime.parse(time);
        ZonedDateTime next = beijing.toLocalDate().atTime(boundary).atZone(beijing.getZone());
        if (time.equals("24:00")) next = next.plusDays(1);
        if (!next.isAfter(beijing)) next = next.plusDays(1);
        expiry = Math.min(expiry, next.toInstant().toEpochMilli());
      } catch (DateTimeException ignored) { expiry = Math.min(expiry, now + 5_000); }
    }
    return expiry;
  }

  private boolean accepts(JsonNode group, Map<String, Object> params, Reference refs, String model) {
    JsonNode supported = group.path("supported_options");
    if (!supported.isMissingNode() && !supported.isObject()) throw unavailable("平台线路约束格式尚不支持");
    var fields = supported.fields();
    while (fields.hasNext()) {
      var entry = fields.next();
      Object value = value(entry.getKey(), "", params, refs, model);
      if (present(value)) {
        if (!entry.getValue().isArray()) throw unavailable("平台线路约束格式尚不支持");
        if (value instanceof MediaCount) throw unavailable("平台素材格式限制尚不能完整估价");
        if (!contains(entry.getValue(), value)) return false;
      }
    }
    JsonNode rules = group.path("capability_rules");
    if (!rules.isMissingNode() && !rules.isArray()) throw unavailable("平台线路规则格式尚不支持");
    for (JsonNode rule : rules) {
      String effect = rule.path("effect").asText();
      if (effect.equals("ignore")) continue;
      if (!effect.equals("reject") || !rule.path("when").isArray()) throw unavailable("平台包含暂不支持的线路规则");
      boolean matches = true;
      boolean unknown = false;
      for (JsonNode condition : rule.path("when")) {
        try { if (!condition(condition, params, refs, model)) matches = false; }
        catch (Unavailable ex) { unknown = true; }
      }
      if (!matches) continue;
      if (unknown) throw unavailable("平台素材或线路限制尚不能完整核对");
      return false;
    }
    return true;
  }

  private record MediaCount(int count) {}
  // Documentation does not publish a per-family mapping of these three reference forms.
  private record ReferenceForm() {}
  private Object value(String name, String source, Map<String, Object> params, Reference refs, String model) {
    if (source.equals("internal") || name.equals("_quan_neng_mode")) return null;
    if (source.equals("derived")) {
      if (!name.equals("input_form")) throw unavailable("平台推导参数规则尚不支持");
      if (refs.images() + refs.videos() + refs.audios() == 0) return "wensheng";
      if (equal(params.get("mode"), "shouweizhen") && refs.videos() == 0 && refs.audios() == 0)
        return refs.images() == 1 ? "shouzhen" : refs.images() == 2 ? "shouweizhen" : "unknown";
      return new ReferenceForm();
    }
    if (!source.isBlank()) throw unavailable("平台包含暂不支持的参数来源");
    if (MEDIA_IMAGE.contains(name)) return new MediaCount(refs.images());
    if (MEDIA_VIDEO.contains(name)) return new MediaCount(refs.videos());
    if (MEDIA_AUDIO.contains(name)) return new MediaCount(refs.audios());
    return params.get(name);
  }

  private boolean condition(JsonNode c, Map<String, Object> params, Reference refs, String model) {
    Object value = value(c.path("param").asText(), c.path("source").asText(), params, refs, model);
    boolean present = present(value);
    return switch (c.path("op").asText()) {
      case "present" -> present;
      case "absent" -> !present;
      case "count_gt" -> countValue(value) > c.path("value").asInt();
      case "count_lt" -> countValue(value) < c.path("value").asInt();
      case "in", "not_in" -> {
        if (!present) yield false;
        if (value instanceof MediaCount || !c.path("values").isArray()) throw unavailable("素材内容规则不能用数量估算");
        boolean in;
        if (value instanceof ReferenceForm) {
          int matching = 0;
          for (String possible : List.of("cankaosheng", "quanneng", "quannengcankao"))
            if (contains(c.path("values"), possible)) matching++;
          if (matching > 0 && matching < 3) throw unavailable("平台未公开该模型参考素材类型推导，暂不能完整核对");
          in = matching == 3;
        } else in = contains(c.path("values"), value);
        yield c.path("op").asText().equals("in") ? in : !in;
      }
      case "ext_in" -> { if (!present) yield false; throw unavailable("未传素材扩展名，不能核对格式限制"); }
      default -> throw unavailable("平台新增的线路规则尚不能估价");
    };
  }

  private Quote calculate(JsonNode group, Map<String, Object> params, Request input, String model) {
    String method = group.path("billing_method").asText();
    if (!Set.of("按次", "按秒").contains(method)) throw unavailable("可用线路包含无法精确预估的动态计费，请以实际结算为准");
    BigDecimal base = decimal(group, "base_price", true), multiplier = BigDecimal.ONE, addition = ZERO;
    JsonNode options = group.path("option_prices");
    if (!options.isMissingNode() && !options.isArray()) throw unavailable("平台档位报价格式无效");
    List<JsonNode> selected = new ArrayList<>();
    Set<String> selectedNames = new HashSet<>();
    for (JsonNode option : options) {
      String name = option.path("param_name").asText();
      if (!equal(params.get(name), option.path("option_value").asText())) continue;
      if (!selectedNames.add(name)) throw unavailable("平台同参数报价重复，暂无法精确估算");
      BigDecimal factor = decimal(option, "price_multiplier", true);
      multiplier = multiplier.multiply(factor);
      addition = addition.add(decimal(option, "price_addition", false));
      selected.add(option);
    }
    BigDecimal rate = selected.size() == 1 && selected.get(0).hasNonNull("final_price")
        ? decimal(selected.get(0), "final_price", true) : round(base.multiply(multiplier).add(addition));
    if (rate.signum() < 0) throw unavailable("平台报价金额无效");
    boolean precharge = false;
    BigDecimal total;
    if (method.equals("按次")) total = rate;
    else {
      Object rawDuration = params.get("duration");
      BigDecimal duration;
      if (!present(rawDuration)) { duration = BigDecimal.TEN; precharge = true; }
      else if (equal(rawDuration, "auto")) {
        duration = BigDecimal.valueOf(model.startsWith("seedance-2.0") ? 15 :
            model.equals("seedance-2.5-guanfang-anmiao") || model.startsWith("wan3.0") ? 30 : -1);
        if (duration.signum() < 0) throw unavailable("该模型智能时长预扣规则尚不能确定");
        precharge = true;
      } else {
        try { duration = new BigDecimal(rawDuration.toString()); }
        catch (NumberFormatException ex) { throw unavailable("请选择有效生成时长"); }
        if (duration.signum() <= 0 || duration.compareTo(BigDecimal.valueOf(600)) > 0) throw unavailable("请选择有效生成时长");
      }
      total = duration.multiply(rate);
      if (input.refs().videos() > 0) {
        BigDecimal refDuration = input.refs().videoSeconds();
        if (refDuration == null || refDuration.signum() <= 0) throw unavailable("参考视频时长尚未读取，暂不能完整估价");
        BigDecimal refRate = decimal(group, "reference_video_price_per_second", false);
        BigDecimal outputMultiplier = decimal(group, "reference_video_output_multiplier", false);
        BigDecimal withVideoRate = null, selectedRefRate = null;
        for (JsonNode option : selected) {
          if (option.hasNonNull("final_price_with_reference_video")) {
            if (withVideoRate != null) throw unavailable("多参数参考视频报价尚不能精确组合");
            withVideoRate = decimal(option, "final_price_with_reference_video", true);
          }
          if (option.hasNonNull("reference_video_price_per_second")) selectedRefRate = decimal(option, "reference_video_price_per_second", true);
        }
        if (group.path("reference_video_billed_as_output").asBoolean(false)) total = duration.add(refDuration).multiply(rate);
        else if (refRate.signum() > 0) {
          if (withVideoRate == null) withVideoRate = decimal(group, "with_video_output_token_price", true);
          if (selectedRefRate == null && present(params.get("resolution")) && !equal(params.get("resolution"), "480p"))
            throw unavailable("当前分辨率参考视频报价尚不完整");
          if (selectedRefRate != null) refRate = selectedRefRate;
          BigDecimal billed = group.path("reference_video_min_two_thirds").asBoolean(false)
              ? refDuration.max(duration.multiply(BigDecimal.valueOf(2)).divide(BigDecimal.valueOf(3), 0, RoundingMode.CEILING)) : refDuration;
          total = duration.multiply(withVideoRate).add(billed.multiply(refRate));
        } else if (withVideoRate != null) total = duration.multiply(withVideoRate);
        else if (outputMultiplier.signum() > 0) total = duration.multiply(rate).multiply(outputMultiplier);
        else if (decimal(group, "with_video_output_token_price", false).signum() > 0) {
          if (!selected.isEmpty()) throw unavailable("所选档位含参考视频报价尚不完整");
          total = duration.multiply(decimal(group, "with_video_output_token_price", true));
        }
      }
    }
    BigDecimal inputPrice = decimal(group, "input_image_price", false);
    int free = group.path("input_image_free_count").asInt(0);
    if (free < 0) throw unavailable("平台参考图报价格式无效");
    total = total.add(inputPrice.multiply(BigDecimal.valueOf(Math.max(0, input.refs().images() - free))));
    int quantity = input.kind().equals("image") ? quantity(input.params()) : 1;
    return new Quote(round(total.multiply(BigDecimal.valueOf(quantity))), precharge);
  }

  private int quantity(Map<String, Object> params) {
    Object value = params.getOrDefault("count", 1);
    try {
      int count = new BigDecimal(value.toString()).intValueExact();
      if (count >= 1 && count <= 20) return count;
    } catch (ArithmeticException | NumberFormatException ignored) { }
    throw bad("图片生成数量必须为1至20的整数");
  }
  private static boolean present(Object v) {
    return v instanceof MediaCount m ? m.count() > 0 : v != null && !v.toString().isBlank();
  }
  private static int countValue(Object v) { return v instanceof MediaCount m ? m.count() : present(v) ? 1 : 0; }
  private static boolean equal(Object a, Object b) { return a != null && b != null && a.toString().equalsIgnoreCase(b.toString()); }
  private static boolean contains(JsonNode options, Object value) {
    for (JsonNode option : options) if (equal(value, option.asText())) return true;
    return false;
  }
  private static Object scalar(JsonNode n) { return n.isBoolean() ? n.booleanValue() : n.isNumber() ? n.decimalValue() : n.textValue().trim(); }
  private static void alias(Map<String, Object> p, String canonical, String alias) {
    if (!p.containsKey(canonical) && p.containsKey(alias)) p.put(canonical, p.get(alias));
  }
  private static String canonical(String value) {
    if (value == null) return "";
    String model = value.trim().toLowerCase(Locale.ROOT);
    return switch (model) {
      case "doubao-seedance-2-5-260628" -> "seedance-2.5-guanfang-anmiao";
      case "gpt-image-2.5", "gpt-image2.5", "tt-image-2.5-flare", "tt-image-2.5-sunburst" -> "tt-image-2.5";
      default -> model;
    };
  }
  private static String selectedModel(String value) {
    return switch (value.trim().toLowerCase(Locale.ROOT)) {
      case "seedance-2.5", "seedance 2.5 全能" -> "seedance-2.5-guanfang-anmiao";
      case "sd 2.0 按次", "seedance 2.0 按次" -> "seedance-2.0-anci";
      case "万相 3.0", "万相 3.0 全能" -> "wan3.0-video-quannengcankao";
      case "lib image 2.5 pro" -> "tt-image-2.5";
      default -> canonical(value);
    };
  }
  private static BigDecimal decimal(JsonNode object, String field, boolean required) {
    JsonNode node = object.path(field);
    if (node.isMissingNode() || node.isNull()) {
      if (required) throw unavailable("平台报价缺少必要计费字段");
      return ZERO;
    }
    try {
      BigDecimal value = new BigDecimal(node.asText());
      if (value.abs().compareTo(BigDecimal.valueOf(1_000_000)) > 0 || (!field.equals("price_addition") && value.signum() < 0))
        throw unavailable("平台报价金额无效");
      return value;
    } catch (NumberFormatException ex) { throw unavailable("平台报价数值格式无效"); }
  }
  private static BigDecimal round(BigDecimal value) { return value.setScale(4, RoundingMode.HALF_UP); }
  private static String source(BigDecimal value) { return round(value).toPlainString(); }
  private static String mi(BigDecimal value) { return value.movePointRight(2).setScale(2, RoundingMode.HALF_UP).toPlainString(); }
  private static String digest(String key) {
    try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8))); }
    catch (Exception ex) { throw unavailable("报价缓存暂不可用"); }
  }
  private static void fields(JsonNode body, Set<String> allowed, String label) {
    if (!body.isObject()) throw bad(label + "必须是对象");
    body.fieldNames().forEachRemaining(field -> { if (!allowed.contains(field)) throw bad(label + "包含不允许的字段"); });
  }
  private static String requiredText(JsonNode body, String field, int max) {
    JsonNode node = body.path(field);
    if (!node.isTextual() || node.textValue().isBlank() || node.textValue().length() > max) throw bad(field + "无效");
    return node.textValue().trim();
  }
  private static int count(JsonNode body, String field, int maximum) {
    JsonNode node = body.path(field);
    if (node.isMissingNode()) return 0;
    if (!node.isIntegralNumber() || !node.canConvertToInt() || node.intValue() < 0 || node.intValue() > maximum) throw bad(field + "数量无效");
    return node.intValue();
  }
  private static BigDecimal seconds(JsonNode body, String field) {
    JsonNode node = body.path(field);
    if (node.isMissingNode() || node.isNull()) return null;
    if (!node.isNumber()) throw bad(field + "时长无效");
    BigDecimal value = node.decimalValue();
    if (value.signum() < 0 || value.compareTo(BigDecimal.valueOf(3_600)) > 0) throw bad(field + "时长无效");
    return value;
  }
  private static Unavailable unavailable(String message) { return new Unavailable(message); }
  private static ApiException bad(String message) { return new ApiException(400, message); }
}
