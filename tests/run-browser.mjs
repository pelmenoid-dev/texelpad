import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { createServer, preview } from 'vite';
import { unzipSync } from 'three/addons/libs/fflate.module.js';
const root = path.resolve(import.meta.dirname, '..');
const reports = [];
let browser, server, production;
function monitor(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text() + " " + message.location().url);
  });
  page.on('request', request => {
    if (request.url().includes('/__qa/')) errors.push('Obsolete QA endpoint requested');
  });
  return errors;
}
async function suite(name, baseURL) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = monitor(page);
  try {
    await page.goto(`${baseURL}tests/${name}.html`);
    await page.waitForFunction(() => window.__testReport, undefined, {
      timeout: 180_000
    });
    const report = await page.evaluate(() => window.__testReport);
    reports.push(report);
    assert.equal(report.error, undefined, report.error);
    assert.ok(report.tests.length, `${name}: no tests ran`);
    assert.deepEqual(report.tests.filter(test => !test.pass), [], JSON.stringify(report, null, 2));
    assert.deepEqual(errors, [], `${name}: browser errors`);
    console.log(`${name}: ${report.tests.length} passed`);
    if (name === 'paint-performance') for (const test of report.tests) console.log(`  ${test.name}: ${test.detail}`);
  } finally {
    await context.close();
  }
}
async function productionSmoke(baseURL) {
  const context = await browser.newContext({
    viewport: {
      width: 1440,
      height: 900
    },
    reducedMotion: 'reduce'
  });
  const page = await context.newPage();
  const errors = monitor(page);
  try {
    await page.goto(baseURL);
    await page.getByRole('button', {
      name: 'Load model',
      exact: true
    }).waitFor();
    assert.equal(await page.evaluate(() => typeof window.__workshop), 'undefined', 'Production exposes the dev studio');
    assert.equal(await page.locator('.swatch').count(), 11);
    // Typing bypasses a native number input's step constraint. Every numeric
    // control must still produce settings accepted by the project format.
    await page.getByRole('spinbutton', { name: 'Color levels', exact: true }).fill('12.5');
    assert.equal(await page.getByRole('spinbutton', { name: 'Color levels', exact: true }).inputValue(), '13');
    await page.getByRole('spinbutton', { name: 'Specular', exact: true }).fill('0.73');
    assert.equal(await page.getByRole('spinbutton', { name: 'Specular', exact: true }).inputValue(), '0.75');
    await page.getByLabel('Model file', {
      exact: true
    }).setInputFiles(path.join(root, 'tests/fixtures/cube.fbx'));
    await page.getByRole('button', {
      name: 'Model',
      exact: true
    }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.busy-overlay'));
    await page.getByRole('button', {
      name: 'Brush · B',
      exact: true
    }).click();
    await page.getByRole('spinbutton', {
      name: 'Hardness',
      exact: true
    }).fill('40');
    await page.getByRole('switch', {
      name: 'Pixelisation',
      exact: true
    }).click();
    await page.waitForFunction(() => document.querySelector('.texture-preview canvas').width === 512);
    await page.getByRole('switch', {
      name: 'Pixelisation',
      exact: true
    }).click();
    await page.waitForFunction(() => document.querySelector('.texture-preview canvas').width === 128);
    await page.getByRole('tab', {
      name: 'Specular',
      exact: true
    }).click();
    assert.equal(await page.locator('.swatch').count(), 5);
    await page.getByRole('tab', {
      name: 'Diffuse',
      exact: true
    }).click();
    await page.locator('.swatch').first().focus();
    await page.keyboard.press('F2');
    await page.getByRole('dialog', {
      name: 'Color',
      exact: true
    }).waitFor();
    const plane = page.getByRole('slider', { name: 'Saturation and brightness', exact: true });
    const planeBox = await plane.boundingBox();
    await page.mouse.move(planeBox.x + planeBox.width * .25, planeBox.y + planeBox.height * .25);
    await page.mouse.down();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal(await plane.evaluate(element => element.hasPointerCapture(1)), false, 'Color picker held capture after window blur');
    const pausedColor = await page.getByRole('textbox', { name: 'Hex color' }).inputValue();
    await page.mouse.move(planeBox.x + planeBox.width * .75, planeBox.y + planeBox.height * .75);
    assert.equal(await page.getByRole('textbox', { name: 'Hex color' }).inputValue(), pausedColor, 'Blurred color drag continued changing the brush');
    await page.mouse.up();
    await page.mouse.click(planeBox.x + planeBox.width * .75, planeBox.y + planeBox.height * .75);
    assert.notEqual(await page.getByRole('textbox', { name: 'Hex color' }).inputValue(), pausedColor, 'Color picker did not accept the next gesture');
    await page.keyboard.press('Escape');
    // A brush frame must reach the actual React-mounted preview before release,
    // even though the rest of the editor no longer rerenders for each dab.
    await page.getByRole('spinbutton', { name: 'Size', exact: true }).fill('40');
    await page.locator('.swatch').first().click();
    const previewBefore = await page.locator('.texture-preview canvas').evaluate(canvas => canvas.toDataURL());
    const viewport = await page.locator('canvas[aria-label^="3D model"]').boundingBox();
    const paintX = viewport.x + viewport.width / 2, paintY = viewport.y + viewport.height / 2;
    await page.mouse.move(paintX - 30, paintY);
    await page.mouse.down();
    await page.mouse.move(paintX + 30, paintY, { steps: 10 });
    await page.waitForFunction(before => document.querySelector('.texture-preview canvas').toDataURL() !== before, previewBefore);
    await page.mouse.up();
    const previewAfter = await page.locator('.texture-preview canvas').evaluate(canvas => canvas.toDataURL());
    await page.keyboard.press('Control+z');
    await page.waitForFunction(before => document.querySelector('.texture-preview canvas').toDataURL() === before, previewBefore);
    await page.keyboard.press('Control+y');
    await page.waitForFunction(after => document.querySelector('.texture-preview canvas').toDataURL() === after, previewAfter);
    // Release immediately after movement, while the live preview's GPU-to-CPU
    // transfer may still be pending. The last segment must survive that race.
    await page.mouse.move(paintX, paintY + 15);
    await page.mouse.down();
    await page.mouse.move(paintX + 25, paintY + 20, {steps: 4});
    await page.mouse.up();
    await page.waitForFunction(before => document.querySelector('.texture-preview canvas').toDataURL() !== before, previewAfter);
    await page.keyboard.press('Control+z');
    await page.waitForFunction(before => document.querySelector('.texture-preview canvas').toDataURL() === before, previewAfter);
    const png = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 32;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#123456';
      ctx.fillRect(0, 0, 64, 32);
      const blob = await new Promise(resolve => canvas.toBlob(resolve));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    await page.getByLabel('Texture file', {
      exact: true
    }).setInputFiles({
      name: 'test.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png)
    });
    await page.waitForFunction(() => document.querySelector('.texture-preview canvas').width === 16 && !document.querySelector('.busy-overlay'));
    await page.getByRole('button', {
      name: 'Edit',
      exact: true
    }).click();
    await page.getByRole('menuitem', {
      name: /^Undo/
    }).click();
    await page.waitForFunction(() => document.querySelector('.texture-preview canvas').width === 128);
    await page.keyboard.press('Control+y');
    await page.waitForFunction(() => document.querySelector('.texture-preview canvas').width === 16);

    // Exercise the browser-download fallback without opening a native OS file dialog.
    await page.evaluate(() => {
      window.showSaveFilePicker = undefined;
    });
    await page.getByRole('button', {
      name: 'Project',
      exact: true
    }).click();
    const saved = page.waitForEvent('download');
    await page.getByRole('menuitem', {
      name: /^Save project/
    }).click();
    const projectPath = await (await saved).path();
    const document = JSON.parse(gunzipSync(await fs.readFile(projectPath)).toString());
    assert.equal(document.modelName, 'cube.fbx');
    assert.equal(document.editor.brush.hardness, 0.4);
    assert.equal(document.editor.processing.levels, 13);
    assert.equal(document.editor.specStrength, 0.75);
    assert.equal(document.palette.length, 11);
    await page.getByRole('button', {
      name: 'Export',
      exact: true
    }).click();
    const exported = page.waitForEvent('download');
    await page.getByRole('button', {
      name: 'Download ZIP',
      exact: true
    }).click();
    const archive = unzipSync(await fs.readFile(await (await exported).path()));
    assert.deepEqual(Object.keys(archive).sort(), ['diffuse.png', 'glow.png', 'material.json', 'spec.png']);
    page.on('dialog', dialog => dialog.accept());
    await page.getByRole('button', {
      name: 'Project',
      exact: true
    }).click();
    await page.getByRole('menuitem', {
      name: /^New project/
    }).click();
    await page.getByRole('button', {
      name: 'Load model',
      exact: true
    }).waitFor();
    await page.getByLabel('Project file', {
      exact: true
    }).setInputFiles({
      name: 'saved.pxwork',
      mimeType: 'application/octet-stream',
      buffer: await fs.readFile(projectPath)
    });
    await page.getByRole('button', {
      name: 'Model',
      exact: true
    }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.busy-overlay') && document.querySelector('.texture-preview canvas').width === 16);
    assert.equal(await page.getByRole('spinbutton', {
      name: 'Hardness',
      exact: true
    }).inputValue(), '40');
    assert.equal(await page.locator('.error-banner').count(), 0);
    assert.deepEqual(errors, [], 'Production browser errors');
    reports.push({
      suite: 'production',
      tests: [{
        name: 'Import, controls, undo/redo, save, export, new and reopen',
        pass: true
      }]
    });
    console.log('production: end-to-end workflow passed');
  } finally {
    await context.close();
  }
}
try {
  // Playwright always launches a separate signed-out browser with a temporary profile.
  // An explicit executable may point to an automation-owned Chromium installation.
  browser = await chromium.launch({
    executablePath: process.env.TEST_CHROMIUM_EXECUTABLE || undefined,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  server = await createServer({
    root,
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: true,
      open: false
    }
  });
  await server.listen();
  const baseURL = server.resolvedUrls.local[0];
  for (const name of ['runtime', 'projects', 'live-processing', 'seams', 'texture-processing', 'specular', 'paint-performance', 'gpu-paint', 'uv-paint']) await suite(name, baseURL);
  production = await preview({
    root,
    preview: {
      host: '127.0.0.1',
      port: 0,
      strictPort: true,
      open: false
    }
  });
  await productionSmoke(production.resolvedUrls.local[0]);
  console.log(`All ${reports.reduce((count, report) => count + report.tests.length, 0)} browser checks passed.`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server?.close();
  if (production) await new Promise(resolve => production.httpServer.close(resolve));
  await fs.mkdir(path.join(root, '.cache'), {
    recursive: true
  });
  await fs.writeFile(path.join(root, '.cache/browser-results.json'), JSON.stringify(reports, null, 2));
}
