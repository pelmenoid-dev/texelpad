import { useEffect, useReducer, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Download, X } from 'lucide-react';
import { Studio } from './studio';
import { gridSize } from './maps';
import type { MapKind } from './maps';
import { exportMaps } from './export';
import { decodeProject, restoreProject, saveProject, defaultProjectUI, readSessionHandoff, finishSessionHandoff } from './project';
import type { ProjectUI } from './project';
import { EditorPanel } from './ui/EditorPanel';
import { RenderPanel } from './ui/RenderPanel';
import { ProjectMenu } from './ui/ProjectMenu';
import { EditMenu } from './ui/EditMenu';
import { ModelMenu } from './ui/ModelMenu';
import { captureDevSession } from './devSession';
let devSession = import.meta.hot ? captureDevSession() : undefined;
export default function App() {
  const host = useRef<HTMLDivElement>(null),
    studio = useRef<Studio | null>(null),
    cursorRef = useRef<HTMLDivElement>(null);
  const modelInput = useRef<HTMLInputElement>(null),
    mapInput = useRef<HTMLInputElement>(null),
    uploadKind = useRef<MapKind>('diffuse');
  const [, redraw] = useReducer(n => n + 1, 0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(() => Boolean(sessionStorage.getItem('pixel-workshop-handoff'))),
    [exportOpen, setExportOpen] = useState(false),
    [exportProcessed, setExportProcessed] = useState(false);
  const exportTrigger = useRef<HTMLButtonElement>(null);
  const projectInput = useRef<HTMLInputElement>(null),
    saveAction = useRef<() => void>(() => { }),
    busyRef = useRef(busy);
  const [compactHeader, setCompactHeader] = useState(() => window.matchMedia('(max-width:760px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width:760px)'),
      update = () => setCompactHeader(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const reduced = useReducedMotion();
  const s = studio.current;
  const applyUI = (ui: ProjectUI) => {
    setExportProcessed(ui.exportProcessed);
    setExportOpen(ui.exportOpen);
  };
  useEffect(() => {
    if (!host.current) return;
    let active = true;
    let instance: Studio | undefined;
    const cleanup = () => {
      active = false;
      instance?.dispose();
      if (import.meta.env.DEV && window.__workshop === instance) delete window.__workshop;
      studio.current = null;
    };
    try {
      const created = new Studio(host.current, redraw, setError, (x, y, visible) => {
        const c = cursorRef.current;
        if (c) {
          c.style.display = visible ? 'block' : 'none';
          c.style.left = `${x}px`;
          c.style.top = `${y}px`;
        }
      });
      instance = created;
      studio.current = created;
      if (import.meta.env.DEV) window.__workshop = created;
      const resumed = devSession;
      if (resumed) {
        applyUI(restoreProject(created, resumed));
        created.dirty = resumed.dirty;
        setTimeout(() => {
          if (devSession === resumed) devSession = undefined;
        }, 0);
      }
      redraw();
      void (resumed ? Promise.resolve(undefined) : readSessionHandoff()).then(data => {
        if (!active || !data) return;
        applyUI(restoreProject(created, data));
        created.dirty = data.dirty;
        finishSessionHandoff();
        redraw();
      }).catch(e => {
        if (active) setError(`Session recovery could not be opened: ${String(e)}. Your backup file is unchanged.`);
      }).finally(() => {
        if (active) {
          busyRef.current = false;
          setBusy(false);
        }
      });
    } catch (e) {
      cleanup();
      busyRef.current = false;
      setBusy(false);
      setError(`Could not open the 3D studio: ${String(e)}. Check that your browser supports WebGL2.`);
    }
    return cleanup;
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = studio.current;
      if (!s) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!busyRef.current) saveAction.current();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        if (!busyRef.current) projectInput.current?.click();
        return;
      }
      if (busyRef.current || /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)) return;
      if (e.key === 'Escape') {
        setExportOpen(false);
        s.cancelColorPick();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? s.redo() : s.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tools = {
        b: 'brush',
        p: 'pencil',
        e: 'eraser',
        i: 'pick',
        h: 'hand'
      } as const;
      const key = e.key.toLowerCase();
      if (key in tools) s.setTool(tools[key as keyof typeof tools]);
      if (key === 'f') {
        s.frameModel();
        s.dirty = true;
      }
      if (e.key === '[' || e.key === ']') {
        s.endStroke();
        s.dirty = true;
        s.brush.size = Math.max(1, Math.min(128, s.brush.size + (e.key === ']' ? 2 : -2)));
        redraw();
      }
    };
    const unload = (e: BeforeUnloadEvent) => {
      if (studio.current?.dirty || studio.current?.hasPendingPaint) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', unload);
    const blur = () => studio.current?.endStroke();
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', unload);
      window.removeEventListener('blur', blur);
    };
  }, []);
  const run = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    studio.current?.endStroke();
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
      redraw();
    }
  };
  const ui: ProjectUI = {
    processed: s?.processing.enabled ?? true,
    exportProcessed,
    mobilePanel: 'maps',
    exportOpen,
    helpOpen: false
  };
  if (import.meta.hot) window.__workshopUI = ui;
  saveAction.current = () => {
    void run(async () => {
      if (studio.current) await saveProject(studio.current, ui);
    });
  };
  const openProject = (file: File) => {
    studio.current?.endStroke();
    if (studio.current?.dirty && !window.confirm('Open this project and replace the current unsaved work? Save a project first to keep it.')) return;
    void run(async () => {
      const project = await decodeProject(file);
      if (studio.current) {
        applyUI(restoreProject(studio.current, project));
      }
    });
  };
  const newProject = () => {
    if (!s) return;
    s.endStroke();
    if (s.dirty && !window.confirm('Create a new project and discard unsaved changes? Save the current project first to keep it.')) return;
    s.newProject();
    applyUI(defaultProjectUI);
    setError('');
  };
  const brushChange = (key: 'size' | 'opacity' | 'hardness', value: number) => {
    if (!s || !Number.isFinite(value)) return;
    s.endStroke();
    s.brush[key] = value;
    s.dirty = true;
    redraw();
  };
  const requestMap = (kind: MapKind) => {
    uploadKind.current = kind;
    mapInput.current?.click();
  };
  const loadModel = (file: File) => run(async () => {
    await studio.current?.loadModel(file);
  });
  const [gw, gh] = s ? gridSize(s.maps.diffuse.width, s.maps.diffuse.height, s.processing.texels) : [128, 128];
  const modelControl = <ModelMenu
    studio={s}
    busy={busy}
    onOpen={() => modelInput.current?.click()}
    onExpand={() => setExportOpen(false)}
  />;
  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><h1>Texelpad</h1></div>
      <div className="document-menus" role="group" aria-label="Workspace commands">
        <ProjectMenu
          busy={busy}
          hasProject={!!s}
          onOpen={() => projectInput.current?.click()}
          onSave={() => saveAction.current()}
          onNew={newProject}
          onExpand={() => setExportOpen(false)}
        />
        <EditMenu studio={s} busy={busy} onExpand={() => setExportOpen(false)} />
        {!compactHeader && modelControl}
      </div>
      <div className="topbar-end">
        <button
          ref={exportTrigger}
          className="button primary"
          disabled={!s || busy}
          onClick={() => setExportOpen(!exportOpen)}
          aria-expanded={exportOpen}
          aria-controls={exportOpen ? 'export-options' : undefined}
        >
          <Download size={16} />
          <span>Export</span>
        </button>
        <AnimatePresence>
          {exportOpen && <motion.div
            id="export-options"
            className="export-panel"
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setExportOpen(false);
                exportTrigger.current?.focus();
              }
            }}
            initial={{
              opacity: 0,
              y: reduced ? 0 : -6
            }}
            animate={{
              opacity: 1,
              y: 0
            }}
            exit={{
              opacity: 0
            }}
            transition={{
              duration: .16
            }}
          >
            <div className="panel-heading">
              <h2>Export textures</h2>
              <button
                className="icon-button"
                aria-label="Close export"
                onClick={() => {
                  setExportOpen(false);
                  exportTrigger.current?.focus();
                }}
              >
                <X size={16} />
              </button>
            </div>
            <fieldset aria-label="Maps to export">
              <label className={`export-choice ${!exportProcessed ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="export"
                  checked={!exportProcessed}
                  onChange={() => setExportProcessed(false)}
                />
                <span><strong>Original</strong><small>All brushwork before pixelisation</small></span>
              </label>
              <label className={`export-choice ${exportProcessed ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="export"
                  checked={exportProcessed}
                  onChange={() => setExportProcessed(true)}
                />
                <span>
                  <strong>Pixel grid</strong>
                  <small>
                    {s?.processing.enabled ? `${gw}×${gh}, grid-sampled maps` : 'Processing is off: original sizes'}
                  </small>
                </span>
              </label>
            </fieldset>
            <button
              className="button primary full"
              disabled={busy}
              onClick={() => run(async () => {
                if (s) {
                  await exportMaps(s, exportProcessed);
                  setExportOpen(false);
                }
              })}
            >
              <Download size={16} />Download ZIP</button>
          </motion.div>}
        </AnimatePresence>
      </div>
      {compactHeader && modelControl}
    </header>
    <input
      ref={projectInput}
      type="file"
      accept=".pxwork"
      className="file-input"
      aria-label="Project file"
      onChange={e => {
        const file = e.target.files?.[0];
        if (file) openProject(file);
        e.target.value = '';
      }}
    />
    <input
      ref={modelInput}
      type="file"
      accept=".obj,.fbx"
      className="file-input"
      aria-label="Model file"
      onChange={e => {
        const f = e.target.files?.[0];
        if (f) {
          s?.endStroke();
          if (!s?.meshes.length || !s.dirty || window.confirm('Open a new model and discard unsaved maps?')) loadModel(f);
        }
        e.target.value = '';
      }}
    />
    <input
      ref={mapInput}
      type="file"
      accept=".png,.jpg,.jpeg,image/png,image/jpeg"
      className="file-input"
      aria-label="Texture file"
      onChange={e => {
        const f = e.target.files?.[0];
        if (f) run(async () => {
          await studio.current?.loadMap(f, uploadKind.current);
        });
        e.target.value = '';
      }}
    />
    <main className="workspace" inert={busy || undefined}>
      <EditorPanel
        studio={s}
        busy={busy}
        onMapUpload={requestMap}
        onBrushChange={brushChange}
      />
      <section className="studio-panel" aria-label="Studio">
        <div
          ref={host}
          className={`viewport tool-${s?.brush.tool ?? 'pencil'}`}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (!f) return;
            if (/\.pxwork$/i.test(f.name)) {
              openProject(f);
            } else if (/\.(obj|fbx)$/i.test(f.name)) {
              s?.endStroke();
              if (!s?.meshes.length || !s.dirty || window.confirm('Replace the model and unsaved maps?')) loadModel(f);
            } else run(async () => {
              await studio.current?.loadMap(f, studio.current.active);
            });
          }}
        >
          <div
            ref={cursorRef}
            className={`brush-cursor ${s?.brush.tool === 'pencil' ? 'square' : ''}`}
            style={{
              width: s?.brush.size ?? 24,
              height: s?.brush.size ?? 24
            }}
          />
        </div>
        <div className="viewport-bottom">
          <label
            className="viewport-button wireframe-toggle"
            title={s?.wireframe?.visible ? 'Hide model wireframe' : 'Show model wireframe'}
          >
            <input
              type="checkbox"
              disabled={!s?.meshes.length}
              checked={s?.wireframe?.visible ?? false}
              onChange={e => s?.setWireframeVisible(e.target.checked)}
            />
            <span>Wireframe</span>
          </label>
        </div>
        {busy && <div className="busy-overlay" role="status">Processing file…</div>}
      </section>
      <RenderPanel studio={s} busy={busy} />
    </main>
    {error && <div className="error-banner" role="alert">
      <span>{error}</span>
      <button aria-label="Dismiss message" onClick={() => setError('')}><X size={17} /></button>
    </div>}
  </div>;
}
