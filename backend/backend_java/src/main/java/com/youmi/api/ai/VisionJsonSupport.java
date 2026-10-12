package com.youmi.api.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class VisionJsonSupport {
  private VisionJsonSupport() {}

  public static List<VisionElement> parseElements(ObjectMapper mapper, String text) {
    String json = extractNormalizedJsonArray(text);
    JsonNode array;
    try {
      array = json == null ? null : mapper.readTree(json);
    } catch (Exception error) {
      throw new ApiException(502, "Agent 分层结果格式异常，请重试", error);
    }
    if (array == null || !array.isArray()) {
      throw new ApiException(502, "Agent 未返回有效分层结果，请重试");
    }
    List<VisionElement> elements = new ArrayList<>();
    for (JsonNode node : array) {
      String name = node.path("object_name").asText(node.path("name").asText(node.path("object").asText("")))
          .replaceAll("\\s*\\([^)]*\\)\\s*", "").trim();
      if (name.isBlank()) continue;
      JsonNode box = null;
      for (String key : List.of("box_2d", "box.2d", "bbox_2d", "box2d", "bbox")) {
        JsonNode candidate = node.get(key);
        if (candidate != null && candidate.isArray()) { box = candidate; break; }
      }
      if (box == null || box.size() != 4) continue;
      double[] coordinates = new double[4];
      boolean valid = true;
      double scale = 1;
      for (int index = 0; index < 4; index++) {
        JsonNode value = box.get(index);
        double number = value.isNumber() ? value.asDouble() : Double.NaN;
        if (!Double.isFinite(number) || Math.abs(number) > 1000) { valid = false; break; }
        if (Math.abs(number) > 1.05) scale = 1000;
        coordinates[index] = number;
      }
      if (!valid) continue;
      for (int index = 0; index < 4; index++) {
        coordinates[index] = Math.round(Math.max(0, Math.min(1, coordinates[index] / scale)) * 1000) / 1000.0;
      }
      // Models return [top, left, bottom, right]; the canvas uses [left, top, right, bottom].
      double top = coordinates[0], left = coordinates[1], bottom = coordinates[2], right = coordinates[3];
      if (bottom <= top || right <= left) continue;
      elements.add(new VisionElement(name, List.of(left, top, right, bottom)));
    }
    if (!array.isEmpty() && elements.isEmpty()) {
      throw new ApiException(502, "Agent 未返回有效元素坐标，请重试");
    }
    Map<String, Integer> counts = new LinkedHashMap<>();
    for (VisionElement element : elements) counts.merge(element.objectName(), 1, Integer::sum);
    Set<String> usedNames = new HashSet<>(counts.keySet());
    Map<String, Integer> sequences = new LinkedHashMap<>();
    List<VisionElement> unique = new ArrayList<>();
    for (VisionElement element : elements) {
      String name = element.objectName();
      if (counts.get(name) > 1) {
        String candidate;
        do { candidate = name + sequences.merge(name, 1, Integer::sum); } while (usedNames.contains(candidate));
        usedNames.add(candidate);
        name = candidate;
      }
      unique.add(new VisionElement(name, element.box2d()));
    }
    return unique;
  }

  static String extractNormalizedJsonArray(String text) {
    if (text == null || text.isBlank()) return null;
    int start = text.indexOf('[');
    int end = text.lastIndexOf(']');
    if (start < 0 || end <= start) return null;
    return normalizeNumbersOutsideStrings(text.substring(start, end + 1));
  }

  /**
   * Vision models occasionally emit JSON numbers such as 00.125 or 01. JSON forbids leading
   * zeroes, so normalize only numeric tokens outside quoted strings before Jackson parses them.
   */
  static String normalizeNumbersOutsideStrings(String json) {
    if (json == null || json.isBlank()) return json;
    StringBuilder output = new StringBuilder(json.length());
    boolean inString = false;
    boolean escaped = false;

    for (int i = 0; i < json.length();) {
      char current = json.charAt(i);
      if (inString) {
        output.append(current);
        if (escaped) {
          escaped = false;
        } else if (current == '\\') {
          escaped = true;
        } else if (current == '"') {
          inString = false;
        }
        i++;
        continue;
      }

      if (current == '"') {
        inString = true;
        output.append(current);
        i++;
        continue;
      }

      if (isNumberStart(json, i)) {
        int end = i + 1;
        while (end < json.length() && isNumberCharacter(json.charAt(end))) end++;
        output.append(normalizeNumberToken(json.substring(i, end)));
        i = end;
        continue;
      }

      output.append(current);
      i++;
    }
    return output.toString();
  }

  private static boolean isNumberStart(String value, int index) {
    char current = value.charAt(index);
    if (Character.isDigit(current)) return true;
    return current == '-'
        && index + 1 < value.length()
        && (Character.isDigit(value.charAt(index + 1)) || value.charAt(index + 1) == '.');
  }

  private static boolean isNumberCharacter(char value) {
    return Character.isDigit(value)
        || value == '.'
        || value == 'e'
        || value == 'E'
        || value == '+'
        || value == '-';
  }

  private static String normalizeNumberToken(String token) {
    int exponentIndex = Math.max(token.indexOf('e'), token.indexOf('E'));
    String mantissa = exponentIndex >= 0 ? token.substring(0, exponentIndex) : token;
    String exponent = exponentIndex >= 0 ? token.substring(exponentIndex) : "";
    boolean negative = mantissa.startsWith("-");
    String unsigned = negative ? mantissa.substring(1) : mantissa;
    int decimalIndex = unsigned.indexOf('.');
    String integer = decimalIndex >= 0 ? unsigned.substring(0, decimalIndex) : unsigned;
    String fraction = decimalIndex >= 0 ? unsigned.substring(decimalIndex) : "";

    int firstNonZero = 0;
    while (firstNonZero < integer.length() - 1 && integer.charAt(firstNonZero) == '0') {
      firstNonZero++;
    }
    integer = integer.substring(firstNonZero);
    if (integer.isEmpty() && !fraction.isEmpty()) integer = "0";
    return (negative ? "-" : "") + integer + fraction + exponent;
  }
}
