package com.youmi.api.video;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import java.util.List;
import org.junit.jupiter.api.Test;

class ProductVideoPlanJsonTest {
  private final ObjectMapper mapper = new ObjectMapper();
  private final ProductVideoPlanJson parser = new ProductVideoPlanJson(mapper);

  @Test void recoversIsolatedStraySuffixWithoutChangingAnyField() throws Exception {
    String valid = "{\"summary\":\"盖住盖子\",\"shots\":[{\"sourceIndex\":1,\"start\":0,\"end\":1.35,\"text\":\"字符 }盖] 是原文\"},"
        + "{\"sourceIndex\":2,\"start\":1.35,\"end\":8.11,\"text\":\"完整动作\"}]}";
    String invalid = valid.substring(0, valid.length() - 2) + "盖]}";
    assertEquals(mapper.readTree(valid), parser.read("```json\n" + invalid + "\n```"));
    assertEquals(mapper.readTree(valid), parser.read(invalid.replace("完整动作\"}盖]", "完整动作\"} \n 盖 \n ]")));
    assertTrue(invalid.contains("}盖]}"), "The original saved response must remain unchanged");
  }

  @Test void acceptsExistingAgentJsonConventionsButLeavesSharedMapperStrict() throws Exception {
    var node = parser.read("```JSON\n{'shots':[{'motion':'第一行\n第二行',},],}\n```");
    assertEquals("第一行\n第二行", node.path("shots").get(0).path("motion").asText());
    assertThrows(Exception.class, () -> mapper.readTree("{'shots':[],}"));
  }

  @Test void neverGuessesMissingDataOrDiscardsExtraObjectsOrAmbiguousCharacters() {
    for (String text : List.of(
        "{\"shots\":[{\"duration\":1盖}]}",
        "{\"shots\":[{\"duration\":1}多字]}",
        "{\"shots\":[{\"duration\":1}盖,{}]}",
        "{\"shots\":[{\"duration\":1},盖]}",
        "{\"shots\":[{\"duration\":1}盖",
        "{\"shots\":[{\"duration\":1,\"duration\":2}]}",
        "{\"shots\":[{\"duration\":1}]} {\"more\":2}",
        "{\"shots\":[{\"duration\":1}盖]} explanatory text",
        "{\"shots\":[{\"text\":\"unfinished",
        "{\"shots\":[{\"duration\":1},,{}]}")) {
      assertTrue(assertThrows(ApiException.class, () -> parser.read(text)).getMessage().contains("格式不完整"));
    }
  }
}
