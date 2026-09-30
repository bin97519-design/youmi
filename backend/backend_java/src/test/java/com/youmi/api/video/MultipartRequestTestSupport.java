package com.youmi.api.video;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.apache.tomcat.util.http.fileupload.MultipartStream;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

final class MultipartRequestTestSupport {
  record FilePart(String name, String filename, String contentType, byte[] bytes) { }
  record Parsed(Map<String, String> fields, List<FilePart> files) { }

  static Parsed parse(String contentType, InputStream input) throws java.io.IOException {
    MediaType type = MediaType.parseMediaType(contentType);
    if (!MediaType.MULTIPART_FORM_DATA.isCompatibleWith(type)) throw new java.io.IOException("Expected multipart/form-data");
    String boundary = type.getParameter("boundary");
    if (boundary == null || boundary.isBlank()) throw new java.io.IOException("Missing boundary");
    var multipart = new MultipartStream(input, boundary.replace("\"", "").getBytes(StandardCharsets.US_ASCII), 4096, null);
    multipart.setHeaderEncoding("UTF-8");
    var fields = new LinkedHashMap<String, String>();
    var files = new ArrayList<FilePart>();
    boolean more = multipart.skipPreamble();
    while (more) {
      var headers = new HttpHeaders();
      for (String line : multipart.readHeaders().split("\r\n")) {
        int colon = line.indexOf(':');
        if (colon > 0) headers.add(line.substring(0, colon), line.substring(colon + 1).trim());
      }
      var disposition = headers.getContentDisposition();
      var output = new ByteArrayOutputStream();
      multipart.readBodyData(output);
      if (disposition.getFilename() == null) fields.put(disposition.getName(), output.toString(StandardCharsets.UTF_8));
      else files.add(new FilePart(disposition.getName(), disposition.getFilename(), headers.getFirst("Content-Type"), output.toByteArray()));
      more = multipart.readBoundary();
    }
    return new Parsed(fields, files);
  }
}
