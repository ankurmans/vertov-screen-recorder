/** Page coordinates only match a direct capture of that exact tab's top frame. */
export function capturedEvent(event, sender, recording) {
  const { x, y, viewportWidth, viewportHeight, coordinateSpace, ...context } = event
  const coordinates = (event.type === "click" || event.type === "pointer") && recording.zoomCaptureTab != null && sender.tab?.id === recording.zoomCaptureTab && sender.frameId === 0
    ? { x, y, viewportWidth, viewportHeight, coordinateSpace: "recorded-tab" } : {}
  return { ...context, ...coordinates, url: context.url ?? sender.tab?.url }
}
