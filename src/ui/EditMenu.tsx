import { ChevronDown, Undo2, Redo2 } from 'lucide-react';
import type { Studio } from '../studio';
import { ActionMenu } from './ActionMenu';
export function EditMenu({
  studio: s,
  busy,
  onExpand
}: {
  studio: Studio | null;
  busy: boolean;
  onExpand: () => void;
}) {
  return <ActionMenu
    label="Edit"
    className="edit-menu"
    triggerClass="edit-menu-trigger"
    disabled={!s || busy}
    onOpen={onExpand}
    trigger={<>Edit<ChevronDown size={14} /></>}
    actions={[{
      label: 'Undo',
      icon: <Undo2 size={16} />,
      shortcut: 'Ctrl+Z',
      disabled: !s?.history.past.length,
      onSelect: () => s?.undo()
    }, {
      label: 'Redo',
      icon: <Redo2 size={16} />,
      shortcut: 'Ctrl+Shift+Z',
      disabled: !s?.history.future.length,
      onSelect: () => s?.redo()
    }]}
  />;
}
