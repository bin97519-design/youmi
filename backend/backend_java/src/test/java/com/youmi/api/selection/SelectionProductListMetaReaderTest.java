package com.youmi.api.selection;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.StringReader;
import org.junit.jupiter.api.Test;

class SelectionProductListMetaReaderTest {
  private SelectionPoolDtos.ProductListMeta read(String json) {
    return SelectionProductListMetaReader.read(new ObjectMapper(), new StringReader(json));
  }

  @Test void legacyAliasesEmptyPrimaryAndNestedMetadataAreHandled() {
    var meta = read("""
        {"skuGroups":[],"saleProperties":[{},{}],"skus":[],"sku":[{},{},{}],"skuList":[{}],
         "categoryName":"旧类目","category":{"name":"床垫"},"productType":"COLLECTED",
         "skuSplit":{"part":2,"groupName":"尺寸","valueNames":["不应带入摘要"]},
         "media":{"mainImages":[{"url":"https://img.test/first"},"https://img.test/second"],"detailImages":["skip"]}}
        """);
    assertEquals(2, meta.skuGroupCount());
    assertEquals(3, meta.skuCount());
    assertEquals("床垫", meta.categoryName());
    assertEquals(2, meta.skuSplit().part());
    assertEquals("https://img.test/first", meta.fallbackCoverImageUrl());
  }

  @Test void malformedOrUnusualLegacyJsonDoesNotBreakList() {
    assertEquals(0, read("{\"skus\":[{}").skuCount());
    assertEquals(0, read("null").skuCount());
    assertEquals(0, read("{}").skuCount());
    assertEquals(0, read("{\"skus\":{},\"skuGroups\":null,\"category\":[]}").skuCount());
  }
}
