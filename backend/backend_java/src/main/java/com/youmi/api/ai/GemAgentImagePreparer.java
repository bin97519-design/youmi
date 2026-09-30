package com.youmi.api.ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import java.awt.Color;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.TimeUnit;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class GemAgentImagePreparer {
  private static final long MAX_PIXELS = 64_000_000;
  private static final String FORMATS = "png_pipe,jpeg_pipe,webp_pipe,mov,mp4,m4a,3gp,3g2,mj2,heif";
  private final ObjectMapper mapper;
  private final String ffmpeg;
  private final String ffprobe;

  public GemAgentImagePreparer(ObjectMapper mapper,
      @Value("${YOUMI_FFMPEG:ffmpeg}") String ffmpeg,
      @Value("${YOUMI_FFPROBE:ffprobe}") String ffprobe) {
    this.mapper = mapper;
    this.ffmpeg = ffmpeg;
    this.ffprobe = ffprobe;
  }

  public record ImageData(String mimeType, byte[] bytes) {}

  ImageData prepare(ImageData source, int maxBytes) throws Exception {
    if (source.bytes().length <= maxBytes) return source;
    Path directory = Files.createTempDirectory("youmi-agent-image-");
    Path input = directory.resolve("source.img");
    Path probe = directory.resolve("probe.json");
    Path output = directory.resolve("analysis.png");
    try {
      Files.write(input, source.bytes());
      run(List.of(ffprobe, "-v", "error", "-protocol_whitelist", "file,pipe",
          "-format_whitelist", FORMATS, "-select_streams", "v:0", "-show_entries", "stream=width,height",
          "-of", "json", input.toString()), probe, 10);
      var metadata = mapper.readTree(Files.readString(probe)).path("streams").path(0);
      int width = metadata.path("width").asInt(), height = metadata.path("height").asInt();
      if (width <= 0 || height <= 0 || width > 32768 || height > 32768 || (long) width * height > MAX_PIXELS) {
        throw new ApiException(400, "参考图像素尺寸过大或无法识别，请缩小到 6400 万像素以内");
      }
      // Decode only local bytes. Keep orientation and aspect ratio; never replace the user's original.
      run(List.of(ffmpeg, "-nostdin", "-y", "-v", "error", "-threads", "1",
          "-protocol_whitelist", "file,pipe", "-format_whitelist", FORMATS, "-i", input.toString(),
          "-map", "0:v:0", "-frames:v", "1", "-vf",
          "scale=w='min(3072,iw)':h='min(3072,ih)':force_original_aspect_ratio=decrease",
          "-threads", "1", "-update", "1", output.toString()), null, 30);
      if (!Files.exists(output) || Files.size(output) > 40L * 1024 * 1024) {
        throw new ApiException(400, "参考图分析副本过大，请缩小图片后重试");
      }
      BufferedImage decoded = ImageIO.read(output.toFile());
      if (decoded == null || decoded.getWidth() > 3072 || decoded.getHeight() > 3072) {
        throw new ApiException(400, "参考图无法解码，请重新导出 JPG 或 PNG 后上传");
      }
      try {
        for (int edge : new int[] {3072, 2048, 1536, 1024}) {
          BufferedImage image = onWhite(decoded, edge);
          try {
            for (float quality : new float[] {0.92f, 0.82f, 0.72f}) {
              byte[] bytes = jpeg(image, quality);
              if (bytes.length <= maxBytes) return new ImageData("image/jpeg", bytes);
            }
          } finally { image.flush(); }
        }
      } finally { decoded.flush(); }
      throw new ApiException(400, "参考图压缩后仍过大，请减少参考图或缩小图片后重试");
    } finally {
      for (Path path : List.of(output, probe, input, directory)) {
        try { Files.deleteIfExists(path); } catch (IOException ignored) { }
      }
    }
  }

  private static BufferedImage onWhite(BufferedImage source, int edge) {
    double scale = Math.min(1.0, (double) edge / Math.max(source.getWidth(), source.getHeight()));
    var image = new BufferedImage(Math.max(1, (int) Math.round(source.getWidth() * scale)),
        Math.max(1, (int) Math.round(source.getHeight() * scale)), BufferedImage.TYPE_INT_RGB);
    var graphics = image.createGraphics();
    try {
      graphics.setColor(Color.WHITE);
      graphics.fillRect(0, 0, image.getWidth(), image.getHeight());
      graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
      graphics.drawImage(source, 0, 0, image.getWidth(), image.getHeight(), null);
    } finally { graphics.dispose(); }
    return image;
  }

  private static byte[] jpeg(BufferedImage image, float quality) throws IOException {
    var writer = ImageIO.getImageWritersByFormatName("jpeg").next();
    try (var bytes = new ByteArrayOutputStream(); var output = ImageIO.createImageOutputStream(bytes)) {
      writer.setOutput(output);
      var options = writer.getDefaultWriteParam();
      options.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
      options.setCompressionQuality(quality);
      writer.write(null, new IIOImage(image, null, null), options);
      output.flush();
      return bytes.toByteArray();
    } finally { writer.dispose(); }
  }

  private static void run(List<String> command, Path output, int timeoutSeconds) throws Exception {
    Process process = null;
    try {
      var builder = new ProcessBuilder(command).redirectError(ProcessBuilder.Redirect.DISCARD);
      if (output == null) builder.redirectOutput(ProcessBuilder.Redirect.DISCARD);
      else builder.redirectOutput(output.toFile());
      process = builder.start();
      if (!process.waitFor(timeoutSeconds, TimeUnit.SECONDS)) {
        throw new ApiException(400, "参考图处理超时，请缩小图片后重试");
      }
      if (process.exitValue() != 0) throw new ApiException(400, "参考图无法解码，请重新导出 JPG 或 PNG 后上传");
    } catch (IOException error) {
      throw new ApiException(503, "大图处理组件不可用，请联系管理员检查图片处理服务");
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
      throw new ApiException(503, "参考图处理已中断，请重试");
    } finally {
      if (process != null && process.isAlive()) {
        process.destroyForcibly();
        try { process.waitFor(5, TimeUnit.SECONDS); }
        catch (InterruptedException error) { Thread.currentThread().interrupt(); }
      }
    }
  }
}
