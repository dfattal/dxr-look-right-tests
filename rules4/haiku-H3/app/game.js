// Flight model and rings. Plain numbers, no three.js: world.js draws whatever this says.
// Units are metres and seconds. Forward is -z at yaw 0, as in three.js, and positive yaw turns left.

const SPEED = 38;               // m/s, constant: the plane never stops
const TURN_RATE = 0.9;          // rad/s of yaw at full left or right
const PITCH_RATE = 0.8;         // rad/s of climb or dive at full up or down
const MAX_PITCH = 0.55;         // rad (about 31 degrees)
const MIN_CLEARANCE = 8;        // m above the ground; the plane is held above it
const RING_COUNT = 9;
export const RING_RADIUS = 10;  // m, centre-line radius of a hoop
const RING_BEHIND = 30;         // m: a hoop this far behind the plane is recycled
const RING_RANGE = 420;         // m: a hoop this far ahead is recycled too

// Small seeded PRNG, so every visit gets the same course.
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class FlightGame {
  /**
   * @param {(x: number, z: number) => number} groundHeight  terrain height in metres
   * @param {(score: number) => void} onRing  called when the plane flies through a hoop
   */
  constructor(groundHeight, onRing) {
    this.groundHeight = groundHeight;
    this.onRing = onRing;
    this.keys = { left: false, right: false, up: false, down: false };
    this.rnd = mulberry32(20261029);
    this.plane = { x: 0, y: groundHeight(0, 0) + 40, z: 0, yaw: 0, pitch: 0, roll: 0 };
    this.score = 0;
    this.rings = [];
    for (let i = 0; i < RING_COUNT; i++) {
      const ring = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 1, sPrev: 0, state: 'open' };
      this.placeRing(ring, 120 + i * 85);
      this.rings.push(ring);
    }
  }

  /** Unit vector the plane is flying along. */
  forward() {
    const { yaw, pitch } = this.plane;
    return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
  }

  /** Unit vector out of the plane's right wing, on the horizontal. */
  right() {
    return { x: Math.cos(this.plane.yaw), y: 0, z: -Math.sin(this.plane.yaw) };
  }

  update(dt) {
    const p = this.plane;
    const k = this.keys;
    const turn = (k.left ? 1 : 0) - (k.right ? 1 : 0);
    const climb = (k.up ? 1 : 0) - (k.down ? 1 : 0);

    p.yaw += turn * TURN_RATE * dt;
    // Bank into the turn: positive roll drops the left wing, which is a left bank.
    p.roll += (turn * 0.7 - p.roll) * (1 - Math.exp(-4 * dt));
    if (climb) p.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, p.pitch + climb * PITCH_RATE * dt));
    else p.pitch *= Math.exp(-0.6 * dt);

    const prevX = p.x, prevY = p.y, prevZ = p.z;
    const f = this.forward();
    p.x += f.x * SPEED * dt;
    p.y += f.y * SPEED * dt;
    p.z += f.z * SPEED * dt;

    const floor = this.groundHeight(p.x, p.z) + MIN_CLEARANCE;
    if (p.y < floor) {
      p.y = floor;
      p.pitch = Math.max(p.pitch, 0.2);
    }

    this.checkRings(prevX, prevY, prevZ);
    this.recycleRings();
  }

  /** A hoop is passed when the plane crosses its plane inside the radius. */
  checkRings(prevX, prevY, prevZ) {
    const p = this.plane;
    for (const ring of this.rings) {
      const cx = p.x - ring.x, cy = p.y - ring.y, cz = p.z - ring.z;
      const s = cx * ring.nx + cy * ring.ny + cz * ring.nz;
      const crossed = (ring.sPrev > 0) !== (s > 0);
      if (crossed && ring.state === 'open') {
        const t = ring.sPrev / (ring.sPrev - s);
        // Where the flight path crossed the hoop's plane, relative to the hoop centre.
        const hx = prevX + (p.x - prevX) * t - ring.x;
        const hy = prevY + (p.y - prevY) * t - ring.y;
        const hz = prevZ + (p.z - prevZ) * t - ring.z;
        const along = hx * ring.nx + hy * ring.ny + hz * ring.nz;
        const rx = hx - along * ring.nx, ry = hy - along * ring.ny, rz = hz - along * ring.nz;
        if (Math.hypot(rx, ry, rz) <= RING_RADIUS) {
          ring.state = 'hit';
          this.score += 1;
          if (this.onRing) this.onRing(this.score);
        } else {
          ring.state = 'missed';
        }
      }
      ring.sPrev = s;
    }
  }

  /** Hoops that are behind the plane, or far ahead, are placed again further on. */
  recycleRings() {
    const p = this.plane;
    const f = this.forward();
    for (const ring of this.rings) {
      const dx = ring.x - p.x, dy = ring.y - p.y, dz = ring.z - p.z;
      const ahead = dx * f.x + dy * f.y + dz * f.z;
      if (ahead < -RING_BEHIND || Math.hypot(dx, dy, dz) > RING_RANGE) this.placeRing(ring, 150 + this.rnd() * 180);
    }
  }

  /** Put a hoop `dist` metres ahead of the plane, offset and tilted a little so the course varies. */
  placeRing(ring, dist) {
    const p = this.plane;
    const f = this.forward();
    const r = this.right();
    const lateral = (this.rnd() - 0.5) * 70;
    const vertical = (this.rnd() - 0.5) * 36;
    ring.x = p.x + f.x * dist + r.x * lateral;
    ring.z = p.z + f.z * dist + r.z * lateral;
    ring.y = Math.max(this.groundHeight(ring.x, ring.z) + 12, p.y + vertical);
    // Normal = flight direction, tilted slightly sideways and up. Hoops are never edge-on.
    const tx = (this.rnd() - 0.5) * 0.5;
    const ty = (this.rnd() - 0.5) * 0.4;
    const nx = f.x + r.x * tx;
    const ny = f.y + ty;
    const nz = f.z + r.z * tx;
    const len = Math.hypot(nx, ny, nz);
    ring.nx = nx / len;
    ring.ny = ny / len;
    ring.nz = nz / len;
    ring.sPrev = (p.x - ring.x) * ring.nx + (p.y - ring.y) * ring.ny + (p.z - ring.z) * ring.nz;
    ring.state = 'open';
  }
}
