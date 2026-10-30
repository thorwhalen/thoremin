/**
 * The road's perspective, shared by the Pitch Maze's road (`field_stage`) and the note highway
 * (`note_view`): a point `d` ahead of the near line shrinks toward the horizon as
 * camera / (camera + d), full size on the near line and a little larger just behind it. One
 * camera, so the road and the highway look alike.
 */
export interface Pt {
  x: number;
  y: number;
}

/** The camera this far behind the near line (in the units of `d`). */
export const ROAD_CAMERA = 0.8;

/** How far behind the near line the road is still drawn, as a share of the camera distance. */
const BEHIND = 0.6;

/** The scale at depth `d`: 1 on the near line, toward 0 at the horizon. */
export const roadScale = (d: number, camera = ROAD_CAMERA): number => camera / (camera + Math.max(d, -BEHIND * camera));

/**
 * A projection onto a road: `u` across (0 at the centre, the near line `width` wide from -0.5 to
 * 0.5), `d` ahead of the near line; `near` is the near line's centre and `horizonY` the horizon.
 */
export function roadProjection(near: Pt, horizonY: number, width: number, camera = ROAD_CAMERA) {
  return (u: number, d: number): Pt & { k: number } => {
    const k = roadScale(d, camera);
    return { x: near.x + u * width * k, y: horizonY + (near.y - horizonY) * k, k };
  };
}
