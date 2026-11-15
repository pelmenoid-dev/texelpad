import { useId } from 'react';
import type { Studio } from '../studio';
import { Slider } from './controls';
export function RenderPanel({
  studio: s,
  busy
}: {
  studio: Studio | null;
  busy: boolean;
}) {
  const id = useId(),
    pixelisation = s?.processing.enabled ?? true,
    lighting = s?.renderMode !== 'unlit';
  return <aside className="material-panel editor-panel render-panel" aria-label="Render">
    <div className="editor-panel-body">
      <section className="pixelisation-settings" aria-label="Pixelisation settings">
        <div className="setting-heading">
          <h2 id={`${id}-pixelisation`}>Pixelisation</h2>
          <button
            className="setting-switch"
            type="button"
            role="switch"
            aria-labelledby={`${id}-pixelisation`}
            aria-checked={pixelisation}
            disabled={!s || busy}
            onClick={() => s?.setProcessing({
              enabled: !pixelisation
            })}
          >
            <span className={`switch ${pixelisation ? 'on' : ''}`} aria-hidden="true"><span /></span>
          </button>
        </div>
        <div className="setting-parameters pixelisation-parameters" aria-disabled={!pixelisation}>
          <Slider
            label="Texels per pixel"
            disabled={!s || !pixelisation}
            value={s?.processing.texels ?? 4}
            min={1}
            max={64}
            step={.1}
            onChange={v => s?.setProcessing({
              texels: v
            })}
          />
          <Slider
            label="Dithering"
            disabled={!s || !pixelisation}
            value={(s?.processing.dither ?? .3) * 100}
            min={0}
            max={100}
            step={1}
            suffix="%"
            onChange={v => s?.setProcessing({
              dither: v / 100
            })}
          />
          <Slider
            label="Color levels"
            disabled={!s || !pixelisation}
            value={s?.processing.levels ?? 256}
            min={2}
            max={256}
            step={1}
            onChange={v => s?.setProcessing({
              levels: v
            })}
          />
        </div>
      </section>
      <section className="lighting-settings" aria-label="Lighting settings">
        <div className="setting-heading">
          <h2 id={`${id}-lighting`}>Lighting</h2>
          <button
            className="setting-switch"
            type="button"
            role="switch"
            aria-labelledby={`${id}-lighting`}
            aria-checked={lighting}
            disabled={!s || busy}
            onClick={() => s?.setRenderMode(lighting ? 'unlit' : 'lit')}
          >
            <span className={`switch ${lighting ? 'on' : ''}`} aria-hidden="true"><span /></span>
          </button>
        </div>
        <div className="setting-parameters lighting-parameters" aria-disabled={!lighting}>
          <Slider
            label="Light rotation"
            disabled={!s || !lighting}
            value={s?.lightAngle ?? 35}
            min={0}
            max={360}
            step={1}
            suffix="°"
            onChange={v => {
              if (s) {
                s.lightAngle = v;
                s.updateMaterial();
                s.dirty = true;
                s.changed();
              }
            }}
          />
          <Slider
            label="Specular"
            disabled={!s || !lighting}
            value={s?.specStrength ?? .7}
            min={0}
            max={2}
            step={.05}
            onChange={v => {
              if (s) {
                s.specStrength = v;
                s.updateMaterial();
                s.dirty = true;
                s.changed();
              }
            }}
          />
          <Slider
            label="Glow"
            disabled={!s || !lighting}
            value={s?.glowStrength ?? 1.5}
            min={0}
            max={8}
            step={.1}
            onChange={v => {
              if (s) {
                s.glowStrength = v;
                s.updateMaterial();
                s.dirty = true;
                s.changed();
              }
            }}
          />
        </div>
      </section>
    </div>
  </aside>;
}
