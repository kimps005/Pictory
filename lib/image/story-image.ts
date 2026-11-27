// Only use pixel analysis to find margins. Never remove or recolor drawing pixels.
export function drawingBounds(data: Uint8ClampedArray, width: number, height: number) {
  let left = width; let top = height; let right = -1; let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (data[offset + 3] < 24) continue;
      // Near-white paper is ignored for cropping only; white body parts stay intact.
      if (Math.min(data[offset], data[offset + 1], data[offset + 2]) >= 245) continue;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) return { left: 0, top: 0, width, height };
  const padding = Math.max(12, Math.round(Math.max(right - left + 1, bottom - top + 1) * 0.14));
  left = Math.max(0, left - padding); top = Math.max(0, top - padding);
  right = Math.min(width - 1, right + padding); bottom = Math.min(height - 1, bottom + padding);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

// Prompt for a page drawn around the child's drawing (input image 0).
// Only positive wording: listing "girl, boy, child" as things to avoid makes small
// image models draw exactly those instead of the drawn character.
// supportingCast is the story model's fixed list of NON-protagonist characters.
export function drawingScenePrompt(visualPrompt: string, supportingCast: string, hasPreviousPage = false, retry = false) {
  return [
    retry ? "IMPORTANT: the previous attempt forgot the drawn character. The drawn character from input image 0 must be the large, central hero of this picture." : "",
    "One storybook page. The main character is the exact character drawn in input image 0 (a child's drawing): same silhouette, body shape, face, colours, marks and line style. It appears once, large and in the foreground, as the hero of the scene.",
    "Every mention of \"the main character\" means this drawn character.",
    "Act out the moment: change the drawn character's pose, body and facial expression to match exactly what it is doing and feeling right now, and let it physically interact with the props. The situation must be obvious at a glance.",
    `This moment: ${visualPrompt}`,
    supportingCast ? `Supporting characters keep exactly this fixed design on every page (same gender, age, hair, colours and clothes); draw one only if this moment includes them, smaller than the main character: ${supportingCast}` : "",
    hasPreviousPage ? "Input image 1 is the previous page of the same book: match its art style, palette and the look of any supporting characters that appear in it. The main character still comes from input image 0." : "",
    "Soft watercolor storybook background, one scene, no text or speech bubbles.",
  ].filter(Boolean).join("\n");
}

// Prompt for books without a drawing: the first generated page becomes the reference.
export function textScenePrompt(visualPrompt: string, narration: string, characterBible: string, supportingCast: string, hasReference: boolean) {
  return [
    "One soft watercolor storybook illustration, no text or speech bubbles.",
    `Fixed main character appearance: ${characterBible}`,
    supportingCast ? `Supporting characters keep exactly this fixed design on every page (same gender, age, hair, colours and clothes); draw one only if this moment includes them: ${supportingCast}` : "",
    `Depict exactly this moment: ${visualPrompt}`,
    `Narration: ${narration}`,
    hasReference ? "Input image 0 is an earlier page of the same book: keep the same main character design, the same supporting character designs and the same art style." : "",
  ].filter(Boolean).join("\n");
}

export function sceneReferences<T>(drawing: T | null, previous: T | null, fallback: T | null): T[] {
  // A generated page is never the identity reference when an original drawing exists
  // (it may only be passed separately as a style/cast reference after verification).
  return drawing ? [drawing] : previous ? [previous] : fallback ? [fallback] : [];
}

export function backgroundScenePrompt(visualPrompt: string, narration: string) {
  return [
    "Paint a soft watercolor storybook BACKGROUND PLATE. The protagonist will be composited separately by the app.",
    "Render only the location, scenery and scene props. Leave a clear, quiet foreground landing area in the center-left (15%-55% of image width, 33%-85% of image height). The protagonist will stand there.",
    "Do not render the protagonist, a substitute main character, a silhouette, or a picture of the protagonist. Supporting characters, if needed, are small and placed on the RIGHT side. Keep foreground objects from covering the reserved landing area. No letters or speech bubbles.",
    `Setting and prop context: ${visualPrompt}`,
    `Story context for the background only: ${narration}`,
    "Final reminder: environment plate only; center-left foreground stays free for the separately composited protagonist.",
  ].join("\n");
}
