package com.youmi.api.ai;

/** Input/output usage for a single planning request; the budget is an application setting. */
public record AgentContextUsage(String model, long inputTokens, long outputTokens, long budgetTokens,
    boolean estimated) {
  public static long estimate(String text) {
    if (text == null || text.isEmpty()) return 0;
    long cjk = 0, other = 0;
    for (int offset = 0; offset < text.length();) {
      int point = text.codePointAt(offset);
      offset += Character.charCount(point);
      var script = Character.UnicodeScript.of(point);
      if (script == Character.UnicodeScript.HAN || script == Character.UnicodeScript.HANGUL
          || script == Character.UnicodeScript.HIRAGANA || script == Character.UnicodeScript.KATAKANA) cjk++;
      else other++;
    }
    return cjk + (other + 3) / 4;
  }
}
