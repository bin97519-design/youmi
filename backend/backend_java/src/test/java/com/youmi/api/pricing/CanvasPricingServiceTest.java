package com.youmi.api.pricing;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.youmi.api.common.ApiException;
import com.youmi.api.image.ModelApiKeyService;
import com.youmi.api.image.ModelApiKeyService.ResolvedModelApiKey;
import java.math.BigDecimal;
import java.net.http.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.atomic.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** No real HTTP, credentials, generation tasks or ledger writes are used by these tests. */
class CanvasPricingServiceTest {
  final ObjectMapper mapper = new ObjectMapper();
  final ModelApiKeyService keys = mock(ModelApiKeyService.class);
  final HttpClient http = mock(HttpClient.class);
  final AtomicLong now = new AtomicLong(Instant.parse("2026-10-22T08:00:00Z").toEpochMilli());
  final AtomicInteger status = new AtomicInteger(200);
  final AtomicReference<String> body = new AtomicReference<>();
  CanvasPricingService service;
  String currentModel;

  @BeforeEach void setup() throws Exception {
    Clock clock = new Clock() {
      public ZoneId getZone() { return ZoneOffset.UTC; }
      public Clock withZone(ZoneId zone) { return this; }
      public Instant instant() { return Instant.ofEpochMilli(now.get()); }
    };
    service = new CanvasPricingService(keys, mapper, http, clock);
    when(http.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class))).thenAnswer(call -> {
      @SuppressWarnings("unchecked") HttpResponse<String> result = mock(HttpResponse.class);
      when(result.statusCode()).thenReturn(status.get()); when(result.body()).thenReturn(body.get());
      return result;
    });
  }

  ResolvedModelApiKey manage(String model) {
    return manage(model, "https://api.lk888.ai", "test-credential-not-real", Map.of());
  }
  ResolvedModelApiKey manage(String model, String base, String key, Map<String, Object> defaults) {
    currentModel = model;
    var credential = new ResolvedModelApiKey(83, model, "lk888", base, "/v1/media/generate", "/v1/media/status", key, defaults);
    when(keys.resolve(eq(model), anyString(), anyString())).thenReturn(Optional.of(credential));
    when(keys.resolveFeatureRouteOption(eq("model-api-key:83"), anyString(), anyString())).thenReturn(Optional.of(credential));
    return credential;
  }
  ObjectNode group(String method, String base) {
    ObjectNode g = mapper.createObjectNode().put("is_active", true).put("in_key_whitelist", true)
        .put("excluded_for_this_key", false).put("billing_method", method).put("base_price", new BigDecimal(base));
    g.putArray("option_prices"); return g;
  }
  void option(ObjectNode g, String param, String value, String multiplier, String addition, String finalPrice) {
    ObjectNode option = ((ArrayNode)g.path("option_prices")).addObject().put("param_name", param).put("option_value", value)
        .put("price_multiplier", new BigDecimal(multiplier)).put("price_addition", new BigDecimal(addition));
    if (finalPrice != null) option.put("final_price", new BigDecimal(finalPrice));
  }
  ObjectNode price(String model, ObjectNode... groups) {
    ObjectNode root = mapper.createObjectNode().put("name", model).put("type", model.startsWith("banana") || model.startsWith("tt-image") ? "image" : "video")
        .put("available_for_this_key", true);
    ArrayNode all = root.putArray("channel_groups"); for (var g : groups) all.add(g);
    body.set(root.toString()); return root;
  }
  ObjectNode request(Map<String, Object> params) {
    ObjectNode r = mapper.createObjectNode().put("kind", currentModel.startsWith("banana") || currentModel.startsWith("tt-image") ? "image" : "video").put("model", currentModel);
    r.set("params", mapper.valueToTree(params)); r.putObject("reference"); return r;
  }
  Map<String, Object> wanParams() { return Map.of("version", "prime", "resolution", "720P", "duration", "5", "audio", false, "prompt_extend", false); }
  Map<String, Object> sdParams() { return Map.of("resolution", "720p", "duration", "5", "ratio", "16:9"); }
  ObjectNode reference(ObjectNode r, int images, int videos, BigDecimal seconds) {
    ObjectNode ref = (ObjectNode) r.path("reference"); ref.put("imageCount", images).put("videoCount", videos);
    if (seconds != null) ref.put("videoDurationSeconds", seconds); return r;
  }
  void reject(ObjectNode g, String param, String source, String op, String value) {
    ObjectNode condition = g.withArray("capability_rules").addObject().put("effect", "reject").putArray("when").addObject()
        .put("param", param).put("op", op);
    if (source != null) condition.put("source", source);
    if (value != null) condition.putArray("values").add(value);
  }

  @Test void combinesAllWanMultipliersThenConvertsExactlyOnce() {
    manage("wan3.0-video-quannengcankao"); ObjectNode g = group("按秒", "0.3795");
    option(g, "resolution", "720P", "2", "0", ".7590"); option(g, "version", "prime", "1.5", "0", ".5693");
    price(currentModel, g);
    var out = service.estimate(request(wanParams()));
    assertTrue(out.available()); assertEquals("5.6925", out.sourceAmount()); assertEquals("569.25", out.amount());
    assertEquals("米值", out.unit()); assertEquals("算力", out.platformUnit()); assertEquals(100, out.conversionMultiplier());
    assertEquals(now.get() + 30_000, out.expiresAt());
  }
  @Test void perCallAnciDoesNotMultiplyByDuration() {
    manage("seedance-2.0-anci"); ObjectNode g = group("按次", "4.8702");
    option(g, "version", "标准", "1", "1.3915", "6.2617"); price(currentModel, g);
    var out = service.estimate(request(Map.of("version", "标准", "resolution", "720p", "duration", "15")));
    assertEquals("626.17", out.amount());
  }
  @Test void klingPerCallCombinesModeAndDuration() {
    manage("kling-v3-omni-cankao"); ObjectNode g = group("按次", "2.5287");
    option(g, "mode", "pro", "1.25", "0", "3.1609"); option(g, "duration", "10", "2", "0", "5.0574");
    price(currentModel, g); var out = service.estimate(request(Map.of("mode", "pro", "duration", "10")));
    assertEquals("632.18", out.amount());
  }
  @Test void rangeIncludesEveryActiveAllowedCandidateNotTheirStatsPriority() {
    manage("minimax-h3"); ObjectNode a = group("按秒", ".1"), b = group("按秒", ".2"), off = group("按秒", "50");
    off.put("is_active", false); a.put("success_rate_24h", 100); b.put("success_rate_24h", 1); price(currentModel, a, b, off);
    var out = service.estimate(request(Map.of("resolution", "768P", "duration", "5")));
    assertTrue(out.available()); assertNull(out.amount()); assertEquals("50.00", out.minAmount()); assertEquals("100.00", out.maxAmount());
  }
  @Test void tokenCandidateMakesEntireRangeUnavailableNotFreeOrOmitted() {
    manage("minimax-h3"); price(currentModel, group("按秒", ".1"), group("按token", "0"));
    var out = service.estimate(request(Map.of("resolution", "768P", "duration", "5")));
    assertFalse(out.available()); assertNull(out.amount());
  }
  @Test void zeroPriceIsValidAndNotConfusedWithMissing() {
    manage("banana-pro"); price(currentModel, group("按次", "0"));
    var out = service.estimate(request(Map.of("resolution", "1K", "size", "1:1", "count", 1)));
    assertTrue(out.available()); assertEquals("0.00", out.amount());
  }
  @Test void supportedOptionsTreatsFalseAsPresentAndUsesCaseInsensitiveComparison() {
    manage("wan3.0-video-quannengcankao"); ObjectNode g = group("按秒", ".1");
    g.putObject("supported_options").putArray("audio").add("FALSE"); price(currentModel, g);
    assertTrue(service.estimate(request(wanParams())).available());
    Map<String, Object> trueAudio = new HashMap<>(wanParams()); trueAudio.put("audio", true);
    assertFalse(service.estimate(request(trueAudio)).available());
  }
  @Test void capabilityRejectRulesAreAndAndIgnoreDoesNotExclude() {
    manage("seedance-2.5-guanfang-anmiao"); ObjectNode g = group("按秒", ".1");
    reject(g, "input_form", "derived", "in", "shouweizhen");
    g.withArray("capability_rules").addObject().put("effect", "ignore").putArray("when"); price(currentModel, g);
    assertTrue(service.estimate(reference(request(sdParams()), 1, 0, null)).available());
    assertFalse(service.estimate(reference(request(sdParams()), 2, 0, null)).available());
  }
  @Test void unknownConstraintCannotSilentlyRemoveCandidateOrBroadenRange() {
    manage("minimax-h3"); ObjectNode g = group("按秒", ".2"); reject(g, "images", null, "ext_in", "png");
    price(currentModel, group("按秒", ".1"), g);
    assertFalse(service.estimate(reference(request(Map.of("resolution", "768P", "duration", "5")), 1, 0, null)).available());
  }
  @Test void undocumentedFamilyReferenceMappingStaysUnknown() {
    manage("minimax-h3"); ObjectNode g = group("按秒", ".1"); reject(g, "input_form", "derived", "in", "quannengcankao"); price(currentModel, g);
    assertFalse(service.estimate(reference(request(Map.of("resolution", "768P", "duration", "5")), 3, 0, null)).available());
  }
  @Test void h3InputVideosBilledAsOutputAndExtraImagesIndependent() {
    manage("minimax-h3"); ObjectNode g = group("按秒", ".1113").put("reference_video_billed_as_output", true)
        .put("input_image_price", new BigDecimal(".253")).put("input_image_free_count", 5); price(currentModel, g);
    var out = service.estimate(reference(request(Map.of("resolution", "768P", "duration", "5")), 7, 1, new BigDecimal("3")));
    assertEquals("139.64", out.amount()); // (5+3)*.1113 + 2*.253
  }
  @Test void officialReferenceMinimumAndSelectedWithVideoRates() {
    manage("seedance-2.5-guanfang-anmiao"); ObjectNode g = group("按秒", "1.0373")
        .put("reference_video_price_per_second", new BigDecimal(".5439")).put("reference_video_min_two_thirds", true)
        .put("with_video_output_token_price", new BigDecimal(".5692"));
    option(g, "resolution", "720p", "1", "0", "1.0373");
    ((ObjectNode)g.path("option_prices").get(0)).put("final_price_with_reference_video", new BigDecimal(".5692"))
        .put("reference_video_price_per_second", new BigDecimal(".5439")); price(currentModel, g);
    ObjectNode r = request(Map.of("resolution", "720p", "duration", "30")); reference(r, 0, 1, new BigDecimal("2"));
    assertEquals("2795.40", service.estimate(r).amount()); //30*.5692+20*.5439
  }
  @Test void referenceVideoMultiplierNotAppliedTwice() {
    manage("seedance-2.5-guanfang-anmiao"); ObjectNode g = group("按秒", ".5692").put("reference_video_output_multiplier", new BigDecimal("1.5"));
    option(g, "resolution", "720p", "1.1111", "0", ".6324");
    ((ObjectNode)g.path("option_prices").get(0)).put("final_price_with_reference_video", new BigDecimal(".9486")); price(currentModel, g);
    assertEquals("474.30", service.estimate(reference(request(sdParams()), 0, 1, new BigDecimal("3"))).amount());
  }
  @Test void noReferenceFlagsButReturnedWithVideoRateIsStillApplied() {
    manage("seedance-2.5-guanfang-anmiao"); ObjectNode g = group("按秒", "1.0752");
    option(g, "resolution", "720p", "1", "0", "1.0752");
    ((ObjectNode)g.path("option_prices").get(0)).put("final_price_with_reference_video", new BigDecimal(".9994")); price(currentModel, g);
    assertEquals("499.70", service.estimate(reference(request(sdParams()), 0, 1, new BigDecimal("3"))).amount());
  }
  @Test void referenceVideoUnknownDurationNeverActsLikeZero() {
    manage("minimax-h3"); price(currentModel, group("按秒", ".1"));
    assertFalse(service.estimate(reference(request(Map.of("resolution", "768P", "duration", "5")), 0, 1, null)).available());
  }
  @Test void autoUsesDocumentedThirtySecondPrecharge() {
    manage("seedance-2.5-guanfang-anmiao"); price(currentModel, group("按秒", ".1"));
    var out = service.estimate(request(Map.of("resolution", "720p", "duration", "auto")));
    assertEquals("300.00", out.amount()); assertEquals("precharge", out.kind());
  }
  @Test void klingBaseOmitsDurationAndUsesTenSecondPrechargeNotInputLength() {
    manage("kling-v3-omni-videoref"); price(currentModel, group("按秒", ".568"));
    ObjectNode r = reference(request(Map.of("mode", "std", "refer_type", "base", "duration", "5")), 0, 1, new BigDecimal("3"));
    var out = service.estimate(r); assertEquals("568.00", out.amount()); assertEquals("precharge", out.kind());
  }
  @Test void ttNormalImageSizeIsAspectRatioNotNativeCustomSize() {
    manage("tt-image-2.5"); ObjectNode g = group("按次", ".02");
    g.putObject("supported_options").putArray("aspect_ratio").add("16:9"); price(currentModel, g);
    assertEquals("2.00", service.estimate(request(Map.of("size", "16:9", "resolution", "2K", "version", "flare", "quality", "high", "background", "auto", "count", 1))).amount());
  }
  @Test void ttCustomPixelSizeIsHonestUnavailableNotBadRequest() {
    manage("tt-image-2.5"); price(currentModel, group("按次", ".02"));
    assertFalse(service.estimate(request(Map.of("size", "16:9", "resolution", "2K", "custom_size", "2048x1024"))).available());
    verifyNoInteractions(http);
  }
  @Test void bananaRatioFromSizeFiltersUnsupportedChannel() {
    manage("banana-2.1"); ObjectNode g = group("按次", ".1"); g.putObject("supported_options").putArray("aspectRatio").add("1:1"); price(currentModel, g);
    assertFalse(service.estimate(request(Map.of("size", "21:9", "resolution", "2K", "thinking_level", "minimal", "web_search", false))).available());
  }
  @Test void imageConfiguredDefaultsMatchActualMergeAndAffectQuote() {
    manage("tt-image-2.5", "https://api.lk888.ai/api", "test", Map.of("web_search", true));
    ObjectNode g = group("按次", ".1"); option(g, "web_search", "true", "2", "0", ".2"); price(currentModel, g);
    assertEquals("20.00", service.estimate(request(Map.of("size", "1:1", "resolution", "2K", "count", 1))).amount());
  }
  @Test void unknownConfiguredDefaultMakesImageUnavailable() {
    manage("banana-pro", "https://api.lk888.ai", "test", Map.of("arbitrary_field", "unknown")); price(currentModel, group("按次", ".1"));
    assertFalse(service.estimate(request(Map.of("size", "1:1", "resolution", "1K"))).available()); verifyNoInteractions(http);
  }
  @Test void imageQuantityAppliesToEachCallIncludingReferenceCharges() {
    manage("banana-pro"); ObjectNode g = group("按次", ".1").put("input_image_price", new BigDecimal(".02")).put("input_image_free_count", 1); price(currentModel, g);
    var r = reference(request(Map.of("size", "1:1", "resolution", "1K", "count", 4)), 2, 0, null);
    assertEquals("48.00", service.estimate(r).amount());
  }
  @Test void credentialAbsentOrStaleRouteDoesNotFallback() {
    currentModel = "minimax-h3"; assertFalse(service.estimate(request(Map.of("resolution", "768P"))).available());
    manage(currentModel); var r = request(Map.of("resolution", "768P")); r.put("model", "model-api-key:999");
    assertFalse(service.estimate(r).available()); verifyNoInteractions(http);
    verify(keys, never()).resolve(eq("model-api-key:999"), anyString(), anyString());
  }
  @Test void explicitHintCannotRerouteAnOpaqueCredential() {
    manage("minimax-h3"); ObjectNode r = request(Map.of("resolution", "768P")).put("model", "model-api-key:83").put("apiModel", "kling-v3-omni-cankao");
    assertFalse(service.estimate(r).available()); verifyNoInteractions(http);
  }
  @Test void untrustedOriginAndRedirectStatusCannotLeakCredentials() {
    for (String origin : List.of("http://api.lk888.ai", "https://api.lk888.ai.evil.test", "https://user@api.lk888.ai", "http://127.0.0.1", "https://api.lk888.ai:444", "https://api.lk888.ai?key=x")) {
      manage("minimax-h3", origin, "test", Map.of()); assertFalse(service.estimate(request(Map.of("resolution", "768P"))).available());
    }
    verifyNoInteractions(http);
  }
  @Test void requestRejectsSecretsPromptUrlsNestedParamsAndPriceOverrides() {
    manage("minimax-h3");
    for (String field : List.of("apiKey", "prompt", "baseUrl", "notify_url", "sourceAmount")) {
      var r = request(Map.of("resolution", "768P")).put(field, "not-allowed"); assertThrows(ApiException.class, () -> service.estimate(r));
    }
    assertThrows(ApiException.class, () -> service.estimate(request(Map.of("images", "https://example.test/x.png"))));
    assertThrows(ApiException.class, () -> service.estimate(request(Map.of("resolution", List.of("768P")))));
    assertThrows(ApiException.class, () -> service.estimate(request(Map.of("duration", "https://example.test/"))));
    verifyNoInteractions(http);
  }
  @Test void fixedGetPathAndAuthNeverUseGenerationEndpoint() throws Exception {
    manage("minimax-h3"); price(currentModel, group("按秒", ".1")); service.estimate(request(Map.of("resolution", "768P", "duration", "5")));
    var captor = ArgumentCaptor.forClass(HttpRequest.class); verify(http).send(captor.capture(), any(HttpResponse.BodyHandler.class));
    HttpRequest request = captor.getValue(); assertEquals("GET", request.method());
    assertEquals("https://api.lk888.ai/api/v1/skills/models/minimax-h3/pricing", request.uri().toString());
    assertTrue(request.bodyPublisher().isEmpty()); assertEquals("Bearer test-credential-not-real", request.headers().firstValue("Authorization").orElseThrow());
    verify(keys).resolve("minimax-h3", "video_generation", "canvas-video");
  }
  @Test void upstreamErrorsMalformedAndMissingPriceAreUnavailable() {
    manage("minimax-h3"); var r = request(Map.of("resolution", "768P", "duration", "5"));
    for (int code : List.of(302, 402, 403, 500)) { status.set(code); body.set("sensitive upstream body"); assertFalse(service.estimate(r).available()); }
    status.set(200); body.set("invalid json"); assertFalse(service.estimate(r).available());
    ObjectNode g = group("按秒", ".1"); g.remove("base_price"); price(currentModel, g); assertFalse(service.estimate(r).available());
  }
  @Test void cachedMetadataExpiresAndNeverReturnsStaleOnError() throws Exception {
    manage("minimax-h3"); price(currentModel, group("按秒", ".1")); var r = request(Map.of("resolution", "768P", "duration", "5"));
    assertEquals("50.00", service.estimate(r).amount()); price(currentModel, group("按秒", ".2"));
    assertEquals("50.00", service.estimate(r).amount()); verify(http, times(1)).send(any(), any(HttpResponse.BodyHandler.class));
    now.addAndGet(30_000); assertEquals("100.00", service.estimate(r).amount());
    now.addAndGet(30_000); status.set(500); assertFalse(service.estimate(r).available());
  }
  @Test void cacheIsCredentialAndKeySpecificAndTimeDiscountIsNotAppliedTwice() throws Exception {
    manage("minimax-h3"); ObjectNode g = group("按秒", ".1").put("current_time_discount", new BigDecimal(".5")); price(currentModel, g);
    var r = request(Map.of("resolution", "768P", "duration", "5")); assertEquals("50.00", service.estimate(r).amount());
    manage("minimax-h3", "https://api.lk888.ai", "rotated-test", Map.of()); price(currentModel, group("按秒", ".2"));
    assertEquals("100.00", service.estimate(r).amount()); verify(http, times(2)).send(any(), any(HttpResponse.BodyHandler.class));
  }
  @Test void displayLabelInCredentialCannotBeMistakenForAnotherApiModel() {
    manage("Lib Image 2.5 Pro"); ObjectNode r = request(Map.of("size", "1:1", "resolution", "2K"))
        .put("kind", "image").put("model", "model-api-key:83");
    assertFalse(service.estimate(r).available()); verifyNoInteractions(http);
  }
  @Test void nextBeijingDiscountBoundaryExpiresSnapshotEarlyIncludingMidnight() {
    now.set(Instant.parse("2026-10-22T13:59:50Z").toEpochMilli()); //21:59:50 in Beijing
    manage("minimax-h3"); ObjectNode g = group("按秒", ".1");
    g.putArray("time_discounts").addObject().put("start", "22:00").put("end", "24:00"); price(currentModel, g);
    var r = request(Map.of("resolution", "768P", "duration", "5"));
    assertEquals(now.get() + 10_000, service.estimate(r).expiresAt());
    now.set(Instant.parse("2026-10-22T15:59:50Z").toEpochMilli());
    assertEquals(now.get() + 10_000, service.estimate(r).expiresAt());
  }
  @Test void ttAutoResolutionUsesActualPlatformDerivedAutoForConstraints() {
    manage("tt-image-2.5"); ObjectNode a = group("按次", ".1"), b = group("按次", ".2");
    a.putObject("supported_options").putArray("resolution").add("auto");
    b.putObject("supported_options").putArray("resolution").add("2K"); price(currentModel, a, b);
    var out = service.estimate(request(Map.of("size", "auto", "resolution", "2K", "version", "flare")));
    assertEquals("10.00", out.amount());
  }
}
