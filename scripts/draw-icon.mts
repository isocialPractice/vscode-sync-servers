// Draws the extension's two icons from one drawing on a 24 x 24 grid: two
// stacked servers with a Get and a Put arrow between them.
//
//   media/sync-servers.svg  the monochrome activity bar icon, 24 x 24
//   media/icon.png          the Marketplace icon, 128 x 128, the same mark in
//                           white on a blue rounded square
//
// Run it through `npm run icon` after changing the drawing, and commit both.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

type Point = readonly [number, number];

const STROKE = 1.5;
const servers = [
  { x: 3.75, y: 2.75, width: 16.5, height: 4.5, radius: 1.5, light: [7, 5] as Point, slot: [[11, 5], [17, 5]] as const },
  { x: 3.75, y: 16.75, width: 16.5, height: 4.5, radius: 1.5, light: [7, 19] as Point, slot: [[11, 19], [17, 19]] as const },
];
const LIGHT_RADIUS = 1;
// Get (down) on the left, Put (up) on the right.
const arrows: readonly (readonly Point[])[] = [
  [[9, 10], [9, 14]],
  [[7, 12], [9, 14], [11, 12]],
  [[15, 14], [15, 10]],
  [[13, 12], [15, 10], [17, 12]],
];
const lines: readonly (readonly Point[])[] = [...servers.map((server) => server.slot), ...arrows];

function svg(): string {
  const path = (points: readonly Point[]): string =>
    `M${points.map(([x, y]) => `${String(x)} ${String(y)}`).join('L')}`;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"',
    `     stroke-width="${String(STROKE)}" stroke-linecap="round" stroke-linejoin="round">`,
    ...servers.map(
      (s) =>
        `  <rect x="${String(s.x)}" y="${String(s.y)}" width="${String(s.width)}" height="${String(s.height)}" rx="${String(s.radius)}"/>`,
    ),
    ...servers.map(
      (s) =>
        `  <circle cx="${String(s.light[0])}" cy="${String(s.light[1])}" r="${String(LIGHT_RADIUS)}" fill="currentColor" stroke="none"/>`,
    ),
    `  <path d="${lines.map(path).join('')}"/>`,
    '</svg>',
    '',
  ].join('\n');
}

function segmentDistance([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Signed distance to a rounded rectangle: negative inside, positive outside.
function roundRectDistance([px, py]: Point, x: number, y: number, width: number, height: number, radius: number): number {
  const qx = Math.abs(px - (x + width / 2)) - (width / 2 - radius);
  const qy = Math.abs(py - (y + height / 2)) - (height / 2 - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

function inMark(p: Point): boolean {
  const half = STROKE / 2;
  return (
    servers.some(
      (s) =>
        Math.abs(roundRectDistance(p, s.x, s.y, s.width, s.height, s.radius)) <= half ||
        Math.hypot(p[0] - s.light[0], p[1] - s.light[1]) <= LIGHT_RADIUS,
    ) ||
    lines.some((points) => points.slice(1).some((point, index) => segmentDistance(p, points[index] ?? point, point) <= half))
  );
}

const SIZE = 128;
const TILE_RADIUS = 24;
const MARK_SIZE = 88;
const TOP: readonly [number, number, number] = [0x2f, 0x6f, 0xd8];
const BOTTOM: readonly [number, number, number] = [0x1d, 0x4f, 0xa8];
const SAMPLES = 4;

function png(): Buffer {
  const scale = MARK_SIZE / 24;
  const offset = (SIZE - MARK_SIZE) / 2;
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    const row = y * (SIZE * 4 + 1);
    for (let x = 0; x < SIZE; x += 1) {
      let covered = 0;
      const sum = [0, 0, 0];
      for (let i = 0; i < SAMPLES; i += 1) {
        for (let j = 0; j < SAMPLES; j += 1) {
          const sx = x + (i + 0.5) / SAMPLES;
          const sy = y + (j + 0.5) / SAMPLES;
          if (roundRectDistance([sx, sy], 0, 0, SIZE, SIZE, TILE_RADIUS) > 0) {
            continue;
          }
          covered += 1;
          const t = sy / SIZE;
          const colour = inMark([(sx - offset) / scale, (sy - offset) / scale])
            ? [255, 255, 255]
            : TOP.map((top, k) => top + ((BOTTOM[k] ?? top) - top) * t);
          colour.forEach((value, k) => {
            sum[k] = (sum[k] ?? 0) + value;
          });
        }
      }
      const at = row + 1 + x * 4;
      if (covered > 0) {
        sum.forEach((value, k) => {
          raw[at + k] = Math.round(value / covered);
        });
      }
      raw[at + 3] = Math.round((covered / (SAMPLES * SAMPLES)) * 255);
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const media = path.resolve(import.meta.dirname, '..', 'media');
mkdirSync(media, { recursive: true });
writeFileSync(path.join(media, 'sync-servers.svg'), svg());
writeFileSync(path.join(media, 'icon.png'), png());
console.log('Wrote media/sync-servers.svg and media/icon.png.');
