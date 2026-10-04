// Who draws which ground: the near field or the skyline.
//
// This is the only file that knows about both layers. Neither layer refers to
// the other; the rules are all here:
//
//   1. The near field owns its block (whole zoom-13 tiles around the camera).
//      The skyline never asks for, or draws, anything inside it.
//   2. Outside the block, a near tile is still drawn until the skyline has
//      fully covered that ground. So when the block moves on, the old near
//      tiles stay until their replacement has arrived: no flash, no gap.
//   3. The skyline does not fetch until the near field has nothing left to
//      fetch. What is close matters more.

import { SKY_RADIUS } from './config.js';
import { insideBlock } from './skyline.js';

export class Handover {
  constructor(near, sky) {
    this.near = near;
    this.sky = sky;
    // Rule 2
    near.skip = (t) => {
      const b = near.block;
      const outside = !b || t.rawX < b.x0 || t.rawX > b.x1 || t.y < b.y0 || t.y > b.y1;
      return outside && sky.owns(t.rawX >> 1, t.y >> 1);
    };
    // Rule 1
    sky.skip = (t) => insideBlock(near.block, t.rawX, t.y, t.z);
  }

  update(view) {
    this.near.update(view);
    // Rule 3
    this.sky.update(view, SKY_RADIUS, this.near.block, view.nearFetchOk && !this.near.busy);
  }

  draw(pass, roadsOn, bldOn) {
    this.near.draw(pass, roadsOn, bldOn);
    this.sky.draw(pass, bldOn);
  }
}
