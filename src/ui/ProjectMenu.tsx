import { ChevronDown, FilePlus2, FolderOpen, Save } from 'lucide-react';
import { ActionMenu } from './ActionMenu';
type Props = {
  busy: boolean;
  hasProject: boolean;
  onOpen: () => void;
  onSave: () => void;
  onNew: () => void;
  onExpand: () => void;
};
export function ProjectMenu({
  busy,
  hasProject,
  onOpen,
  onSave,
  onNew,
  onExpand
}: Props) {
  return <ActionMenu
    label="Project"
    className="project-menu"
    disabled={busy}
    onOpen={onExpand}
    trigger={<>Project<ChevronDown size={14} /></>}
    actions={[{
      label: 'New project',
      icon: <FilePlus2 size={16} />,
      disabled: !hasProject,
      onSelect: onNew
    }, {
      label: 'Open project',
      icon: <FolderOpen size={16} />,
      shortcut: 'Ctrl+O',
      onSelect: onOpen
    }, {
      label: 'Save project',
      icon: <Save size={16} />,
      disabled: !hasProject,
      shortcut: 'Ctrl+S',
      onSelect: onSave
    }]}
  />;
}
