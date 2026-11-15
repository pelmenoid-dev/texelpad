import { Studio } from '../src/studio';
import { ProjectedStroke } from '../src/projection';
import { blankMap } from '../src/maps';
import { ReferenceStroke } from './fixtures/reference-stroke';
import { reportResults } from './browser-report';
import type { BrowserResult } from './browser-report';

const tests: BrowserResult[] = [];
const studio = new Studio(document.querySelector<HTMLDivElement>('#studio')!, () => {}, () => {}, () => {});

async function run() {
  const bytes = await (await fetch('./fixtures/cube.fbx')).arrayBuffer();
  await studio.loadModel(new File([bytes], 'cube.fbx'));
  const width = studio.host.clientWidth, height = studio.host.clientHeight;
  const view = studio.camera.clone();
  view.updateMatrixWorld();
  for (const [resolution, size] of [[512, 24], [512, 40], [512, 128], [1024, 128]]) {
    const brush = { ...studio.brush, tool: 'brush' as const, size, opacity: 0.4, hardness: 0.35 };
    const measure = (Stroke: typeof ProjectedStroke | typeof ReferenceStroke) => {
      const pixels = blankMap('diffuse', resolution, resolution);
      const start = performance.now();
      const stroke = new Stroke(pixels, studio.meshes, view, width, height);
      const setup = performance.now() - start;
      const samples: number[] = [];
      for (let i = 0; i < 24; i++) {
        const time = performance.now();
        stroke.dab(width * 0.5 + Math.sin(i * 0.25) * 90, height * 0.5 + Math.cos(i * 0.2) * 50, brush, false);
        samples.push(performance.now() - time);
      }
      const sorted = [...samples].sort((a, b) => a - b);
      return {
        pixels,
        setup,
        mean: samples.reduce((sum, ms) => sum + ms, 0) / samples.length,
        p95: sorted[Math.floor(sorted.length * 0.95)],
      };
    };
    // Warm both paths before recording; wall-clock timings are informational.
    // CI asserts exact paint output here and triangle-check counts in Node tests.
    for (const Stroke of [ReferenceStroke, ProjectedStroke]) {
      const warm = new Stroke(blankMap('diffuse', 64, 64), studio.meshes, view, width, height);
      warm.dab(width / 2, height / 2, brush, false);
    }
    const before = measure(ReferenceStroke), after = measure(ProjectedStroke);
    const firstDifference = after.pixels.data.findIndex((value, i) => value !== before.pixels.data[i]);
    const stats = ({ setup, mean, p95 }: typeof before) => ({
      setupMs: +setup.toFixed(2), meanDabMs: +mean.toFixed(2), p95DabMs: +p95.toFixed(2),
    });
    tests.push({
      name: `FBX ${studio.triangles} triangles, ${resolution}px map, ${size}px brush: exact original pixels`,
      pass: firstDifference === -1,
      detail: JSON.stringify({ before: stats(before), after: stats(after), speedup: +(before.mean / after.mean).toFixed(1), firstDifference }),
    });
  }
}

void run().catch(error => tests.push({ name: 'Paint performance suite', pass: false, detail: String(error) })).finally(() => {
  studio.dispose();
  document.querySelector('#results')!.textContent = JSON.stringify(tests, null, 2);
  reportResults({ suite: 'paint-performance', tests });
});
