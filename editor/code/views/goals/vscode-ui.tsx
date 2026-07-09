import React, { Children, ReactNode, isValidElement, useState } from "react";
import "./vscode-ui.css";

export function VSCodeBadge({ children }: { children?: ReactNode }) {
  return <span className="vsui-badge">{children}</span>;
}

export function VSCodeButton({
  children,
  onClick,
  onMouseOver,
  onMouseOut,
  ariaLabel,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  appearance?: string;
  // The real toolkit's React wrapper accepted this camelCase prop (distinct
  // from the standard `aria-label` attribute, which still works via `rest`).
  ariaLabel?: string;
}) {
  const { appearance: _ignored, className, ...attrs } = rest;
  return (
    <button
      className={`vsui-icon-button ${className ?? ""}`.trim()}
      onClick={onClick}
      onMouseOver={onMouseOver}
      onMouseOut={onMouseOut}
      aria-label={ariaLabel}
      {...attrs}
    >
      {children}
    </button>
  );
}

export function VSCodeDivider() {
  return <hr className="vsui-divider" />;
}

// Tabs: children arrive as an interleaved [tab, tab, ..., view, view, ...]
// array (that is how ProofViewPage composes VSCodePanels). Pair them by index.
type PanelTabProps = {
  children?: ReactNode;
  id?: string;
  onClick?: () => void;
};
export function VSCodePanelTab({ children }: PanelTabProps) {
  return <>{children}</>;
}
export function VSCodePanelView({
  children,
  className,
  id,
}: {
  children?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div id={id} className={`vsui-view ${className ?? ""}`.trim()}>
      {children}
    </div>
  );
}

export function VSCodePanels({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  const [active, setActive] = useState(0);
  const items = Children.toArray(children).flat();
  const half = Math.floor(items.length / 2);
  const tabs = items.slice(0, half);
  const views = items.slice(half);
  return (
    <div className={`vsui-panels ${className ?? ""}`}>
      <div className="vsui-tabbar" role="tablist">
        {tabs.map((t, i) => {
          // GoalTabs.tsx attaches its own onClick (scroll-into-view) to each
          // VSCodePanelTab; fire it alongside the tab switch.
          const tabOnClick = isValidElement<PanelTabProps>(t)
            ? t.props.onClick
            : undefined;
          return (
            <button
              key={i}
              role="tab"
              aria-selected={i === active}
              className={`vsui-tab ${i === active ? "vsui-tab-active" : ""}`}
              onClick={() => {
                setActive(i);
                tabOnClick?.();
              }}
            >
              {t}
            </button>
          );
        })}
      </div>
      {views[active]}
    </div>
  );
}
