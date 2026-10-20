// Our local carousel tuning, not timings measured from the reference website.
const PIXELS_PER_LINE = 16
const PIXELS_PER_PAGE = 800
const WHEEL_THRESHOLD = 28
const WHEEL_COOLDOWN_MS = 160
const WHEEL_QUIET_MS = 180

/**
 * Convert predominantly vertical wheel gestures into one-item navigation.
 * The caller owns preventDefault and supplies a monotonic timestamp; no DOM or timers are used.
 * A decaying tail stays suppressed until a pause, a new strong impulse, or a direction reversal.
 */
export function createCharacterWheelNavigator() {
  let direction = 0
  let accumulated = 0
  let lastEventAt = -Infinity
  let lastTriggeredAt = -Infinity
  let lastMagnitude = 0
  let peakMagnitude = 0
  let fired = false
  let tailing = false

  function reset() {
    direction = 0
    accumulated = 0
    lastEventAt = -Infinity
    lastTriggeredAt = -Infinity
    lastMagnitude = 0
    peakMagnitude = 0
    fired = false
    tailing = false
  }

  function consume(event, now) {
    if (!event || event.ctrlKey || event.metaKey || !Number.isFinite(now)) return 0
    const deltaY = event.deltaY
    const deltaX = event.deltaX ?? 0
    if (
      !Number.isFinite(deltaY) ||
      !Number.isFinite(deltaX) ||
      deltaY === 0 ||
      Math.abs(deltaX) > Math.abs(deltaY)
    )
      return 0

    const nextDirection = Math.sign(deltaY)
    if (nextDirection !== direction || now < lastEventAt || now - lastEventAt >= WHEEL_QUIET_MS)
      reset()
    direction = nextDirection
    lastEventAt = now

    const multiplier =
      event.deltaMode === 1 ? PIXELS_PER_LINE : event.deltaMode === 2 ? PIXELS_PER_PAGE : 1
    // An extreme delta is still a single gesture, never a backlog of queued steps.
    const magnitude = Math.min(4096, Math.abs(deltaY) * multiplier)
    const newImpulse =
      magnitude >= WHEEL_THRESHOLD &&
      (magnitude > lastMagnitude * 1.8 || magnitude >= peakMagnitude * 0.9)
    if (fired && magnitude < peakMagnitude * 0.75 && magnitude <= lastMagnitude * 1.05)
      tailing = true
    if (tailing && newImpulse && now - lastTriggeredAt >= WHEEL_COOLDOWN_MS) {
      tailing = false
      accumulated = 0
      peakMagnitude = magnitude
    }
    peakMagnitude = Math.max(peakMagnitude, magnitude)
    lastMagnitude = magnitude

    if (tailing || now - lastTriggeredAt < WHEEL_COOLDOWN_MS) {
      accumulated = 0
      return 0
    }
    accumulated += magnitude
    if (accumulated < WHEEL_THRESHOLD) return 0
    accumulated = 0
    lastTriggeredAt = now
    fired = true
    return direction
  }

  return { consume, reset }
}

const DRAG_HYSTERESIS_PX = 6
const DRAG_HISTORY_MS = 80
const DRAG_STATIONARY_MS = 100
const DRAG_PROJECTION_SECONDS = 0.12
const DRAG_EDGE_LIMIT = 0.2
const DRAG_MAX_VELOCITY = 40
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const validPointerId = (value) => Number.isFinite(value) && Number.isInteger(value)

function dragEdgePosition(position, max) {
  if (position < 0) return -((-position * DRAG_EDGE_LIMIT) / (DRAG_EDGE_LIMIT - position))
  if (position > max) {
    const excess = position - max
    return max + (excess * DRAG_EDGE_LIMIT) / (DRAG_EDGE_LIMIT + excess)
  }
  return position
}

// Invert the edge material when grabbing a still-settling overscrolled presentation.
function dragRawPosition(position, max) {
  if (position < 0) {
    const excess = Math.min(-position, DRAG_EDGE_LIMIT - 0.000001)
    return -(excess * DRAG_EDGE_LIMIT) / (DRAG_EDGE_LIMIT - excess)
  }
  if (position > max) {
    const excess = Math.min(position - max, DRAG_EDGE_LIMIT - 0.000001)
    return max + (excess * DRAG_EDGE_LIMIT) / (DRAG_EDGE_LIMIT - excess)
  }
  return position
}

/**
 * Pure pointer gesture state for a horizontally draggable carousel.
 * Positions/velocities are in items and items/s. The caller supplies the real card step and clock,
 * owns pointer capture, and suppresses click/double-click after a returned dragged:true result.
 */
