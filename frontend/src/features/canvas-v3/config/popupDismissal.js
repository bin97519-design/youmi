export function isOutsidePopup(event, popup, trigger) {
  const path = event.composedPath?.() || []
  return ![popup, trigger].some(
    (element) => element && (path.includes(element) || element.contains(event.target)),
  )
}
