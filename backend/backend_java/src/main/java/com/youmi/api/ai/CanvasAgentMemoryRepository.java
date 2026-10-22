package com.youmi.api.ai;

import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class CanvasAgentMemoryRepository {
  public record Memory(int sourceCount, String sourceHash, String summary) {}
  private final JdbcTemplate jdbc;

  public CanvasAgentMemoryRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

  public Optional<Memory> find(Long userId, String canvasId, String conversationId) {
    List<Memory> rows = jdbc.query("""
        SELECT source_count, source_hash, summary_text FROM ym_agent_context_memory
        WHERE user_id = ? AND canvas_id = ? AND conversation_id = ?
        """, (rs, index) -> new Memory(rs.getInt(1), rs.getString(2), rs.getString(3)),
        userId, canvasId, conversationId);
    return rows.stream().findFirst();
  }

  public void save(Long userId, String canvasId, String conversationId, Memory memory) {
    jdbc.update("""
        INSERT INTO ym_agent_context_memory
          (user_id, canvas_id, conversation_id, source_count, source_hash, summary_text)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE source_count = VALUES(source_count),
          source_hash = VALUES(source_hash), summary_text = VALUES(summary_text), updated_at = CURRENT_TIMESTAMP
        """, userId, canvasId, conversationId, memory.sourceCount(), memory.sourceHash(), memory.summary());
  }

  public void delete(Long userId, String canvasId, String conversationId) {
    jdbc.update("DELETE FROM ym_agent_context_memory WHERE user_id = ? AND canvas_id = ? AND conversation_id = ?",
        userId, canvasId, conversationId);
  }
}
