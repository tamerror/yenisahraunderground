import { describe, expect, it } from 'vitest';
import { chooseLink, projectToView } from '../src/render/streetview';

describe('Street View helpers', () => {
  const links = [
    { heading: 10, pano: 'n' },
    { heading: 95, pano: 'e' },
    { heading: 185, pano: 's' },
    { heading: null, pano: 'x' },
  ];
  it('chooses the link closest to the heading', () => {
    expect(chooseLink(links, 0)?.pano).toBe('n');
    expect(chooseLink(links, 350)?.pano).toBe('n');
    expect(chooseLink(links, 80)?.pano).toBe('e');
    expect(chooseLink(links, 180 + 0)?.pano).toBe('s');
  });
  it('refuses links that point too far away', () => {
    expect(chooseLink([{ heading: 90, pano: 'e' }], 0, 70)).toBeNull();
  });

  const cam = { heading: 0, pitch: 0, zoom: 1, w: 1000, h: 600 };
  it('projects a point straight ahead to the centre column', () => {
    const p = projectToView(0, 20, 0, cam)!;
    expect(p.x).toBeCloseTo(500, 5);
    expect(p.y).toBeCloseTo(300, 5);
    expect(p.d).toBeCloseTo(20, 5);
  });
  it('projects things to the right to the right, lower things lower', () => {
    const p = projectToView(10, 20, -2, cam)!;
    expect(p.x).toBeGreaterThan(500);
    expect(p.y).toBeGreaterThan(300);
  });
  it('a point at 45° right with 90° fov lands on the right edge', () => {
    const p = projectToView(10, 10, 0, cam)!;
    expect(p.x).toBeCloseTo(1000, 3);
  });
  it('hides points behind the camera', () => {
    expect(projectToView(0, -10, 0, cam)).toBeNull();
  });
  it('respects the heading', () => {
    const p = projectToView(20, 0, 0, { ...cam, heading: 90 })!;
    expect(p.x).toBeCloseTo(500, 5);
  });
});

describe('Street View lookup errors', () => {
  it('reads the status code from Maps errors', async () => {
    const { mapsErrorCode } = await import('../src/render/streetview');
    expect(mapsErrorCode({ code: 'ZERO_RESULTS' })).toBe('ZERO_RESULTS');
    expect(mapsErrorCode(new Error('StreetViewService.getPanorama: REQUEST_DENIED'))).toBe('REQUEST_DENIED');
    expect(mapsErrorCode(new Error('boom'))).toBe('UNKNOWN_ERROR');
  });
  it('explains the likely cause in Turkish', async () => {
    const { explainLookupFailure } = await import('../src/render/streetview');
    expect(explainLookupFailure(['REQUEST_DENIED'])).toMatch(/faturalandırma/);
    expect(explainLookupFailure(['ZERO_RESULTS', 'ZERO_RESULTS'])).toMatch(/ZERO_RESULTS/);
    expect(explainLookupFailure(['UNKNOWN_ERROR', 'TIMEOUT'])).toMatch(/UNKNOWN_ERROR, TIMEOUT/);
  });
});
