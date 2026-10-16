package com.youmi.api.image;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.ai.CanvasAgentService;
import com.youmi.api.ai.VisionElement;
import com.youmi.api.common.ApiException;
import java.util.List;
import org.junit.jupiter.api.Test;

class FaceDetectionControllerTest {
  private final CanvasAgentService agent = mock(CanvasAgentService.class);
  private final AdminAuthService auth = mock(AdminAuthService.class);
  private final FaceDetectionController controller = new FaceDetectionController(agent, auth);

  @Test void requiresAuthenticationBeforeDetection() throws Exception {
    when(auth.requireUserId(null)).thenThrow(new ApiException(401, "请登录"));
    assertThrows(ApiException.class, () -> controller.detect(null, new FaceDetectionController.Request("https://example.test/a.png")));
    verifyNoInteractions(agent);
  }

  @Test void returnsNormalizedFaceBoxesWithoutIdentityAttributes() throws Exception {
    when(auth.requireUserId("test")).thenReturn(1L);
    when(agent.detectImageFaces("https://example.test/a.png"))
        .thenReturn(List.of(new VisionElement("面部1", List.of(.1, .2, .3, .4))));
    var result = controller.detect("test", new FaceDetectionController.Request("https://example.test/a.png"));
    assertEquals(0, result.code());
    assertEquals("face-1", result.data().faces().get(0).id());
    assertEquals(List.of(.1, .2, .3, .4), result.data().faces().get(0).box());
  }

  @Test void rejectsInvalidImagesWithoutFetchingOrCallingVision() {
    for (String url : new String[] {"", "file:///secret.png", "http://localhost/a", "https://127.0.0.1/a", "https://[::1]/a", "data:text/html;base64,YQ==", "data:image/svg+xml;base64,YQ=="})
      assertThrows(ApiException.class, () -> FaceDetectionController.validateImage(url));
    verifyNoInteractions(agent);
  }

  @Test void acceptsSupportedUploadedImages() {
    assertDoesNotThrow(() -> FaceDetectionController.validateImage("data:image/png;base64,dGVzdA=="));
    assertDoesNotThrow(() -> FaceDetectionController.validateImage("https://assets.example.test/photo.webp"));
  }
}