export function createCharacterDragNavigator() {
  let gesture = null

  function reset() {
    gesture = null
  }

  function start(input) {
    if (
      gesture ||
      !input ||
      !validPointerId(input.pointerId) ||
      ![input.x, input.y, input.position, input.step, input.max, input.now].every(
        Number.isFinite,
      ) ||
      input.step <= 0 ||
      input.max < 0
    )
      return false
    const max = Math.floor(Math.min(1_000_000, input.max))
    const position = clamp(
      input.position,
      -DRAG_EDGE_LIMIT + 0.000001,
      max + DRAG_EDGE_LIMIT - 0.000001,
    )
    gesture = {
      pointerId: input.pointerId,
      startX: input.x,
      startY: input.y,
      rawStart: dragRawPosition(position, max),
      position,
      step: input.step,
      max,
      dragged: false,
      cancelled: false,
      velocity: 0,
      lastX: input.x,
      lastMoveAt: input.now,
      lastMotionAt: input.now,
      history: [{ now: input.now, position }],
    }
    return true
  }

  function move(input) {
    if (
      !gesture ||
      !input ||
      input.pointerId !== gesture.pointerId ||
      ![input.x, input.y, input.now].every(Number.isFinite)
    )
      return null
    if (gesture.cancelled) return null
    const dx = input.x - gesture.startX
    const dy = input.y - gesture.startY
    // Finite endpoints may still overflow when subtracted. Ignore rather than contaminating state.
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null
    if (!gesture.dragged) {
      if (Math.abs(dy) >= DRAG_HYSTERESIS_PX && Math.abs(dy) > Math.abs(dx)) {
        gesture.cancelled = true
        return { position: gesture.position, velocity: 0, dragged: false, cancelled: true }
      }
      if (Math.abs(dx) < DRAG_HYSTERESIS_PX) return null
      gesture.dragged = true
    }

    const raw = gesture.rawStart - dx / gesture.step
    if (!Number.isFinite(raw)) return null
    const position = dragEdgePosition(raw, gesture.max)
    if (input.now < gesture.lastMoveAt) {
      gesture.history = []
      gesture.velocity = 0
    }
    if (input.x !== gesture.lastX) gesture.lastMotionAt = input.now
    gesture.lastX = input.x
    gesture.lastMoveAt = input.now
    gesture.position = position
    gesture.history = gesture.history.filter(
      (sample) => sample.now >= input.now - DRAG_HISTORY_MS && sample.now < input.now,
    )
    gesture.history.push({ now: input.now, position })
    if (gesture.history.length > 40) gesture.history.shift()
    const oldest = gesture.history[0]
    const elapsed = input.now - oldest.now
    const speed = elapsed > 0 ? (position - oldest.position) / (elapsed / 1000) : 0
    gesture.velocity = Number.isFinite(speed)
      ? clamp(speed, -DRAG_MAX_VELOCITY, DRAG_MAX_VELOCITY)
      : 0
    return { position, velocity: gesture.velocity, dragged: true }
  }

  function end(input) {
    if (!gesture || !input || input.pointerId !== gesture.pointerId || !Number.isFinite(input.now))
      return null
    const current = gesture
    reset()
    const stationary =
      input.now - current.lastMotionAt > DRAG_STATIONARY_MS || input.now < current.lastMoveAt
    const velocity =
      !current.dragged || current.cancelled || input.cancelled || stationary ? 0 : current.velocity
    const projected = current.position + clamp(velocity * DRAG_PROJECTION_SECONDS, -1, 1)
    const index = Math.round(clamp(projected, 0, current.max))
    return { index, position: current.position, velocity, dragged: current.dragged }
  }

  return { start, move, end, reset }
}

const SPRING_OMEGA = 20
const MAX_FRAME_SECONDS = 1 / 30
const POSITION_EPSILON = 0.0005
const VELOCITY_EPSILON = 0.005
const NUMERIC_LIMIT = 1_000_000

function finiteBound(value, fallback) {
  return Number.isFinite(value)
    ? Math.max(-NUMERIC_LIMIT, Math.min(NUMERIC_LIMIT, value))
    : fallback
}

/**
 * Analytic critically damped spring, tuned to about 0.3 s for a one-item move.
 * Position and velocity are carried into every re-target; no transition restarts or timers.
 * Clamp long/background frames and crossing the target rather than permitting overshoot.
 */
export function stepCharacterSpring(state, target, dtSeconds) {
  const position = finiteBound(state?.position, finiteBound(target, 0))
  const velocity = finiteBound(state?.velocity, 0)
  const goal = finiteBound(target, position)
  const dt = Number.isFinite(dtSeconds) ? Math.max(0, Math.min(MAX_FRAME_SECONDS, dtSeconds)) : 0
  const offset = position - goal
  const alreadySettled =
    Math.abs(offset) <= POSITION_EPSILON && Math.abs(velocity) <= VELOCITY_EPSILON
  if (!dt) return { position, velocity, settled: alreadySettled }
  if (!offset || alreadySettled) return { position: goal, velocity: 0, settled: true }

  const decay = Math.exp(-SPRING_OMEGA * dt)
  const coefficient = velocity + SPRING_OMEGA * offset
  const nextPosition = goal + (offset + coefficient * dt) * decay
  const nextVelocity = (velocity - SPRING_OMEGA * coefficient * dt) * decay
  const nextOffset = nextPosition - goal
  const settled =
    offset * nextOffset <= 0 ||
    (Math.abs(nextOffset) <= POSITION_EPSILON && Math.abs(nextVelocity) <= VELOCITY_EPSILON)
  return settled
    ? { position: goal, velocity: 0, settled: true }
    : { position: nextPosition, velocity: nextVelocity, settled: false }
}
