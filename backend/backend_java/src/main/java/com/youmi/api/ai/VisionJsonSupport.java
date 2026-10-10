package com.youmi.api.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;

public final class VisionJsonSupport {
  private VisionJsonSupport() {}

  static String extractNormalizedJsonArray(String text) {
    if (text == null || text.isBlank()) return null;
    int start = text.indexOf('[');
    int end = text.lastIndexOf(']');
    if (start < 0 || end <= start) return null;
    return normalizeNumbersOutsideStrings(text.substring(start, end + 1));
  }

  public static List<VisionElement> parseElements(ObjectMapper mapper, String text) throws Exception {
    String json = extractNormalizedJsonArray(text);
    if (json == null) return List.of();
    JsonNode array = mapper.readTree(json);
    if (!array.isArray()) return List.of();
    List<VisionElement> result = new ArrayList<>();
    for (JsonNode node : array) {
      String name = node.path("object_name").asText(node.path("name").asText(node.path("object").asText("")));
      JsonNode box = node.path("box_2d");
      if (!box.isArray()) box = node.path("bbox_2d");
      if (!box.isArray()) box = node.path("box2d");
      if (!box.isArray()) box = node.path("bbox");
      if (name.isBlank() || !box.isArray() || box.size() != 4) continue;
      double top = normalizeCoord(box.get(0).asDouble());
      double left = normalizeCoord(box.get(1).asDouble());
      double bottom = normalizeCoord(box.get(2).asDouble());
      double right = normalizeCoord(box.get(3).asDouble());
      List<Double> bounds = List.of(Math.min(left, right), Math.min(top, bottom),
          Math.max(left, right), Math.max(top, bottom));
      if (bounds.get(2) <= bounds.get(0) || bounds.get(3) <= bounds.get(1)) continue;
      name = name.replaceAll("\\s*\\([^)]*\\)\\s*", "").trim();
      if (!name.isBlank()) result.add(new VisionElement(name, bounds));
    }
    return List.copyOf(result);
  }

  private static double normalizeCoord(double value) {
    double normalized = Math.abs(value) > 1.05 ? value / 1000.0 : value;
    return Math.max(0.0, Math.min(1.0, normalized));
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
