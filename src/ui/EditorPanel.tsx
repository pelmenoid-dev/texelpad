import { useId } from 'react';
import { Brush, Pencil, Eraser, FolderInput } from 'lucide-react';
import { MAPS } from '../maps';
import type { MapKind } from '../maps';
import type { Studio } from '../studio';
import { Slider, Tool } from './controls';
import { ProjectPalette } from './ProjectPalette';
import { TextureCanvas } from './TextureCanvas';
const names = {
  diffuse: 'Diffuse',
  spec: 'Specular',
  glow: 'Glow'
};
type Props = {
  studio: Studio | null;
  busy: boolean;
  onMapUpload: (kind: MapKind) => void;
  onBrushChange: (key: 'size' | 'opacity' | 'hardness', value: number) => void;
};
export function EditorPanel({
  studio: s,
  busy,
  onMapUpload,
  onBrushChange
}: Props) {
  const id = useId();
  const active = s?.active ?? 'diffuse',
    pixels = s?.processed[active];
  const selectMap = (kind: MapKind) => s?.selectMap(kind);
  return <aside className="material-panel editor-panel paint-panel" aria-label="Painting">
    <div className="editor-panel-header">
      <div className="editor-tabs" role="tablist" aria-label="Texture maps">
        {MAPS.map(kind => <button
          type="button"
          key={kind}
          id={`${id}-${kind}-tab`}
          role="tab"
          aria-selected={active === kind}
          aria-controls={`${id}-map-panel`}
          tabIndex={active === kind ? 0 : -1}
          disabled={!s || busy}
          onClick={() => selectMap(kind)}
          onKeyDown={e => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
            e.preventDefault();
            const index = MAPS.indexOf(kind),
              next = MAPS[e.key === 'Home' ? 0 : e.key === 'End' ? MAPS.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + MAPS.length) % MAPS.length];
            selectMap(next);
            document.getElementById(`${id}-${next}-tab`)?.focus();
          }}
        >
          {names[kind]}
        </button>)}
      </div>
    </div>
    <div
      className="editor-panel-body"
      id={`${id}-map-panel`}
      role="tabpanel"
      aria-labelledby={`${id}-${active}-tab`}
    >
      <div className="texture-controls">
        <div className="texture-preview">
          <TextureCanvas studio={s} kind={active} name={names[active]} />
          <div className="texture-source-meta">
            <button
              type="button"
              className="button texture-load-button"
              aria-label="Load texture"
              title="Load texture"
              disabled={!s || busy}
              onClick={() => onMapUpload(active)}
            >
              <FolderInput size={17} />
            </button>
            {pixels && <span className="texture-source-size">{pixels.width} × {pixels.height}</span>}
          </div>
          <button
            type="button"
            className="button texture-uv-button"
            aria-label="Show UV layout"
            aria-pressed={s?.uvVisible ?? false}
            title={s?.uvVisible ? 'Hide UV layout' : 'Show UV layout'}
            disabled={!s?.meshes.length || busy}
            onClick={() => s?.setUvVisible(!s.uvVisible)}
          >UV</button>
        </div>
      </div>
      <section className="paint-settings" aria-label="Brush settings">
        <div className="tools-grid" role="group" aria-label="Select tool">
          <Tool label="Pencil · P" pressed={s?.brush.tool === 'pencil'} onClick={() => s?.setTool('pencil')}>
            <Pencil size={19} />
          </Tool>
          <Tool label="Brush · B" pressed={s?.brush.tool === 'brush'} onClick={() => s?.setTool('brush')}>
            <Brush size={19} />
          </Tool>
          <Tool label="Eraser · E" pressed={s?.brush.tool === 'eraser'} onClick={() => s?.setTool('eraser')}>
            <Eraser size={19} />
          </Tool>
        </div>
        <Slider
          label="Size"
          value={s?.brush.size ?? 24}
          min={1}
          max={128}
          step={1}
          suffix="px"
          onChange={v => onBrushChange('size', v)}
        />
        <Slider
          label="Opacity"
          value={(s?.brush.opacity ?? 1) * 100}
          min={1}
          max={100}
          step={1}
          suffix="%"
          onChange={v => onBrushChange('opacity', v / 100)}
        />
        {s?.brush.tool === 'brush' && <Slider
          label="Hardness"
          value={s.brush.hardness * 100}
          min={0}
          max={100}
          step={1}
          suffix="%"
          onChange={v => onBrushChange('hardness', v / 100)}
        />}
        {s?.brush.tool !== 'eraser' && <div className="palette-settings" role="group" aria-labelledby={`${id}-palette`}>
          <div className="field-heading" id={`${id}-palette`}>Color</div>
          {s && <ProjectPalette key={active} studio={s} />}
        </div>}
      </section>
    </div>
  </aside>;
}
