import { emotionSpring } from './emotionMotion.js'

export const shortestOrbitDelta = (from, to) => ((((to - from + 540) % 360) + 360) % 360) - 180

export function createAngleMotion({ initial, render, requestFrame, cancelFrame, reducedMotion }) {
  let position = { ...initial },
    target = { ...initial }
  let velocity = { horizontal: 0, vertical: 0, distance: 0 }
  let frame = null,
    previous = null,
    disposed = false
  const axes = ['horizontal', 'vertical', 'distance']
  function stop() {
    if (frame !== null) cancelFrame(frame)
    frame = null
    previous = null
  }
  function publish(next) {
    position = next
    render({ ...position })
  }
  function tick(time) {
    frame = null
    if (disposed) return
    const dt = previous === null ? 1 / 60 : Math.max(0, (time - previous) / 1000)
    previous = time
    const next = {}
    for (const axis of axes) {
      const step = emotionSpring(position[axis], velocity[axis], target[axis], dt, 0.3)
      next[axis] = step.value
      velocity[axis] = step.velocity
    }
    const settled = axes.every(
      (a) => Math.abs(next[a] - target[a]) < 0.01 && Math.abs(velocity[a]) < 0.1,
    )
    publish(settled ? { ...target } : next)
    if (!settled) frame = requestFrame(tick)
    else {
      previous = null
      velocity = { horizontal: 0, vertical: 0, distance: 0 }
    }
  }
  return {
    to(next, immediate = false) {
      if (disposed) return
      target = {
        horizontal: position.horizontal + shortestOrbitDelta(position.horizontal, next.horizontal),
        vertical: next.vertical,
        distance: next.distance,
      }
      if (immediate || reducedMotion()) {
        stop()
        velocity = { horizontal: 0, vertical: 0, distance: 0 }
        publish({ ...target })
      } else if (frame === null) frame = requestFrame(tick)
    },
    current: () => ({ ...position }),
    dispose() {
      disposed = true
      stop()
    },
  }
}

export function angleScene(camera) {
  const rad = Math.PI / 180,
    radius = 76,
    center = 120
  const pitch = camera.vertical * rad * 0.7,
    yaw = camera.horizontal * rad * 0.35
  function project(x, y, z) {
    const px = x * Math.cos(yaw) + z * Math.sin(yaw)
    const pz = z * Math.cos(yaw) - x * Math.sin(yaw)
    return [center + px, center - (y * Math.cos(pitch) - pz * Math.sin(pitch))]
  }
  function path(points) {
    return points.map((p, i) => `${i ? 'L' : 'M'}${p.map((v) => v.toFixed(2)).join(',')}`).join(' ')
  }
  const lines = []
  for (let longitude = 0; longitude < 180; longitude += 15) {
    const a = longitude * rad
    lines.push(
      path(
        Array.from({ length: 73 }, (_, i) => {
          const t = i * 5 * rad
          return project(
            radius * Math.cos(a) * Math.cos(t),
            radius * Math.sin(t),
            radius * Math.sin(a) * Math.cos(t),
          )
        }),
      ),
    )
  }
  for (let latitude = -75; latitude <= 75; latitude += 15) {
    const a = latitude * rad
    lines.push(
      path(
        Array.from({ length: 73 }, (_, i) => {
          const t = i * 5 * rad
          return project(
            radius * Math.cos(a) * Math.sin(t),
            radius * Math.sin(a),
            radius * Math.cos(a) * Math.cos(t),
          )
        }),
      ),
    )
  }
  const h = camera.horizontal * rad,
    v = camera.vertical * rad
  return {
    lines,
    camera: {
      x: center + radius * Math.sin(h) * Math.cos(v),
      y: center - radius * Math.sin(v),
      angle: -camera.horizontal * 0.12,
    },
    photoSize: 48 + camera.distance * 3.5,
  }
}
