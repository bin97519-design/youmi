export function canvasGestures(tool, spaceHeld) {
  const hand = tool === 'hand' || spaceHeld
  return { hand, panOnDrag: hand ? [0, 1] : [1], selectionOnDrag: !hand, nodesDraggable: !hand }
}
