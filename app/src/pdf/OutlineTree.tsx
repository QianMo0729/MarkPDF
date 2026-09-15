import { useState } from "react";
import { Icon } from "../core/ui/Icon";
import type { OutlineNode } from "./outline";

interface Props {
  nodes: OutlineNode[];
  active: OutlineNode | null;
  rowHeight: number;
  onSelect: (node: OutlineNode) => void;
}

/** Recursive bookmark tree shared by the rail and the outline panel (docs/SPEC.md 6.5.2 / 6.5.9). */
export function OutlineTree({ nodes, active, rowHeight, onSelect }: Props) {
  return (
    <div className="outline-tree" role="tree">
      {nodes.map((n, i) => (
        <OutlineRow key={i} node={n} depth={0} active={active} rowHeight={rowHeight} onSelect={onSelect} />
      ))}
    </div>
  );
}

function OutlineRow({ node, depth, active, rowHeight, onSelect }: { node: OutlineNode; depth: number; active: OutlineNode | null; rowHeight: number; onSelect: (n: OutlineNode) => void }) {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = node.items.length > 0;
  return (
    <>
      <div
        role="treeitem"
        aria-expanded={hasChildren ? open : undefined}
        className={`outline-row ${active === node ? "active" : ""}`}
        style={{ height: rowHeight, paddingLeft: 8 + depth * 12 }}
        onClick={() => onSelect(node)}
        title={node.title}
      >
        {hasChildren ? (
          <button
            className="outline-toggle"
            aria-label={open ? "折叠" : "展开"}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
          >
            <Icon name={open ? "expand_more" : "chevron_right"} size={16} />
          </button>
        ) : (
          <span className="outline-toggle" />
        )}
        <span className="outline-title caption">{node.title}</span>
      </div>
      {hasChildren && open && node.items.map((c, i) => <OutlineRow key={i} node={c} depth={depth + 1} active={active} rowHeight={rowHeight} onSelect={onSelect} />)}
    </>
  );
}
