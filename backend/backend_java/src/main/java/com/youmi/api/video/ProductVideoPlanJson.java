package com.youmi.api.video;

import com.fasterxml.jackson.core.JsonParseException;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.core.json.JsonReadFeature;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectReader;
import com.youmi.api.common.ApiException;
import java.io.IOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

final class ProductVideoPlanJson {
  private static final Logger log = LoggerFactory.getLogger(ProductVideoPlanJson.class);
  private final ObjectMapper mapper;
  private final ObjectReader reader;

  ProductVideoPlanJson(ObjectMapper source) {
    mapper = source.copy()
        .enable(JsonReadFeature.ALLOW_TRAILING_COMMA.mappedFeature())
        .enable(JsonReadFeature.ALLOW_UNESCAPED_CONTROL_CHARS.mappedFeature())
        .enable(JsonReadFeature.ALLOW_SINGLE_QUOTES.mappedFeature())
        .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION);
    reader = mapper.readerFor(JsonNode.class).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
  }

  JsonNode read(String text) {
    String value = text == null ? "" : text.trim();
    if (value.startsWith("```"))
      value = value.replaceFirst("(?i)^```(?:json)?\\s*", "").replaceFirst("\\s*```$", "");
    try (JsonParser parser = mapper.createParser(value)) {
      try {
        return reader.readTree(parser);
      } catch (JsonParseException error) {
        int position = (int) error.getLocation().getCharOffset();
        if (!isStrayArraySuffix(value, position, parser)) throw error;
        // Recover only an isolated non-JSON suffix after a complete array item, never text inside a value.
        JsonNode recovered = reader.readTree(value.substring(0, position) + value.substring(position + 1));
        log.info("Recovered one stray character at a planning JSON array boundary (line={}, column={})",
            error.getLocation().getLineNr(), error.getLocation().getColumnNr());
        return recovered;
      }
    } catch (JsonProcessingException error) {
      var location = error.getLocation();
      log.warn("Planning JSON remains invalid (type={}, line={}, column={})", error.getClass().getSimpleName(),
          location == null ? -1 : location.getLineNr(), location == null ? -1 : location.getColumnNr());
      throw new ApiException(502, "模型返回的策划格式不完整，无法安全读取。已完成内容已保留，请继续未完成分镜。");
    } catch (IOException error) {
      throw new ApiException(502, "策划回复读取失败，已完成内容已保留，请继续未完成分镜。");
    }
  }

  private boolean isStrayArraySuffix(String value, int position, JsonParser parser) {
    if (position < 1 || position >= value.length() - 1 || !parser.getParsingContext().inArray()
        || (parser.currentToken() != JsonToken.END_OBJECT && parser.currentToken() != JsonToken.END_ARRAY)
        || Character.UnicodeScript.of(value.charAt(position)) != Character.UnicodeScript.HAN) return false;
    int before = position - 1, after = position + 1;
    while (before >= 0 && Character.isWhitespace(value.charAt(before))) before--;
    while (after < value.length() && Character.isWhitespace(value.charAt(after))) after++;
    return before >= 0 && (value.charAt(before) == '}' || value.charAt(before) == ']')
        && after < value.length() && value.charAt(after) == ']';
  }
}
