const bounded = (value) => Math.max(10, Math.min(90, Number.isFinite(value) ? value : 50))

export function moodPosition(x, y) {
  return { x: bounded(x), y: bounded(y) }
}

// Interpolate only the four neighbouring, aligned grey-model frames.
export function emotionWeights(x, y) {
  const point = moodPosition(x, y)
  const column = (point.x - 10) / 20
  const row = (point.y - 10) / 20
  const left = Math.min(3, Math.floor(column))
  const top = Math.min(3, Math.floor(row))
  const dx = column - left
  const dy = row - top
  const weights = Array(25).fill(0)
  weights[top * 5 + left] = (1 - dx) * (1 - dy)
  weights[top * 5 + left + 1] = dx * (1 - dy)
  weights[(top + 1) * 5 + left] = (1 - dx) * dy
  weights[(top + 1) * 5 + left + 1] = dx * dy
  return weights
}

// Plain opacity=weight darkens a source-over stack. Normalize by the weights
// already painted so the effective contributions sum to one, even mid-gesture.
export function emotionOpacities(weights) {
  let painted = 0
  return weights.map((weight) => {
    painted += weight
    return weight > 0 ? weight / painted : 0
  })
}

// Closed-form critically damped spring: stable at 60/120 Hz and after a slow frame.
export function emotionSpring(value, velocity, target, seconds, response = 0.3) {
  const omega = (2 * Math.PI) / response
  const offset = value - target
  const impulse = velocity + omega * offset
  const decay = Math.exp(-omega * Math.max(0, seconds))
  return {
    value: target + (offset + impulse * seconds) * decay,
    velocity: (velocity - omega * impulse * seconds) * decay,
  }
}

export function createEmotionMotion({ initial, render, requestFrame, cancelFrame, reducedMotion }) {
  let position = moodPosition(initial.x, initial.y)
  let target = { ...position }
  let velocity = { x: 0, y: 0 }
  let frame = null
  let previousTime = null
  let pointerTime = null
  let disposed = false

  function stop() {
    if (frame !== null) cancelFrame(frame)
    frame = null
    previousTime = null
  }
  function publish(next) {
    position = moodPosition(next.x, next.y)
    render({ ...position })
  }
  function tick(time) {
    frame = null
    if (disposed) return
    const dt = previousTime === null ? 1 / 60 : Math.max(0, (time - previousTime) / 1000)
    previousTime = time
    const next = {}
    for (const axis of ['x', 'y']) {
      const step = emotionSpring(position[axis], velocity[axis], target[axis], dt)
      next[axis] = bounded(step.value)
      velocity[axis] = next[axis] === step.value ? step.velocity : 0
    }
    const settled = ['x', 'y'].every(
      (axis) => Math.abs(next[axis] - target[axis]) < 0.015 && Math.abs(velocity[axis]) < 0.15,
    )
    publish(settled ? target : next)
    if (settled) {
      velocity = { x: 0, y: 0 }
      previousTime = null
    } else frame = requestFrame(tick)
  }
  function to(x, y, immediate = false) {
    if (disposed) return
    target = moodPosition(x, y)
    if (immediate || reducedMotion()) {
      stop()
      velocity = { x: 0, y: 0 }
      publish(target)
    } else if (frame === null) frame = requestFrame(tick)
    // Retarget in place: never reset the live position/velocity or queue animations.
  }
  return {
    to,
    follow(x, y, time) {
      if (disposed) return
      stop()
      const next = moodPosition(x, y)
      const dt = pointerTime === null ? 0 : (time - pointerTime) / 1000
      for (const axis of ['x', 'y'])
        velocity[axis] =
          dt > 0 && dt < 0.08
            ? Math.max(-400, Math.min(400, (next[axis] - position[axis]) / dt))
            : 0
      pointerTime = time
      publish(next)
    },
    release(x, y, time, cancelled = false) {
      if (cancelled || pointerTime === null || time - pointerTime > 80) velocity = { x: 0, y: 0 }
      pointerTime = null
      // A precise expression picker snaps locally; it must not fling past the chosen mood.
      to(x, y)
    },
    dispose() {
      disposed = true
      stop()
    },
  }
}
