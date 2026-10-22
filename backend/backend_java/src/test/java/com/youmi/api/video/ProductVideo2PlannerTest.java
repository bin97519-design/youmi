package com.youmi.api.video;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.ai.AgentChatClient;
import com.youmi.api.ai.AiChatDtos;
import com.youmi.api.ai.GemAgentClient;
import com.youmi.api.common.ApiException;
import com.youmi.api.image.ModelApiKeyService;
import java.nio.file.Path;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ProductVideo2PlannerTest {
  @TempDir Path dir;
  final ObjectMapper mapper = new ObjectMapper();
  final AgentChatClient client = mock(AgentChatClient.class);
  final ModelApiKeyService keys = mock(ModelApiKeyService.class);
  final ModelApiKeyService.ResolvedModelApiKey key = new ModelApiKeyService.ResolvedModelApiKey(
      12, "gem-3-pro", "test", "http://localhost", "/v1beta/models/gem-3-pro:generateContent", "", "test-key", Map.of());
  final AtomicInteger downloads = new AtomicInteger();
  final Map<String,String> responses = new HashMap<>();
  ProductVideo2Planner planner() {
    when(keys.resolve("gem-3-pro", ModelApiKeyService.MODEL_TYPE_VISION_REASONING, "canvas-agent")).thenReturn(java.util.Optional.of(key));
    return new ProductVideo2Planner(client, mapper, keys, url -> { downloads.incrementAndGet(); return new ProductVideo2Planner.VideoData("video/mp4", new byte[]{1,2,3,4}); });
  }
  ProductVideoDtos.PlanRequest request(Double seconds) throws Exception {
    return new ProductVideoDtos.PlanRequest(mapper.writeValueAsString(Map.of("productName", "日式窗帘", "sellingPoints", "用户确认的独有卖点")),
        List.of("https://assets.example/original.png"), seconds == null ? 1 : (int)Math.ceil(seconds/30), "3:4", null, null,
        ProductVideo2Planner.MODE, null, true, seconds == null ? null : new ProductVideoDtos.ReferenceVideo("https://assets.example/original.mp4", "source", seconds, null, null, "", List.of()), "gem-3-pro");
  }
  ProductVideoPlanService.ProgressListener progress() {
    return new ProductVideoPlanService.ProgressListener() {
      public void save(String stage, com.fasterxml.jackson.databind.JsonNode outline, List<ProductVideoDtos.ShotPlan> shots, String provider) {}
      public String previousResponse(String stage) { return responses.get(stage); }
      public void response(String stage, String content) { responses.put(stage, content); }
    };
  }
  String script(int count, boolean dynamic) {
    double[] ends = new double[count];
    for (int i = 0; i < count; i++) ends[i] = Math.round((dynamic ? 30.0 : 15.0) * (i + 1) * (i + 2) / (count * (count + 1)) * 100) / 100.0;
    return scriptWithTimes(dynamic, ends);
  }
  String scriptWithTimes(boolean dynamic, double... ends) {
    StringBuilder value = new StringBuilder("根据以下分镜描述生成：图1【日式窗帘】【情景种草】真实短视频，不生成任何字幕\n分镜设计：\n");
    for (int i=0; i<ends.length; i++) value.append("分镜").append(i+1).append("（").append(i == 0 ? 0.0 : ends[i-1]).append("秒-").append(ends[i]).append("秒）：参考图1的窗帘轮廓与材质，女生顺势拉拢窗帘。").append(dynamic ? "动态还原：面料从手部接触处向两侧形成连续褶皱，光线由亮变暗，摄影机固定。" : "").append('\n');
    return value.append("口播设计：\n无口播，保留原片音乐节拍与布料摩擦声。\n").toString().trim();
  }
  String analysis(double start, double end) throws Exception {
    return mapper.writeValueAsString(Map.of("shots", List.of(Map.of("sourceStart",start,"sourceEnd",end,
        "startState","窗帘打开","action","人手沿轨道拉拢面料","endState","窗帘闭合","cameraMotion","固定机位",
        "materialMotion","褶皱随牵引从内沿向外侧传播后停住","lightMotion","光线渐暗","transition","原片硬切","sound","音乐与布料摩擦")),
        "sound",Map.of("hasVoice",false,"hasBgm",true,"voiceSegments",List.of(),"description","原片音乐主导，动作摩擦声较弱")));
  }
  void mockScript(String value) throws Exception {
    when(client.completeConfiguredModel(eq(key), anyString(), anyString(), anyList(), anyDouble(), eq("product-video2-planning"), anyString(), anyInt(), any(Duration.class)))
        .thenReturn(new AiChatDtos.CompletionResult("test","gem-3-pro",value));
  }
  void mockAnalysis() throws Exception {
    when(client.completeConfiguredMedia(eq(key), anyString(), anyString(), eq(List.of()), anyDouble(), eq("product-video2-planning"), anyString(), anyInt(), any(Duration.class), anyMap()))
        .thenAnswer(invocation -> {
          Map<?,?> part = invocation.getArgument(9); Map<?,?> metadata = (Map<?,?>)part.get("videoMetadata");
          double from=Double.parseDouble(metadata.get("startOffset").toString().replace("s","")), to=Double.parseDouble(metadata.get("endOffset").toString().replace("s",""));
          return new AiChatDtos.CompletionResult("test","gem-3-pro",analysis(from,to));
        });
  }
  @Test void creativePlanningUsesTheCompleteUploadedRulesAndReturnsOnlyThePlainScript() throws Exception {
    var planner=planner(); mockScript(script(4,false));
    var result=planner.plan(request(null),progress());
    assertEquals(1,result.shots().size()); assertEquals(15,result.shots().get(0).duration());
    assertEquals("single_video",result.shots().get(0).productionMode());
    assertEquals(script(4,false),result.shots().get(0).motion()); assertEquals("",result.shots().get(0).caption());
    var system=ArgumentCaptor.forClass(String.class); var input=ArgumentCaptor.forClass(String.class);
    verify(client).completeConfiguredModel(eq(key),system.capture(),input.capture(),eq(request(null).images()),eq(.45),eq("product-video2-planning"),eq("dropdown"),eq(16000),eq(Duration.ofMinutes(30)));
    for(String section:List.of("维度1：创意类型","维度5：尾部结尾转化","柔性材质动态","一个口播对应多个分镜","十五、多轮交互规则")) assertTrue(system.getValue().contains(section),section);
    assertTrue(system.getValue().length()>18000);
    assertTrue(system.getValue().contains("每镜标题必须为“分镜N（起始秒数秒-结束秒数秒）：”"));
    assertTrue(system.getValue().contains("禁止预设每镜固定时长或机械均分"));
    assertFalse(system.getValue().contains("不需要在输出中写分镜时长"));
    assertEquals("用户确认的独有卖点",mapper.readTree(input.getValue()).path("userInput").path("sellingPoints").asText());
    assertEquals(0,downloads.get()); verify(client,never()).completeConfiguredMedia(any(),anyString(),anyString(),anyList(),anyDouble(),anyString(),anyString(),anyInt(),any(),anyMap());
  }
  @Test void referenceAnalysisReceivesOriginalVideoAndAudioBeforeAnyProductMaterial() throws Exception {
    var planner=planner(); mockAnalysis(); mockScript(script(1,true));
    var result=planner.plan(request(15.0),progress());
    assertEquals(30,result.shots().get(0).duration()); assertEquals("single_video_30",result.shots().get(0).productionMode());
    var source=ArgumentCaptor.forClass(String.class); var part=ArgumentCaptor.forClass(Map.class);
    verify(client).completeConfiguredMedia(eq(key),anyString(),source.capture(),eq(List.of()),eq(.15),eq("product-video2-planning"),eq("dropdown"),eq(16000),eq(Duration.ofMinutes(30)),part.capture());
    assertFalse(source.getValue().contains("日式窗帘")); assertFalse(source.getValue().contains("独有卖点"));
    var json=mapper.valueToTree(part.getValue());
    assertEquals("video/mp4",json.path("inlineData").path("mimeType").asText()); assertEquals("AQIDBA==",json.path("inlineData").path("data").asText());
    assertEquals(5,json.path("videoMetadata").path("fps").asInt());
    assertEquals("0.0s",json.path("videoMetadata").path("startOffset").asText());
    assertEquals("15.0s",json.path("videoMetadata").path("endOffset").asText());
    var creation=ArgumentCaptor.forClass(String.class);
    verify(client).completeConfiguredModel(eq(key),anyString(),creation.capture(),eq(request(15.0).images()),anyDouble(),anyString(),anyString(),anyInt(),any());
    assertTrue(mapper.readTree(creation.getValue()).path("lockedReference").path("shots").isArray());
  }
  @Test void longReferencesAreSplitInOrderAndTailStillProducesAThirtySecondScript() throws Exception {
    var planner=planner(); mockAnalysis(); mockScript(script(1,true));
    var result=planner.plan(request(65.0),progress());
    assertEquals(3,result.shots().size()); assertTrue(result.shots().stream().allMatch(shot->shot.duration()==30));
    assertTrue(responses.get("video2-analysis-0").contains("30.0"));
    assertTrue(responses.get("video2-analysis-2").contains("65.0"));
    assertEquals(1,downloads.get());
    verify(client,times(3)).completeConfiguredMedia(any(),anyString(),anyString(),eq(List.of()),anyDouble(),anyString(),anyString(),anyInt(),any(),anyMap());
  }
  @Test void retryReusesTheLockedSourceInsteadOfDownloadingOrAnalyzingAgain() throws Exception {
    var planner=planner(); mockAnalysis();
    when(client.completeConfiguredModel(eq(key),anyString(),anyString(),anyList(),anyDouble(),anyString(),anyString(),anyInt(),any()))
        .thenThrow(new ApiException(502,"temporary failure")).thenReturn(new AiChatDtos.CompletionResult("test","gem-3-pro",script(1,true)));
    assertThrows(ApiException.class,()->planner.plan(request(12.0),progress()));
    assertNotNull(responses.get("video2-analysis-0")); assertNull(responses.get("video2-script-0"));
    assertEquals(1,planner.plan(request(12.0),progress()).shots().size());
    assertEquals(1,downloads.get()); verify(client,times(1)).completeConfiguredMedia(any(),anyString(),anyString(),anyList(),anyDouble(),anyString(),anyString(),anyInt(),any(),anyMap());
  }
  @Test void malformedCoverageInventedVoiceAndWrongShotCountsAreRejected() throws Exception {
    var planner=planner(); var locked=planner.parseAnalysis(analysis(0,15),0,15); var input=mapper.readTree(request(15.0).brief());
    assertThrows(ApiException.class,()->planner.parseAnalysis(analysis(1,15),0,15));
    assertThrows(ApiException.class,()->planner.validateScript(script(2,true),1,locked,input));
    assertThrows(ApiException.class,()->planner.validateScript(script(1,false),1,locked,input));
    assertThrows(ApiException.class,()->planner.validateScript(script(1,true).replace("无口播","口播1（对应分镜1）：虚构台词"),1,locked,input));
    assertThrows(ApiException.class,()->planner.validateScript(script(3,false),0,null,input));
  }
  @Test void creativeShotsAcceptContentDrivenDecimalTimesAndRejectMissingGapsOverlapsOrIncompleteCoverage() throws Exception {
    var planner=planner(); var input=mapper.readTree(request(null).brief());
    String valid=scriptWithTimes(false,2,6.5,10,15);
    assertEquals(valid,planner.validateScript(valid,0,null,input));
    for(String invalid:List.of(
        valid.replace("分镜1（0.0秒-2.0秒）：","分镜1："),
        valid.replace("分镜1（0.0秒-2.0秒）：","分镜1（0.5秒-2.0秒）："),
        valid.replace("分镜2（2.0秒-6.5秒）：","分镜2（2.5秒-6.5秒）："),
        valid.replace("分镜2（2.0秒-6.5秒）：","分镜2（1.8秒-6.5秒）："),
        valid.replace("分镜2（2.0秒-6.5秒）：","分镜2（2.0秒-2.0秒）："),
        valid.replace("分镜4（10.0秒-15.0秒）：","分镜4（10.0秒-14.0秒）："),
        valid.replace("分镜4（10.0秒-15.0秒）：","分镜4（10.0秒-16.0秒）：")))
      assertThrows(ApiException.class,()->planner.validateScript(invalid,0,null,input),invalid);
    assertEquals(valid.replace("（2.0秒-6.5秒）：","(2.0-6.5秒):"),
        planner.validateScript(valid.replace("（2.0秒-6.5秒）：","(2.0-6.5秒):"),0,null,input));
  }
  @Test void planningIntentSeparatesFreshPlanningLocalEditsAndAlternativeIdeasWithoutFixingFiveShots() throws Exception {
    var planner = planner();
    var inputs = ArgumentCaptor.forClass(String.class);
    int count = 4;
    for (String intent : List.of("plan", "revise", "variant", "")) {
      responses.clear(); mockScript(script(count,false));
      com.fasterxml.jackson.databind.node.ObjectNode tree=mapper.valueToTree(request(null));
      tree.put("brief",mapper.writeValueAsString(Map.of("productName","日式窗帘","sellingPoints","用户确认的独有卖点",
          "planningIntent",intent,"revision",intent.isEmpty() ? "" : "修改意见","previousScript","旧的五镜模板",
          "previousScripts",List.of("完整的局部修改原稿"),"previousCreative",List.of(Map.of("opening","旧的开场")))));
      var result = planner.plan(mapper.treeToValue(tree,ProductVideoDtos.PlanRequest.class),progress());
      assertEquals(script(count,false),result.shots().get(0).motion()); count++;
    }
    verify(client,times(4)).completeConfiguredModel(eq(key),anyString(),inputs.capture(),eq(request(null).images()),anyDouble(),anyString(),anyString(),anyInt(),any());
    var fresh=mapper.readTree(inputs.getAllValues().get(0)).path("userInput");
    assertFalse(fresh.has("previousScript")); assertFalse(fresh.has("previousScripts")); assertFalse(fresh.has("previousCreative")); assertFalse(fresh.has("revision"));
    assertEquals("用户确认的独有卖点",fresh.path("sellingPoints").asText());
    var revision=mapper.readTree(inputs.getAllValues().get(1)).path("userInput");
    assertEquals("完整的局部修改原稿",revision.path("previousScript").asText());
    var variant=mapper.readTree(inputs.getAllValues().get(2)).path("userInput");
    assertFalse(variant.has("previousScript")); assertFalse(variant.has("previousScripts"));
    assertEquals("旧的开场",variant.path("previousCreative").path(0).path("opening").asText());
    var legacy=mapper.readTree(inputs.getAllValues().get(3)).path("userInput");
    assertEquals("plan",legacy.path("planningIntent").asText()); assertFalse(legacy.has("previousScript"));
  }
  @Test void referenceShotTimesAreRelativeToTheSourceUnitAndPreserveItsActualUnequalRhythm() throws Exception {
    var planner=planner(); var input=mapper.readTree(request(40.0).brief());
    com.fasterxml.jackson.databind.node.ObjectNode locked=mapper.readTree(analysis(30,40)).deepCopy();
    var shots=mapper.createArrayNode();
    var first=locked.path("shots").path(0).deepCopy();
    var second=locked.path("shots").path(0).deepCopy();
    ((com.fasterxml.jackson.databind.node.ObjectNode)first).put("sourceEnd",32);
    ((com.fasterxml.jackson.databind.node.ObjectNode)second).put("sourceStart",32);
    shots.add(first).add(second); locked.set("shots",shots);
    var validated=planner.parseAnalysis(locked.toString(),30,40);
    String valid=scriptWithTimes(true,6,30);
    assertEquals(valid,planner.validateScript(valid,2,validated,input));
    assertThrows(ApiException.class,()->planner.validateScript(scriptWithTimes(true,15,30),2,validated,input));
  }
  @Test void completedPlainScriptIsDurableAndIdempotentInTheExistingOwnedJobStorage() throws Exception {
    planner(); mockScript(script(4,false));
    var service=new ProductVideoPlanService(client,mapper,300,mock(GemAgentClient.class),keys);
    var jobs=new ProductVideoPlanJobs(service,mapper,dir.toString()); String id="main-video-2-durable";
    try {
      jobs.create(1L,new ProductVideoPlanJobs.CreateRequest(id,request(null)));
      long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(4);
      ProductVideoPlanJobs.State state;
      do { state=jobs.get(1L,id); if(List.of("failed","completed").contains(state.status()))break; Thread.sleep(10); } while(System.nanoTime()<deadline);
      assertEquals("completed",state.status(),state.error()); assertEquals(script(4,false),state.result().shots().get(0).motion());
      assertThrows(ApiException.class,()->jobs.get(2L,id));
    } finally { jobs.close(); }
    var reopened=new ProductVideoPlanJobs(service,mapper,dir.toString());
    try { assertEquals(script(4,false),reopened.create(1L,new ProductVideoPlanJobs.CreateRequest(id,request(null))).result().shots().get(0).motion()); }
    finally { reopened.close(); }
    verify(client,times(1)).completeConfiguredModel(any(),anyString(),anyString(),anyList(),anyDouble(),anyString(),anyString(),anyInt(),any());
  }
  @Test void newVersionsReuseOnlyTheSameUsersSourceAnalysisAndNeverThePreviousScriptResponse() throws Exception {
    var previous = request(15.0);
    String sourceId = "video2-locked-source";
    var state = new ProductVideoPlanJobs.State(sourceId,"completed","完成",1,"",new ProductVideoDtos.PlanResponse("test",List.of(),null),1);
    java.nio.file.Files.createDirectories(dir.resolve("1"));
    java.nio.file.Files.writeString(dir.resolve("1").resolve(sourceId+".json"),mapper.writeValueAsString(new ProductVideoPlanJobs.Saved(
        state,previous,null,Map.of("video2-analysis-0",analysis(0,15),"video2-script-0","旧脚本不可复用"))));
    com.fasterxml.jackson.databind.node.ObjectNode tree = mapper.valueToTree(previous);
    tree.put("brief",mapper.writeValueAsString(Map.of("sourceAnalysisJobId",sourceId,"revision","换卧室")));
    var updated = mapper.treeToValue(tree,ProductVideoDtos.PlanRequest.class);
    var service = mock(ProductVideoPlanService.class);
    when(service.plan(eq(updated),any(),anyList(),any())).thenAnswer(call -> {
      ProductVideoPlanService.ProgressListener progress = call.getArgument(3);
      assertNull(progress.previousResponse("video2-script-0"));
      return new ProductVideoDtos.PlanResponse(progress.previousResponse("video2-analysis-0") == null ? "no-source" : "locked-source",List.of(),null);
    });
    var jobs=new ProductVideoPlanJobs(service,mapper,dir.toString());
    try {
      for(long owner:List.of(1L,2L)) {
        String id="video2-new-version-"+owner;
        jobs.create(owner,new ProductVideoPlanJobs.CreateRequest(id,updated));
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(4);
        ProductVideoPlanJobs.State result;
        do { result=jobs.get(owner,id); if(List.of("completed","failed").contains(result.status()))break; Thread.sleep(10); } while(System.nanoTime()<deadline);
        assertEquals("completed",result.status()); assertEquals(owner==1 ? "locked-source" : "no-source",result.result().provider());
      }
    } finally {jobs.close();}
  }
}
