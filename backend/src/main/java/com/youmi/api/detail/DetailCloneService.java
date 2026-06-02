package com.youmi.api.detail;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.ai.AiChatClient;
import com.youmi.api.ai.AiChatDtos;
import com.youmi.api.common.ApiException;
import com.youmi.api.image.ImageGenerationProperties;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.net.InetAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.imageio.ImageIO;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class DetailCloneService {
  private static final TypeReference<List<DetailCloneDtos.SliceContract>> SLICE_CONTRACT_LIST =
      new TypeReference<>() {};
  private static final TypeReference<List<DetailCloneDtos.MappingContract>> MAPPING_CONTRACT_LIST =
      new TypeReference<>() {};
  private static final Duration WEB_EXTRACT_TIMEOUT = Duration.ofSeconds(10);
  private static final int MAX_EXTRACTED_IMAGES = 60;
  private static final int MAX_CUT_IMAGES = 80;
  private static final int MAX_STITCH_HEIGHT = 120_000;
  private static final String BROWSER_USER_AGENT =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
  private static final Pattern IMAGE_TAG_PATTERN =
      Pattern.compile("(?is)<(?:img|source|meta)\\b[^>]*>");
  private static final Pattern IMAGE_META_PATTERN =
      Pattern.compile("(?i)\\b(?:property|name)\\s*=\\s*(?:\"(?:og:image|twitter:image(?::src)?)\"|'(?:og:image|twitter:image(?::src)?)'|(?:og:image|twitter:image(?::src)?)(?=\\s|>))");
  private static final Pattern IMAGE_ATTR_PATTERN =
      Pattern.compile("(?i)(src|data-src|data-original|data-lazy|data-ks-lazyload|srcset|data-srcset|content)\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))");
  private static final Pattern LOOSE_IMAGE_URL_PATTERN =
      Pattern.compile("(?i)(?:https?:)?//[^\\s\"'<>\\\\]+?\\.(?:jpg|jpeg|png|webp|gif)(?:\\?[^\\s\"'<>\\\\]*)?");
  private static final Pattern TMALL_DESC_URL_PATTERN =
      Pattern.compile("(?i)(?:https?:)?//desc\\.alicdn\\.com/[^\\s\"'<>\\\\]+");
  private static final Pattern PRODUCT_ID_PATTERN =
      Pattern.compile("(?i)(?:[?&#]|^)(?:id|itemId)=(\\d{5,})\\b|\\b(?:id|itemId)[:=](\\d{5,})\\b");

  private final ObjectMapper objectMapper;
  private final AiChatClient aiChatClient;
  private final ImageGenerationProperties imageProperties;
  private final HttpClient webExtractHttpClient;

  public DetailCloneService(
      ObjectMapper objectMapper,
      AiChatClient aiChatClient,
      ImageGenerationProperties imageProperties) {
    this.objectMapper = objectMapper;
    this.aiChatClient = aiChatClient;
    this.imageProperties = imageProperties;
    this.webExtractHttpClient = HttpClient.newBuilder()
        .connectTimeout(WEB_EXTRACT_TIMEOUT)
        .followRedirects(HttpClient.Redirect.NORMAL)
        .build();
  }

  public DetailCloneDtos.ExtractImagesResponse extractImages(DetailCloneDtos.ExtractImagesRequest request) {
    URI pageUri = parsePublicPageUri(request == null ? "" : request.url());
    try {
      WebPage response = fetchWebPage(pageUri, "");
      return new DetailCloneDtos.ExtractImagesResponse(
          response.uri().toString(),
          extractImageUrls(response.uri(), response.body()));
    } catch (ApiException exception) {
      throw exception;
    } catch (Exception exception) {
      throw new ApiException(502, "网页提取失败：" + exception.getMessage());
    }
  }

  public DetailCloneDtos.ExtractTmallDetailResponse extractTmallDetail(
      DetailCloneDtos.ExtractTmallDetailRequest request) {
    String itemId = extractProductId(request == null ? "" : request.itemId(), request == null ? "" : request.url());
    if (!StringUtils.hasText(itemId)) {
      throw new ApiException(400, "请输入有效的天猫商品ID");
    }

    URI pageUri = parsePublicPageUri(tmallDetailUrl(itemId));
    try {
      WebPage page = fetchWebPage(pageUri, "https://detail.tmall.com/");
      Set<String> imageUrls = new LinkedHashSet<>(extractImageUrls(page.uri(), page.body()));
      for (URI descUri : extractTmallDescUris(page.uri(), page.body())) {
        if (imageUrls.size() >= MAX_EXTRACTED_IMAGES) break;
        try {
          WebPage descPage = fetchWebPage(descUri, pageUri.toString());
          imageUrls.addAll(extractImageUrls(descPage.uri(), descPage.body()));
        } catch (Exception ignored) {
          // Some description endpoints are protected; keep the images already extracted from the main page.
        }
      }

      return new DetailCloneDtos.ExtractTmallDetailResponse(
          itemId,
          pageUri.toString(),
          new ArrayList<>(imageUrls).stream().limit(MAX_EXTRACTED_IMAGES).toList());
    } catch (ApiException exception) {
      throw exception;
    } catch (Exception exception) {
      throw new ApiException(502, "天猫详情页提取失败：" + exception.getMessage());
    }
  }

  public DetailCloneDtos.CutImagesResponse cutImages(DetailCloneDtos.CutImagesRequest request) {
    List<String> imageUrls = safeList(request == null ? null : request.imageUrls());
    if (imageUrls.isEmpty()) {
      throw new ApiException(400, "请先提取竞品图片");
    }
    if (imageUrls.size() > MAX_CUT_IMAGES) {
      throw new ApiException(400, "单次裁切最多支持 " + MAX_CUT_IMAGES + " 张图片");
    }

    List<Double> cutLines = normalizeCutLines(request == null ? null : request.cutLines());
    if (cutLines.isEmpty()) {
      throw new ApiException(400, "请先添加裁切线");
    }

    try {
      List<BufferedImage> images = new ArrayList<>();
      for (String imageUrl : imageUrls) {
        images.add(downloadBufferedImage(imageUrl));
      }
      BufferedImage stitched = stitchImages(images);
      List<BufferedImage> slices = cutStitchedImage(stitched, cutLines);
      List<String> uploadedUrls = new ArrayList<>();
      String batchId = "detail-cut-" + System.currentTimeMillis();
      for (int index = 0; index < slices.size(); index += 1) {
        uploadedUrls.add(uploadBufferedImage(slices.get(index), batchId, index));
      }

      return new DetailCloneDtos.CutImagesResponse(
          uploadedUrls,
          cutLines,
          imageUrls.size(),
          uploadedUrls.size());
    } catch (ApiException exception) {
      throw exception;
    } catch (Exception exception) {
      throw new ApiException(502, "裁切图片失败：" + exception.getMessage());
    }
  }

  public DetailCloneDtos.DeconstructResponse deconstruct(DetailCloneDtos.DeconstructRequest request) {
    if (!aiChatClient.isConfigured()) {
      return new DetailCloneDtos.DeconstructResponse(
          "fallback:no-api-key", aiChatClient.model(), fallbackSliceContracts(request));
    }

    try {
      List<Map<String, Object>> content = new ArrayList<>();
      content.add(Map.of("type", "text", "text", deconstructPrompt(request)));
      for (String imageUrl : safeList(request.competitorImages())) {
        if (StringUtils.hasText(imageUrl)) {
          content.add(Map.of("type", "image_url", "image_url", Map.of("url", imageUrl.trim())));
        }
      }

      Map<String, Object> message = new LinkedHashMap<>();
      message.put("role", "user");
      message.put("content", content);

      AiChatDtos.CompletionResult completion = aiChatClient.completeRaw(List.of(message), 0.25);
      List<DetailCloneDtos.SliceContract> contracts =
          parseArray(completion.content(), "sliceContracts", SLICE_CONTRACT_LIST);
      if (contracts.isEmpty()) {
        return new DetailCloneDtos.DeconstructResponse(
            "fallback:empty-llm-result", aiChatClient.model(), fallbackSliceContracts(request));
      }
      return new DetailCloneDtos.DeconstructResponse("llm", completion.model(), contracts);
    } catch (Exception ignored) {
      return new DetailCloneDtos.DeconstructResponse(
          "fallback:llm-error", aiChatClient.model(), fallbackSliceContracts(request));
    }
  }

  public DetailCloneDtos.MappingResponse map(DetailCloneDtos.MappingRequest request) {
    List<DetailCloneDtos.SliceContract> sliceContracts =
        request.sliceContracts() == null || request.sliceContracts().isEmpty()
            ? fallbackSliceContracts(new DetailCloneDtos.DeconstructRequest(List.of(), request.productInfo(), request.cloneStrength()))
            : request.sliceContracts();

    if (!aiChatClient.isConfigured()) {
      return new DetailCloneDtos.MappingResponse(
          "fallback:no-api-key", aiChatClient.model(), fallbackMappingContracts(request, sliceContracts));
    }

    try {
      AiChatDtos.CompletionResult completion = aiChatClient.complete(
          List.of(new AiChatDtos.Message("user", mappingPrompt(request, sliceContracts))),
          0.28);
      List<DetailCloneDtos.MappingContract> contracts =
          parseArray(completion.content(), "mappingContracts", MAPPING_CONTRACT_LIST);
      if (contracts.isEmpty()) {
        return new DetailCloneDtos.MappingResponse(
            "fallback:empty-llm-result", aiChatClient.model(), fallbackMappingContracts(request, sliceContracts));
      }
      return new DetailCloneDtos.MappingResponse("llm", completion.model(), contracts);
    } catch (Exception ignored) {
      return new DetailCloneDtos.MappingResponse(
          "fallback:llm-error", aiChatClient.model(), fallbackMappingContracts(request, sliceContracts));
    }
  }

  private WebPage fetchWebPage(URI pageUri, String referer) throws Exception {
    HttpRequest.Builder builder = HttpRequest.newBuilder(pageUri)
        .timeout(WEB_EXTRACT_TIMEOUT)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36")
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.7")
        .GET();
    if (StringUtils.hasText(referer)) {
      builder.header("Referer", referer);
    }

    HttpResponse<String> response = webExtractHttpClient.send(
        builder.build(),
        HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    if (response.statusCode() >= 400) {
      throw new ApiException(502, "网页访问失败：" + response.statusCode());
    }
    return new WebPage(response.uri(), response.body());
  }

  private List<Double> normalizeCutLines(List<Double> values) {
    if (values == null) return List.of();
    return values.stream()
        .filter(value -> value != null && value > 0 && value < 100)
        .map(value -> Math.round(value * 10.0) / 10.0)
        .distinct()
        .sorted()
        .toList();
  }

  private BufferedImage downloadBufferedImage(String imageUrl) throws Exception {
    if (!StringUtils.hasText(imageUrl)) {
      throw new ApiException(400, "图片地址为空");
    }
    HttpRequest request = HttpRequest.newBuilder(URI.create(imageUrl.trim()))
        .timeout(Duration.ofSeconds(Math.max(10, imageProperties.getTimeoutSeconds())))
        .header("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
        .header("User-Agent", BROWSER_USER_AGENT)
        .GET()
        .build();
    HttpResponse<byte[]> response = webExtractHttpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      throw new ApiException(502, "图片下载失败：" + response.statusCode());
    }
    BufferedImage image = ImageIO.read(new ByteArrayInputStream(response.body()));
    if (image == null || image.getWidth() <= 0 || image.getHeight() <= 0) {
      throw new ApiException(502, "图片格式无法识别");
    }
    return image;
  }

  private BufferedImage stitchImages(List<BufferedImage> images) {
    int targetWidth = images.stream().mapToInt(BufferedImage::getWidth).max().orElse(0);
    if (targetWidth <= 0) throw new ApiException(400, "图片宽度无效");

    List<Integer> heights = new ArrayList<>();
    int totalHeight = 0;
    for (BufferedImage image : images) {
      int scaledHeight = Math.max(1, (int) Math.round(image.getHeight() * (targetWidth / (double) image.getWidth())));
      heights.add(scaledHeight);
      totalHeight += scaledHeight;
      if (totalHeight > MAX_STITCH_HEIGHT) {
        throw new ApiException(400, "合并长图过高，请减少图片数量或先手动裁切");
      }
    }

    BufferedImage stitched = new BufferedImage(targetWidth, totalHeight, BufferedImage.TYPE_INT_RGB);
    Graphics2D graphics = stitched.createGraphics();
    graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
    graphics.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
    graphics.setColor(java.awt.Color.WHITE);
    graphics.fillRect(0, 0, targetWidth, totalHeight);
    int y = 0;
    for (int index = 0; index < images.size(); index += 1) {
      BufferedImage image = images.get(index);
      int height = heights.get(index);
      graphics.drawImage(image, 0, y, targetWidth, height, null);
      y += height;
    }
    graphics.dispose();
    return stitched;
  }

  private List<BufferedImage> cutStitchedImage(BufferedImage stitched, List<Double> cutLines) {
    List<Integer> cutPositions = new ArrayList<>();
    cutPositions.add(0);
    for (Double line : cutLines) {
      int y = (int) Math.round(stitched.getHeight() * line / 100.0);
      if (y > 0 && y < stitched.getHeight() && !cutPositions.contains(y)) {
        cutPositions.add(y);
      }
    }
    cutPositions.add(stitched.getHeight());
    cutPositions.sort(Integer::compareTo);

    List<BufferedImage> slices = new ArrayList<>();
    for (int index = 0; index < cutPositions.size() - 1; index += 1) {
      int y = cutPositions.get(index);
      int height = cutPositions.get(index + 1) - y;
      if (height <= 4) continue;
      BufferedImage slice = new BufferedImage(stitched.getWidth(), height, BufferedImage.TYPE_INT_RGB);
      Graphics2D graphics = slice.createGraphics();
      graphics.drawImage(stitched, 0, 0, stitched.getWidth(), height, 0, y, stitched.getWidth(), y + height, null);
      graphics.dispose();
      slices.add(slice);
    }
    if (slices.isEmpty()) throw new ApiException(400, "裁切线位置无效");
    return slices;
  }

  private String uploadBufferedImage(BufferedImage image, String batchId, int index) throws Exception {
    ByteArrayOutputStream imageOutput = new ByteArrayOutputStream();
    ImageIO.write(image, "jpg", imageOutput);
    byte[] imageBytes = imageOutput.toByteArray();
    String filename = batchId + "-" + (index + 1) + ".jpg";
    String boundary = "----YoumiCutBoundary" + System.currentTimeMillis() + index;
    byte[] body = multipartBody(boundary, imageBytes, "image/jpeg", filename);

    HttpRequest request = HttpRequest.newBuilder(URI.create(imageProperties.getUploadEndpoint().trim()))
        .timeout(Duration.ofSeconds(Math.max(10, imageProperties.getTimeoutSeconds())))
        .header("Accept", "application/json, text/plain, */*")
        .header("User-Agent", BROWSER_USER_AGENT)
        .header("Content-Type", "multipart/form-data; boundary=" + boundary)
        .POST(HttpRequest.BodyPublishers.ofByteArray(body))
        .build();
    HttpResponse<String> response = webExtractHttpClient.send(request, HttpResponse.BodyHandlers.ofString());
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      throw new ApiException(502, "OSS 上传失败：" + response.statusCode());
    }
    String url = extractUploadUrl(objectMapper.readTree(response.body()));
    if (!StringUtils.hasText(url)) {
      throw new ApiException(502, "OSS 上传成功但未返回图片地址");
    }
    return normalizeUploadedUrl(url);
  }

  private byte[] multipartBody(String boundary, byte[] bytes, String contentType, String filename) throws Exception {
    String fieldName = StringUtils.hasText(imageProperties.getUploadFieldName())
        ? imageProperties.getUploadFieldName().trim()
        : "file";
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    output.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
    output.write(("Content-Disposition: form-data; name=\"" + fieldName + "\"; filename=\"" + filename + "\"\r\n").getBytes(StandardCharsets.UTF_8));
    output.write(("Content-Type: " + contentType + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
    output.write(bytes);
    output.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
    return output.toByteArray();
  }

  private String extractUploadUrl(JsonNode node) {
    if (node == null || node.isMissingNode() || node.isNull()) return "";
    if (node.isTextual()) {
      String value = node.asText().trim();
      return looksLikeUrl(value) ? value : "";
    }
    if (node.isArray()) {
      for (JsonNode item : node) {
        String url = extractUploadUrl(item);
        if (StringUtils.hasText(url)) return url;
      }
      return "";
    }
    if (!node.isObject()) return "";

    String direct = firstPresent(
        text(node, "url"),
        text(node, "fileUrl"),
        text(node, "file_url"),
        text(node, "fullUrl"),
        text(node, "full_url"),
        text(node, "path"),
        text(node, "src"));
    if (looksLikeUrl(direct)) return direct.trim();

    String nested = firstPresent(
        extractUploadUrl(node.path("data")),
        extractUploadUrl(node.path("result")),
        extractUploadUrl(node.path("file")));
    if (StringUtils.hasText(nested)) return nested;

    var fields = node.fields();
    while (fields.hasNext()) {
      Map.Entry<String, JsonNode> field = fields.next();
      String name = field.getKey().toLowerCase(Locale.ROOT);
      if (name.contains("url") || name.endsWith("path")) {
        String url = extractUploadUrl(field.getValue());
        if (StringUtils.hasText(url)) return url;
      }
    }
    return "";
  }

  private String normalizeUploadedUrl(String value) {
    String trimmed = safe(value, "");
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
    if (!trimmed.startsWith("/")) return trimmed;
    URI endpoint = URI.create(imageProperties.getUploadEndpoint().trim());
    String port = endpoint.getPort() > -1 ? ":" + endpoint.getPort() : "";
    return endpoint.getScheme() + "://" + endpoint.getHost() + port + trimmed;
  }

  private boolean looksLikeUrl(String value) {
    if (!StringUtils.hasText(value)) return false;
    String trimmed = value.trim();
    return trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("/");
  }

  private String text(JsonNode node, String key) {
    JsonNode value = node == null ? null : node.get(key);
    return value != null && value.isValueNode() ? value.asText("").trim() : "";
  }

  private String tmallDetailUrl(String itemId) {
    return "https://detail.tmall.com/item.htm?b_s_f=sycm&id=" + itemId;
  }

  private String extractProductId(String... values) {
    for (String value : values) {
      String raw = safe(value, "");
      if (!StringUtils.hasText(raw)) continue;
      if (raw.matches("\\d{5,}")) return raw;

      List<String> candidates = new ArrayList<>();
      candidates.add(raw);
      try {
        candidates.add(URLDecoder.decode(raw, StandardCharsets.UTF_8));
      } catch (Exception ignored) {
        // Keep the original string only.
      }

      for (String candidate : candidates) {
        Matcher matcher = PRODUCT_ID_PATTERN.matcher(candidate);
        if (matcher.find()) {
          return StringUtils.hasText(matcher.group(1)) ? matcher.group(1) : matcher.group(2);
        }
      }
    }
    return "";
  }

  private List<URI> extractTmallDescUris(URI pageUri, String html) {
    String normalized = normalizeMarkup(html);
    Set<String> urls = new LinkedHashSet<>();
    Matcher matcher = TMALL_DESC_URL_PATTERN.matcher(normalized);
    while (matcher.find() && urls.size() < 3) {
      addAbsoluteUrl(urls, pageUri, matcher.group());
    }
    return urls.stream().map(URI::create).toList();
  }

  private URI parsePublicPageUri(String value) {
    String raw = safe(value, "");
    if (!StringUtils.hasText(raw)) {
      throw new ApiException(400, "请输入竞品网页链接");
    }
    if (!raw.toLowerCase(Locale.ROOT).startsWith("http://")
        && !raw.toLowerCase(Locale.ROOT).startsWith("https://")) {
      raw = "https://" + raw;
    }

    URI uri;
    try {
      uri = URI.create(raw);
    } catch (IllegalArgumentException exception) {
      throw new ApiException(400, "竞品网页链接格式不正确");
    }

    String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
    if (!List.of("http", "https").contains(scheme) || !StringUtils.hasText(uri.getHost())) {
      throw new ApiException(400, "仅支持 http/https 网页链接");
    }
    if (isBlockedHost(uri.getHost())) {
      throw new ApiException(400, "暂不支持本机或内网地址");
    }
    return uri;
  }

  private boolean isBlockedHost(String host) {
    if (!StringUtils.hasText(host)) return true;
    String normalized = host.toLowerCase(Locale.ROOT);
    if ("localhost".equals(normalized) || normalized.endsWith(".localhost")) return true;
    try {
      InetAddress address = InetAddress.getByName(normalized);
      return address.isAnyLocalAddress()
          || address.isLoopbackAddress()
          || address.isLinkLocalAddress()
          || address.isSiteLocalAddress()
          || address.isMulticastAddress();
    } catch (Exception ignored) {
      return false;
    }
  }

  private List<String> extractImageUrls(URI pageUri, String html) {
    if (!StringUtils.hasText(html)) return List.of();

    Set<String> urls = new LinkedHashSet<>();
    String normalizedHtml = normalizeMarkup(html);
    Matcher tagMatcher = IMAGE_TAG_PATTERN.matcher(normalizedHtml);
    while (tagMatcher.find() && urls.size() < MAX_EXTRACTED_IMAGES) {
      String tag = tagMatcher.group();
      String lowerTag = tag.toLowerCase(Locale.ROOT);
      boolean imageTag = lowerTag.startsWith("<img") || (lowerTag.startsWith("<source") && !lowerTag.contains("video/"));
      boolean imageMeta = IMAGE_META_PATTERN.matcher(tag).find();
      if (!imageTag && !imageMeta) continue;

      Matcher attrMatcher = IMAGE_ATTR_PATTERN.matcher(tag);
      while (attrMatcher.find() && urls.size() < MAX_EXTRACTED_IMAGES) {
        String attr = attrMatcher.group(1).toLowerCase(Locale.ROOT);
        if ("content".equals(attr) && !imageMeta) continue;
        addImageCandidates(urls, pageUri, firstPresent(attrMatcher.group(2), attrMatcher.group(3), attrMatcher.group(4)));
      }
    }
    addLooseImageUrls(urls, pageUri, normalizedHtml);
    return new ArrayList<>(urls);
  }

  private void addLooseImageUrls(Set<String> urls, URI pageUri, String html) {
    Matcher matcher = LOOSE_IMAGE_URL_PATTERN.matcher(html);
    while (matcher.find() && urls.size() < MAX_EXTRACTED_IMAGES) {
      addAbsoluteUrl(urls, pageUri, matcher.group());
    }
  }

  private void addImageCandidates(Set<String> urls, URI pageUri, String value) {
    if (!StringUtils.hasText(value)) return;
    String[] candidates = value.split(",");
    for (String candidate : candidates) {
      if (urls.size() >= MAX_EXTRACTED_IMAGES) return;
      addAbsoluteUrl(urls, pageUri, candidate);
    }
  }

  private void addAbsoluteUrl(Set<String> urls, URI pageUri, String value) {
    if (!StringUtils.hasText(value) || urls.size() >= MAX_EXTRACTED_IMAGES) return;
    String raw = decodeHtmlEntities(value).trim().split("\\s+")[0];
    if (!StringUtils.hasText(raw)) return;
    if (raw.startsWith("//")) raw = pageUri.getScheme() + ":" + raw;
    String lowered = raw.toLowerCase(Locale.ROOT);
    if (lowered.startsWith("data:") || lowered.startsWith("blob:") || isUnsupportedMediaCandidate(lowered)) return;
    try {
      URI resolved = pageUri.resolve(raw).normalize();
      String scheme = resolved.getScheme() == null ? "" : resolved.getScheme().toLowerCase(Locale.ROOT);
      if (!List.of("http", "https").contains(scheme)) return;
      String normalized = stripFragment(resolved.toString());
      if (StringUtils.hasText(normalized)) urls.add(normalized);
    } catch (Exception ignored) {
      // Ignore malformed candidates and continue scanning the page.
    }
  }

  private boolean isUnsupportedMediaCandidate(String lowered) {
    String path = lowered.split("[?#]", 2)[0];
    return path.endsWith(".svg")
        || path.endsWith(".mp4")
        || path.endsWith(".webm")
        || path.endsWith(".mov")
        || path.endsWith(".m3u8");
  }

  private String firstPresent(String... values) {
    for (String value : values) {
      if (StringUtils.hasText(value)) return value;
    }
    return "";
  }

  private String decodeHtmlEntities(String value) {
    return value == null
        ? ""
        : value
            .replace("\\/", "/")
            .replace("\\u002F", "/")
            .replace("\\u003D", "=")
            .replace("\\u0026", "&")
            .replace("&amp;", "&")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&lt;", "<")
            .replace("&gt;", ">");
  }

  private String normalizeMarkup(String value) {
    if (value == null) return "";
    return decodeHtmlEntities(value)
        .replace("\\\"", "\"")
        .replace("\\'", "'");
  }

  private String stripFragment(String value) {
    int hashIndex = value.indexOf('#');
    return hashIndex >= 0 ? value.substring(0, hashIndex) : value;
  }

  private record WebPage(URI uri, String body) {}

  private String deconstructPrompt(DetailCloneDtos.DeconstructRequest request) {
    return """
        你是一位电商详情页结构分析师。请分析竞品 A 的详情页图片，拆解每一屏的信息结构。

        只输出 JSON 数组，不要 Markdown，不要解释。数组元素格式：
        {
          "index": 1,
          "role": "这一屏的职责",
          "layoutSkeleton": "布局骨架",
          "visualLanguage": ["视觉元素"],
          "textHierarchy": ["主标题","副标题","正文"],
          "subjectRole": "主体角色",
          "portableElements": ["可移植结构元素"],
          "claimsToDrop": ["应丢弃的竞品专属声明"],
          "generationScope": "scene-regeneration 或 style-transfer 或 text-only"
        }

        规则：
        1. 复制信息结构和视觉语法，不复制竞品事实、品牌、证书、排名、价格、功效承诺。
        2. 每个切片必须职责独立，不要重复同一种卖点卡。
        3. portableElements 只写布局、节奏、构图、对比方式等可迁移元素。
        4. claimsToDrop 只列竞品专属内容。
        5. 复刻强度：%s。
        产品 C 信息只用于判断迁移边界，不要把它写入 A 契约：%s
        """.formatted(strength(request == null ? "" : request.cloneStrength()), safe(request == null ? "" : request.productInfo(), "未填写"));
  }

  private String mappingPrompt(
      DetailCloneDtos.MappingRequest request,
      List<DetailCloneDtos.SliceContract> sliceContracts) throws Exception {
    String productInfo = safe(request.productInfo(), "参考图中的商品");
    return """
        你是一位电商详情页内容映射专家。请把产品 C 的真实信息映射到竞品 A 的切片契约中。

        产品 C 信息：
        %s

        产品图片 URL：
        %s

        竞品 A 切片契约：
        %s

        只输出 JSON 数组，不要 Markdown，不要解释。数组元素格式：
        {
          "sliceIndex": 1,
          "aRole": "竞品A该屏职责",
          "newProductRole": "产品C在该屏的新角色",
          "keepFromA": ["保留的结构/视觉元素"],
          "replaceWithProduct": ["用产品C真实信息替换的内容"],
          "variableSlots": {"headline":"新标题","subheadline":"新副标题","body":"新正文"},
          "forbidden": ["禁止出现的声明/文字"],
          "generationHint": "给图生图模型的完整提示词"
        }

        规则：
        1. keepFromA 只保留版式、信息顺序、视觉节奏和构图，不保留竞品品牌或事实。
        2. variableSlots 必须来自产品 C 信息，不可编造证书、销量、排名、价格或医疗功效。
        3. generationHint 必须说明：参考竞品图只借鉴布局和视觉语法，产品外观以产品图为准。
        4. 每屏提示词要独立，和该屏职责匹配。
        5. 复刻强度：%s。
        """.formatted(
        productInfo,
        objectMapper.writeValueAsString(safeList(request.productImages())),
        objectMapper.writeValueAsString(sliceContracts),
        strength(request.cloneStrength()));
  }

  private List<DetailCloneDtos.SliceContract> fallbackSliceContracts(DetailCloneDtos.DeconstructRequest request) {
    int imageCount = request == null ? 0 : safeList(request.competitorImages()).size();
    int count = Math.max(3, Math.min(8, imageCount > 0 ? imageCount : 5));
    String[] roles = {
        "首屏主视觉与核心利益点",
        "痛点场景与购买理由",
        "核心卖点集中展示",
        "材质结构与细节特写",
        "使用场景与人群适配",
        "对比升级与优势说明",
        "规格参数与购买决策",
        "信任背书与行动引导"
    };
    String[] layouts = {
        "大标题 + 产品主视觉 + 关键卖点标签",
        "问题场景图 + 解决方向 + 情绪化短句",
        "三到四个卖点卡片 + 产品居中展示",
        "局部放大/结构标注 + 简短说明",
        "生活化场景 + 产品自然出现 + 场景利益",
        "左右对比或表格对比 + 结论条",
        "参数卡片 + 尺寸/规格示意 + 注意事项",
        "服务承诺/口碑卡片 + 品牌收束画面"
    };
    List<DetailCloneDtos.SliceContract> contracts = new ArrayList<>();
    for (int index = 0; index < count; index += 1) {
      contracts.add(new DetailCloneDtos.SliceContract(
          index + 1,
          roles[index],
          layouts[index],
          List.of("清晰标题层级", "产品主体突出", "电商详情页节奏", "模块化信息卡"),
          List.of("主标题", "卖点短句", "补充说明"),
          "产品与场景承担主要视觉信息",
          List.of("版式结构", "信息顺序", "构图节奏", "对比方式"),
          List.of("竞品品牌名", "竞品证书/排名", "未验证功效", "具体销量/价格"),
          index == 3 || index == 6 ? "text-only" : "scene-regeneration"));
    }
    return contracts;
  }

  private List<DetailCloneDtos.MappingContract> fallbackMappingContracts(
      DetailCloneDtos.MappingRequest request,
      List<DetailCloneDtos.SliceContract> sliceContracts) {
    String productInfo = safe(request.productInfo(), "参考图中的商品");
    List<DetailCloneDtos.MappingContract> mappings = new ArrayList<>();
    for (DetailCloneDtos.SliceContract contract : sliceContracts) {
      int index = contract.index() == null ? mappings.size() + 1 : contract.index();
      Map<String, Object> slots = new LinkedHashMap<>();
      slots.put("headline", defaultHeadline(index, productInfo));
      slots.put("subheadline", "围绕真实卖点重写，不复制竞品文案");
      slots.put("body", "使用产品 C 的外观、材质、场景和卖点进行表达");

      String hint = "电商详情页竞品复刻，第" + index + "屏。参考竞品图只借鉴布局骨架、视觉节奏、卡片关系和构图方式；"
          + "产品外观必须以产品参考图为准。产品信息：" + productInfo
          + "。本屏职责：" + safe(contract.role(), "详情页分屏")
          + "。布局：" + safe(contract.layoutSkeleton(), "标题区、产品区、卖点说明区清晰分层")
          + "。画面使用简体中文短标题，文字清晰可读，避免乱码；禁止出现竞品品牌、竞品证书、虚假排名、价格标签、医疗功效和平台水印。";

      mappings.add(new DetailCloneDtos.MappingContract(
          index,
          safe(contract.role(), "竞品详情页结构"),
          "产品 C 的" + safe(contract.role(), "详情页分屏"),
          safeList(contract.portableElements()).isEmpty()
              ? List.of("信息顺序", "版式骨架", "视觉节奏")
              : safeList(contract.portableElements()),
          List.of("产品外观", "真实卖点", "适用场景", "材质/结构信息"),
          slots,
          List.of("竞品品牌", "竞品专属证书", "未验证排名", "虚假功效", "价格标签"),
          hint));
    }
    return mappings;
  }

  private String defaultHeadline(int index, String productInfo) {
    return switch (index) {
      case 1 -> productInfo + "，一眼看懂核心价值";
      case 2 -> "解决用户真实痛点";
      case 3 -> "核心卖点清晰呈现";
      case 4 -> "细节材质看得见";
      case 5 -> "放进真实使用场景";
      case 6 -> "对比升级更有说服力";
      case 7 -> "规格参数辅助决策";
      default -> "安心选择，放心下单";
    };
  }

  private <T> List<T> parseArray(String content, String objectKey, TypeReference<List<T>> type) throws Exception {
    String trimmed = stripCodeFence(content);
    try {
      JsonNode root = objectMapper.readTree(trimmed);
      JsonNode array = root.isArray() ? root : root.path(objectKey);
      if (array.isArray()) return objectMapper.convertValue(array, type);
    } catch (Exception ignored) {
      // Try array extraction below.
    }
    int start = trimmed.indexOf('[');
    int end = trimmed.lastIndexOf(']');
    if (start < 0 || end <= start) return List.of();
    return objectMapper.readValue(trimmed.substring(start, end + 1), type);
  }

  private String stripCodeFence(String content) {
    if (content == null) return "";
    String trimmed = content.trim();
    if (!trimmed.startsWith("```")) return trimmed;
    int firstLineEnd = trimmed.indexOf('\n');
    int lastFence = trimmed.lastIndexOf("```");
    if (firstLineEnd >= 0 && lastFence > firstLineEnd) {
      return trimmed.substring(firstLineEnd + 1, lastFence).trim();
    }
    return trimmed;
  }

  private String strength(String value) {
    if ("LIGHT".equalsIgnoreCase(value)) return "轻度：只借鉴信息顺序";
    if ("HIGH".equalsIgnoreCase(value)) return "高度：贴近构图和视觉语法，但不复制竞品事实";
    return "中度：借鉴版式与节奏";
  }

  private String safe(String value, String fallback) {
    return StringUtils.hasText(value) ? value.trim() : fallback;
  }

  private List<String> safeList(List<String> values) {
    if (values == null) return List.of();
    return values.stream().filter(StringUtils::hasText).map(String::trim).toList();
  }
}
