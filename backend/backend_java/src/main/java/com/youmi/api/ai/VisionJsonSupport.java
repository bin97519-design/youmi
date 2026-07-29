package com.youmi.api.ai;

final class VisionJsonSupport {
  private VisionJsonSupport() {}

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
