/**
 * Coordinate transforms between "visual" space and PDF user space.
 *
 * Visual space: origin at the TOP-LEFT of the page as it appears on screen
 * (i.e. after /Rotate has been applied), y growing downward, units = PDF points.
 * User space: pdf-lib's space — origin bottom-left of the unrotated MediaBox,
 * y growing upward.
 *
 * `w`/`h` below are always the UNROTATED page width/height.
 */

export function normRot(r) {
  return ((Math.round((r || 0) / 90) * 90) % 360 + 360) % 360;
}

/** Visual page size (what the user sees), given unrotated size + rotation. */
export function visualSize(w, h, rot) {
  return normRot(rot) % 180 ? { w: h, h: w } : { w, h };
}

/** Convert a visual point to user space. */
export function toUser(vx, vy, w, h, rot) {
  switch (normRot(rot)) {
    case 90: return { x: vy, y: vx };
    case 180: return { x: w - vx, y: vy };
    case 270: return { x: w - vy, y: h - vx };
    default: return { x: vx, y: h - vy };
  }
}

/**
 * Place a visual box (top-left vx,vy plus size vw,vh) as a pdf-lib draw call.
 * Returns the anchor, the width/height to pass, and the rotation in degrees
 * (counter-clockwise, as pdf-lib expects) so the result lands where the user
 * drew it regardless of the page's /Rotate value.
 */
export function placeBox(vx, vy, vw, vh, w, h, rot) {
  const r = normRot(rot);
  if (r === 90) return { x: vy + vh, y: vx, width: vw, height: vh, rotate: 90 };
  if (r === 180) return { x: w - vx, y: vy + vh, width: vw, height: vh, rotate: 180 };
  if (r === 270) return { x: w - vy - vh, y: h - vx, width: vw, height: vh, rotate: 270 };
  return { x: vx, y: h - vy - vh, width: vw, height: vh, rotate: 0 };
}

/** Place a single visual point (e.g. a text baseline start). */
export function placePoint(vx, vy, w, h, rot) {
  const p = toUser(vx, vy, w, h, rot);
  return { x: p.x, y: p.y, rotate: normRot(rot) };
}

/** Normalise a drag rectangle to {x,y,w,h} with positive extents. */
export function rectFrom(x0, y0, x1, y1) {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}
