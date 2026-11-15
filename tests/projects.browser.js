import { reportResults } from './browser-report';
import { seedTestModel } from './fixtures/demo.ts';
async function run() {
  const {
    captureProject,
    encodeProject,
    decodeProject,
    restoreProject
  } = await import('../src/project.ts');
  const {
    blankMap,
    copyPixels
  } = await import('../src/maps.ts');
  const {
    defaultDiffuseColors
  } = await import('../src/palettes.ts');
  const THREE = await import('three');
  const {
    Studio
  } = await import('../src/studio.ts');
  const s = new Studio(document.querySelector('#studio'), () => {}, () => {}, () => {}),
    results = [];
  const check = async (name, fn) => {
    try {
      await fn();
      results.push({
        name,
        pass: true
      });
    } catch (e) {
      results.push({
        name,
        pass: false,
        error: String(e)
      });
    }
  };
  const assert = (x, msg) => {
    if (!x) throw Error(msg);
  };
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const empty = captureProject(s);
  await check('Startup is an empty project; blank projects save and reopen', async () => {
    assert(!s.meshes.length && s.triangles === 0 && s.modelName === 'Untitled' && !s.dirty, 'Startup is not empty');
    assert(s.palette.length === 11 && new Set(s.palette).size === 11 && s.palette.includes(s.brush.color), 'Starter colors or selected brush color missing');
    s.addPaletteColor('#123456');
    s.setProcessing({
      texels: 12
    });
    const saved = await decodeProject(await encodeProject(captureProject(s)));
    assert(saved.model === null, 'Empty project contains geometry');
    seedTestModel(s);
    restoreProject(s, saved);
    assert(!s.meshes.length && equal(s.palette, [...defaultDiffuseColors, '#123456']) && s.processing.texels === 12, 'Empty project did not reopen');
  });
  await check('New project clears document data, settings, camera and pending tools', () => {
    seedTestModel(s);
    s.addPaletteColor('#abcdef');
    s.setProcessing({
      enabled: false,
      dither: .9,
      levels: 5
    });
    s.setRenderMode('unlit');
    s.setWireframeVisible(true);
    s.selectMap('glow');
    s.lightAngle = 170;
    s.glowStrength = 5;
    s.camera.position.set(-2, 4, 1);
    s.camera.zoom = 2;
    s.camera.up.set(0, 0, 1);
    s.controls.target.set(1, 0, 0);
    s.controls.update();
    s.pickColorOnce(() => {}, () => {});
    s.newProject();
    const reset = captureProject(s);
    assert(reset.model === null && equal(reset.maps, empty.maps) && equal(reset.history, empty.history), 'Old document remains');
    assert(equal(reset.editor, empty.editor) && equal(reset.palette, empty.palette) && equal(reset.grayPalettes, empty.grayPalettes), 'Settings were not reset');
    assert(!s.dirty && s.grid.visible && !s.wireframe.visible && s.controls.enabled, 'Invalid blank state');
    for (const key of ['position', 'quaternion', 'up', 'target', 'position0', 'target0']) assert(reset.camera[key].every((v, i) => Math.abs(v - empty.camera[key][i]) < 1e-9), 'Camera not reset: ' + key);
    assert(reset.camera.zoom === 1 && reset.camera.zoom0 === 1, 'Camera zoom not reset');
  });
  await check('First model import preserves textures and palette prepared in an empty project', async () => {
    s.newProject();
    s.addPaletteColor('#123456');
    s.maps.diffuse.data[0] = 37;
    const maps = s.maps;
    await s.loadModel(new File(['v -1 0 0\nv 1 0 0\nv 0 2 0\nvt 0 0\nvt 1 0\nvt .5 1\nf 1/1 2/2 3/3\n'], 'triangle.obj'));
    assert(s.triangles === 1 && s.maps === maps && s.maps.diffuse.data[0] === 37 && equal(s.palette, [...defaultDiffuseColors, '#123456']), 'Import discarded prepared work');
  });
  seedTestModel(s);
  const meshState = () => s.meshes.map(m => ({
    world: m.matrixWorld.elements.map(n => Math.round(n * 1e9) / 1e9),
    attributes: Object.fromEntries(Object.entries(m.geometry.attributes).map(([k, a]) => [k, Array.from(a.array)])),
    indices: m.geometry.index ? Array.from(m.geometry.index.array) : null
  }));
  s.maps = {
    diffuse: blankMap('diffuse', 64, 32),
    spec: blankMap('spec', 32, 64),
    glow: blankMap('glow', 16, 16)
  };
  for (let i = 0; i < s.maps.diffuse.data.length; i++) s.maps.diffuse.data[i] = i * 31 % 256;
  s.maps.diffuse.data.set([19, 203, 74, 0], 0);
  s.maps.diffuse.data.set([199, 2, 83, 1], 4);
  s.history.clear();
  let before = copyPixels(s.maps.diffuse);
  s.maps.diffuse.data[8] = 123;
  s.history.push({
    kind: 'diffuse',
    before,
    after: copyPixels(s.maps.diffuse),
    label: 'Paint alpha fixture'
  });
  before = copyPixels(s.maps.glow);
  s.maps.glow.data[0] = 67;
  s.history.push({
    kind: 'glow',
    before,
    after: copyPixels(s.maps.glow),
    label: 'Glow stroke'
  });
  s.undo();
  s.setProcessing({
    texels: 3.7,
    dither: .63,
    levels: 11
  });
  Object.assign(s.brush, {
    tool: 'brush',
    size: 17,
    opacity: .41,
    color: '#13ff01',
    value: .2,
    hardness: .14
  });
  s.active = 'spec';
  s.lightAngle = 217;
  s.specStrength = 1.45;
  s.glowStrength = 4.3;
  s.camera.position.set(1.4, 2.1, 7);
  s.controls.target.set(.3, .8, .1);
  s.controls.enableDamping = false;
  s.controls.update();
  s.controls.saveState();
  s.refresh();
  s.model.updateMatrixWorld(true);
  const ui = {
    processed: false,
    exportProcessed: true,
    mobilePanel: 'maps',
    exportOpen: true,
    helpOpen: false
  };
  const target = new THREE.WebGLRenderTarget(192, 192);
  const frame = () => {
    s.renderer.setRenderTarget(target);
    s.renderer.render(s.scene, s.camera);
    const bytes = new Uint8Array(192 * 192 * 4);
    s.renderer.readRenderTargetPixels(target, 0, 0, 192, 192, bytes);
    s.renderer.setRenderTarget(null);
    return bytes;
  };
  const originalPixels = frame(),
    originalMesh = meshState(),
    original = captureProject(s, ui);
  let loaded;
  await check('Compressed project preserves every source RGBA byte, including invisible RGB', async () => {
    loaded = await decodeProject(await encodeProject(original));
    assert(equal(loaded.maps, original.maps), 'Map bytes changed');
    assert(equal(loaded.history, original.history), 'History bytes changed');
  });
  await check('Restore retains geometry, UVs, transforms, settings, camera and panels', () => {
    seedTestModel(s);
    s.lightAngle = 0;
    s.camera.position.set(0, 5, 8);
    s.controls.update();
    const restoredUI = restoreProject(s, loaded),
      again = captureProject(s, restoredUI);
    assert(equal(again.maps, original.maps), 'Maps differ');
    assert(equal(again.editor, original.editor), 'Editor differs');
    assert(equal(again.camera, original.camera), 'Camera differs');
    assert(equal(restoredUI, ui), 'Panels differ');
    assert(equal(meshState(), originalMesh), 'Geometry/UVs differ');
  });
  await check('Restored material renders identical GPU pixels', () => {
    const pixels = frame();
    let mismatch = 0;
    for (let i = 0; i < pixels.length; i++) if (pixels[i] !== originalPixels[i]) mismatch++;
    assert(mismatch === 0, `${mismatch} channels differ`);
  });
  await check('Undo and redo remain usable after opening', () => {
    s.redo();
    assert(s.maps.glow.data[0] === 67, 'Redo lost');
    s.undo();
    assert(equal(captureProject(s).maps, original.maps), 'Undo does not return to saved maps');
    s.undo();
    assert(s.maps.diffuse.data[8] === before.data[8] || s.maps.diffuse.data[8] !== 123, 'Earlier history lost');
    s.redo();
  });
  await check('Bad version, corrupt data and external assets do not replace the current work', async () => {
    for (const mutate of [p => p.version = 999, p => p.maps.diffuse.data = 'broken', p => p.model.images = [{
      url: 'https://example.invalid/no.png'
    }]]) {
      const bad = structuredClone(original);
      mutate(bad);
      const model = s.model,
        maps = s.maps;
      let failed = false;
      try {
        restoreProject(s, bad);
      } catch {
        failed = true;
      }
      assert(failed && s.model === model && s.maps === maps, 'Invalid project replaced document');
    }
    let failed = false;
    try {
      await decodeProject(new Blob(['not a project']));
    } catch {
      failed = true;
    }
    assert(failed, 'Corrupt gzip accepted');
  });
  await check('Invalid UV geometry leaves the current model intact', () => {
    const bad = structuredClone(original);
    bad.model.geometries[0].data.attributes.uv.array[0] = 8;
    const model = s.model;
    let failed = false;
    try {
      restoreProject(s, bad);
    } catch {
      failed = true;
    }
    assert(failed && s.model === model, 'Bad geometry replaced document');
  });
  await check('Unlit survives compression and opening; older projects still use Lit', async () => {
    restoreProject(s, original);
    s.setRenderMode('unlit');
    const unlit = captureProject(s, ui),
      unlitPixels = frame();
    const decoded = await decodeProject(await encodeProject(unlit));
    s.setRenderMode('lit');
    restoreProject(s, decoded);
    assert(s.renderMode === 'unlit' && !s.bloom.enabled, 'Unlit mode was lost');
    assert(equal(frame(), unlitPixels), 'Restored Unlit pixels differ');
    assert(equal(captureProject(s, ui).maps, original.maps) && equal(captureProject(s, ui).history, original.history), 'Switching mode changed paint or history');
    const legacy = structuredClone(original);
    delete legacy.editor.renderMode;
    restoreProject(s, legacy);
    assert(s.renderMode === 'lit' && s.bloom.enabled, 'Legacy file did not default to Lit');
    const bad = structuredClone(original);
    bad.editor.renderMode = 'invalid';
    const model = s.model;
    let failed = false;
    try {
      restoreProject(s, bad);
    } catch {
      failed = true;
    }
    assert(failed && s.model === model, 'Bad render mode replaced document');
  });
  await check('Project palettes preserve order and stay separate from maps and painting history', async () => {
    restoreProject(s, original);
    s.palette = [];
    s.brush.color = '#AABBCC';
    s.addPaletteColor();
    s.brush.color = '#112233';
    s.addPaletteColor();
    s.addPaletteColor();
    assert(equal(s.palette, ['#aabbcc', '#112233']), 'Palette ordering or duplicate protection failed');
    assert(s.dirty, 'Adding a color did not mark the project unsaved');
    const saved = await decodeProject(await encodeProject(captureProject(s, ui)));
    s.removePaletteColor();
    assert(equal(s.palette, ['#aabbcc']), 'Remove failed');
    restoreProject(s, saved);
    assert(equal(s.palette, ['#aabbcc', '#112233']), 'Saved colors did not return');
    const current = captureProject(s, ui);
    assert(equal(current.maps, original.maps) && equal(current.history, original.history), 'Palette edited texture data or painting history');
    s.brush.color = '#123456';
    s.addPaletteColor();
    seedTestModel(s);
    assert(equal(s.palette, defaultDiffuseColors), 'New fixture did not reset the project palette');
    restoreProject(s, saved);
    s.removePaletteColor();
    s.brush.color = '#aabbcc';
    s.removePaletteColor();
    const empty = await decodeProject(await encodeProject(captureProject(s, ui)));
    s.addPaletteColor();
    restoreProject(s, empty);
    assert(s.palette.length === 0, 'Empty saved palette was not retained');
  });
  await check('Missing palettes are recovered from original Diffuse colors and saved as editable project colors', async () => {
    restoreProject(s, original);
    s.maps.diffuse = blankMap('diffuse', 4, 1);
    s.maps.diffuse.data.set([23, 45, 91, 255, 180, 75, 50, 255, 233, 206, 128, 255, 255, 0, 255, 0]);
    s.refresh();
    const legacy = captureProject(s, ui);
    delete legacy.palette;
    legacy.editor.processing.enabled = true;
    legacy.editor.processing.texels = 4;
    const brush = structuredClone(legacy.editor.brush),
      gray = structuredClone(legacy.grayPalettes);
    restoreProject(s, legacy);
    const recovered = [...s.palette];
    assert(equal(recovered, ['#172d5b', '#b44b32', '#e9ce80']), 'Recovery lost a visible source color or included invisible RGB');
    assert(equal(s.brush, brush) && equal(s.grayPalettes, gray), 'Recovery changed brush selection or grayscale palettes');
    const after = captureProject(s, ui);
    assert(equal(after.maps, legacy.maps) && equal(after.history, legacy.history), 'Recovery changed paint or undo history');
    legacy.editor.processing.enabled = false;
    restoreProject(s, legacy);
    assert(equal(s.palette, recovered), 'Recovery depends on Pixelisation');
    assert(s.editPaletteColor(0, '#123456'), 'Recovered swatch cannot be edited');
    const saved = await decodeProject(await encodeProject(captureProject(s, ui)));
    seedTestModel(s);
    restoreProject(s, saved);
    assert(equal(s.palette, ['#123456', '#b44b32', '#e9ce80']), 'Recovered and edited palette did not survive save/open');
  });
  await check('Malformed palettes do not replace the active project', () => {
    for (const palette of [null, '#123456', ['bad'], [42], ['#AABBCC', '#aabbcc'], Array(257).fill('#123456')]) {
      const bad = structuredClone(original);
      bad.palette = palette;
      const model = s.model,
        maps = s.maps,
        colors = s.palette;
      let failed = false;
      try {
        restoreProject(s, bad);
      } catch {
        failed = true;
      }
      assert(failed && s.model === model && s.maps === maps && s.palette === colors, 'Invalid palette replaced current work');
    }
  });
  await check('Editing a palette swatch preserves its position and survives reopening', async () => {
    restoreProject(s, original);
    s.palette = ['#123456', '#abcdef'];
    assert(s.editPaletteColor(0, '#987654'), 'Valid edit was rejected');
    assert(equal(s.palette, ['#987654', '#abcdef']) && s.brush.color === '#987654', 'Edit changed ordering or brush selection');
    assert(!s.editPaletteColor(0, '#ABCDEF') && !s.editPaletteColor(-1, '#123456') && !s.editPaletteColor(0, 'bad'), 'Invalid or duplicate edit accepted');
    const edited = await decodeProject(await encodeProject(captureProject(s, ui)));
    restoreProject(s, original);
    restoreProject(s, edited);
    assert(equal(s.palette, ['#987654', '#abcdef']), 'Edited colors did not reopen');
    assert(equal(captureProject(s, ui).maps, original.maps), 'Palette edit recolored the texture');
  });
  await check('Editor tab and texture preview survive save/open; invalid UI leaves work intact', async () => {
    restoreProject(s, original);
    const nextUI = {
      ...ui,
      editorTab: 'render',
      texturePreviewOpen: true
    };
    const saved = await decodeProject(await encodeProject(captureProject(s, nextUI)));
    const restored = restoreProject(s, saved);
    assert(restored.editorTab === 'render' && restored.texturePreviewOpen === true, 'Editor context was lost');
    for (const badUI of [{
      editorTab: 'invalid'
    }, {
      texturePreviewOpen: 'true'
    }]) {
      const bad = structuredClone(saved);
      Object.assign(bad.ui, badUI);
      const model = s.model;
      let failed = false;
      try {
        restoreProject(s, bad);
      } catch {
        failed = true;
      }
      assert(failed && s.model === model, 'Invalid UI replaced the project');
    }
  });
  await check('Grayscale palettes stay separate, save exactly and never recolor maps', async () => {
    restoreProject(s, original);
    const diffuse = s.brush.color,
      glow = [...s.grayPalettes.glow];
    assert(s.addPaletteColor('#333333', 'spec'), 'Could not add gray');
    assert(s.editPaletteColor(1, '#555555', 'spec'), 'Could not edit gray');
    s.removePaletteColor(0, 'spec');
    assert(s.brush.value === 85 / 255 && s.brush.color === diffuse, 'Gray changed Diffuse color or used the wrong paint value');
    assert(equal(s.grayPalettes.glow, glow), 'Specular edit changed Glow palette');
    assert(!s.addPaletteColor('#123456', 'spec') && !s.editPaletteColor(0, '#ff0000', 'glow') && !s.addPaletteColor('#333333', 'spec'), 'Invalid or duplicate grayscale color accepted');
    s.grayPalettes.glow = [];
    const snapshot = captureProject(s, ui),
      saved = await decodeProject(await encodeProject(snapshot));
    seedTestModel(s);
    restoreProject(s, saved);
    assert(equal(s.grayPalettes, snapshot.grayPalettes), 'Grayscale order or empty palette was not preserved');
    assert(equal(captureProject(s, ui).maps, original.maps) && equal(captureProject(s, ui).history, original.history), 'Palette changed maps or history');
    const legacy = structuredClone(original);
    delete legacy.grayPalettes;
    const brush = structuredClone(legacy.editor.brush);
    restoreProject(s, legacy);
    assert(equal(s.brush, brush), 'Legacy migration changed the current brush');
    assert(equal(s.grayPalettes.spec, ['#000000', '#404040', '#808080', '#bfbfbf', '#ffffff']) && equal(s.grayPalettes.spec, s.grayPalettes.glow), 'Legacy grayscale defaults missing');
    assert(s.grayPalettes.spec !== s.grayPalettes.glow, 'Default map palettes share an array');
  });
  await check('Malformed grayscale palettes leave the active project intact', () => {
    for (const grayPalettes of [null, [], {}, {
      spec: [],
      glow: null
    }, {
      spec: ['#ff0000'],
      glow: []
    }, {
      spec: [42],
      glow: []
    }, {
      spec: ['#AAAAAA', '#aaaaaa'],
      glow: []
    }, {
      spec: Array(257).fill('#000000'),
      glow: []
    }]) {
      const bad = structuredClone(original);
      bad.grayPalettes = grayPalettes;
      const model = s.model,
        maps = s.maps,
        colors = s.grayPalettes;
      let failed = false;
      try {
        restoreProject(s, bad);
      } catch {
        failed = true;
      }
      assert(failed && s.model === model && s.maps === maps && s.grayPalettes === colors, 'Invalid grayscale palette replaced current work');
    }
  });
  await check('Grayscale sampling preserves the Diffuse brush and restores the painting tool', () => {
    restoreProject(s, original);
    const color = s.brush.color;
    let sampled;
    s.selectMap('spec');
    s.maps.spec.data.fill(91);
    s.setTool('brush');
    s.pickColorOnce(value => sampled = value, () => {});
    const ray = new THREE.Raycaster();
    let point;
    for (let y = .2; y <= .8 && !point; y += .1) for (let x = .2; x <= .8 && !point; x += .1) {
      ray.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), s.camera);
      if (ray.intersectObjects(s.meshes, false)[0]?.uv) point = [x * s.host.clientWidth, y * s.host.clientHeight];
    }
    assert(point, 'No sample point on test model');
    s.sample(...point);
    assert(sampled === '#5b5b5b' && s.brush.value === 91 / 255 && s.brush.color === color && s.brush.tool === 'brush', 'Sampling changed the wrong brush channel or did not return to Brush');
    s.pickColorOnce(() => {}, () => {});
    s.selectMap('glow');
    assert(s.brush.tool === 'brush', 'Map switch left the eyedropper active');
  });
  restoreProject(s, original);
  target.dispose();
  s.dispose();
  return results;
}
run().then(results => {
  reportResults({
    suite: 'projects',
    tests: results
  });
  window.projectResults = results;
  document.querySelector("#results").textContent = JSON.stringify(results, null, 2);
}).catch(error => {
  reportResults({
    suite: 'projects',
    tests: [],
    error: String(error)
  });
  document.querySelector("#results").textContent = String(error);
  throw error;
});
