import { ChevronDown, FolderInput } from 'lucide-react';
import type { Studio } from '../studio';
import { ActionMenu } from './ActionMenu';
export function ModelMenu({
  studio: s,
  busy,
  onOpen,
  onExpand
}: {
  studio: Studio | null;
  busy: boolean;
  onOpen: () => void;
  onExpand: () => void;
}) {
  if (!s?.meshes.length) return <div className="model-menu">
    <button
      type="button"
      className="button model-load-button"
      disabled={!s || busy}
      onClick={onOpen}
    >
      <FolderInput size={16} />
      <span>Load model</span>
    </button>
  </div>;
  return <ActionMenu
    label="Model"
    className="model-menu"
    triggerClass="model-menu-trigger"
    title={s.modelName}
    disabled={busy}
    closeKey={s.model}
    onOpen={onExpand}
    trigger={<><span>{s.modelName}</span><ChevronDown size={14} /></>}
    info={<><strong>{s.modelName}</strong><span>
      {Math.round(s.triangles).toLocaleString('en-US')} {s.triangles === 1 ? 'triangle' : 'triangles'}
    </span></>}
    actions={[{
      label: 'Replace model',
      icon: <FolderInput size={16} />,
      onSelect: onOpen
    }]}
  />;
}
