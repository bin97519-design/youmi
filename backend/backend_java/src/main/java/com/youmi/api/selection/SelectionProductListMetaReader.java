package com.youmi.api.selection;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.Reader;
import java.util.HashMap;
import java.util.Map;

/** Reads only list metadata; does not allocate SKU/image trees or parse raw snapshots. */
final class SelectionProductListMetaReader {
  private SelectionProductListMetaReader() {}

  static SelectionPoolDtos.ProductListMeta read(ObjectMapper mapper, Reader reader) {
    Map<String, Integer> counts = new HashMap<>();
    String type = "", categoryName = "", legacyCategory = "", categoryPath = "", cover = "";
    SelectionPoolDtos.SkuSplitSummary split = null;
    if (reader == null) return empty();
    try (reader; JsonParser parser = mapper.getFactory().createParser(reader)) {
      if (parser.nextToken() != JsonToken.START_OBJECT) return empty();
      while (parser.nextToken() == JsonToken.FIELD_NAME) {
        String field = parser.currentName();
        parser.nextToken();
        switch (field) {
          case "productType" -> type = scalar(parser);
          case "categoryName" -> legacyCategory = scalar(parser);
          case "categoryPath" -> categoryPath = scalar(parser);
          case "category" -> {
            if (parser.currentToken() == JsonToken.START_OBJECT) {
              while (parser.nextToken() == JsonToken.FIELD_NAME) {
                String key = parser.currentName();
                parser.nextToken();
                if ("name".equals(key)) categoryName = scalar(parser);
                else if ("path".equals(key) && categoryPath.isBlank()) categoryPath = scalar(parser);
                else parser.skipChildren();
              }
            } else parser.skipChildren();
          }
          case "skuGroups", "saleProperties", "specList", "specGroups", "skus", "sku", "skuList" ->
              counts.put(field, arrayCount(parser));
          case "skuSplit" -> split = split(parser);
          case "images", "mainImages" -> {
            String image = firstImage(parser);
            if (cover.isBlank()) cover = image;
          }
          case "media", "mainImagesGroup" -> {
            if (parser.currentToken() == JsonToken.START_OBJECT) {
              while (parser.nextToken() == JsonToken.FIELD_NAME) {
                String key = parser.currentName();
                parser.nextToken();
                if ("mainImages".equals(key) || "images".equals(key)) {
                  String image = firstImage(parser);
                  if (cover.isBlank()) cover = image;
                } else parser.skipChildren();
              }
            } else parser.skipChildren();
          }
          default -> parser.skipChildren();
        }
      }
      return new SelectionPoolDtos.ProductListMeta(type,
          !categoryName.isBlank() ? categoryName : !legacyCategory.isBlank() ? legacyCategory : categoryPath,
          firstCount(counts, "skuGroups", "saleProperties", "specList", "specGroups"),
          firstCount(counts, "skus", "sku", "skuList"), split, cover);
    } catch (IOException ignored) {
      // Same malformed-legacy-JSON behavior as the detail reader; don't fail the whole page.
      return empty();
    }
  }

  private static SelectionPoolDtos.ProductListMeta empty() {
    return new SelectionPoolDtos.ProductListMeta("", "", 0, 0, null, "");
  }

  private static String scalar(JsonParser parser) throws IOException {
    String value = parser.currentToken().isScalarValue() ? parser.getValueAsString("") : "";
    parser.skipChildren();
    return value;
  }

  private static int arrayCount(JsonParser parser) throws IOException {
    if (parser.currentToken() != JsonToken.START_ARRAY) { parser.skipChildren(); return 0; }
    int count = 0;
    while (parser.nextToken() != JsonToken.END_ARRAY) {
      if (parser.currentToken() == null) throw new IOException("Incomplete array");
      count++;
      parser.skipChildren();
    }
    return count;
  }

  private static int firstCount(Map<String, Integer> counts, String... keys) {
    for (String key : keys) if (counts.getOrDefault(key, 0) > 0) return counts.get(key);
    return 0;
  }

  private static SelectionPoolDtos.SkuSplitSummary split(JsonParser parser) throws IOException {
    if (parser.currentToken() != JsonToken.START_OBJECT) { parser.skipChildren(); return null; }
    int part = 0;
    String name = "";
    while (parser.nextToken() == JsonToken.FIELD_NAME) {
      String key = parser.currentName();
      parser.nextToken();
      if ("part".equals(key)) part = parser.getValueAsInt(0);
      else if ("groupName".equals(key)) name = scalar(parser);
      parser.skipChildren();
    }
    return part > 0 ? new SelectionPoolDtos.SkuSplitSummary(part, name) : null;
  }

  private static String firstImage(JsonParser parser) throws IOException {
    if (parser.currentToken() != JsonToken.START_ARRAY) { parser.skipChildren(); return ""; }
    String image = "";
    while (parser.nextToken() != JsonToken.END_ARRAY) {
      if (parser.currentToken() == null) throw new IOException("Incomplete array");
      if (!image.isBlank()) { parser.skipChildren(); continue; }
      if (parser.currentToken() == JsonToken.VALUE_STRING) image = parser.getText();
      else if (parser.currentToken() == JsonToken.START_OBJECT) {
        while (parser.nextToken() == JsonToken.FIELD_NAME) {
          String key = parser.currentName();
          parser.nextToken();
          if ("url".equals(key)) image = scalar(parser);
          else parser.skipChildren();
        }
      } else parser.skipChildren();
    }
    return image;
  }
}
