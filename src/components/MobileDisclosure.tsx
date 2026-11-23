import { type ReactNode, useId, useState } from 'react';

/** 只在手机上折叠次要工具，内容保持挂载以保留表单输入和正在进行的操作。 */
export default function MobileDisclosure({ label, value, children }: {
  label: string;
  value?: string;
  children: ReactNode;
}) {
  const contentId = useId();
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <button
        className="mobile-disclosure-toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((previous) => !previous)}
      >
        <span>{label}</span>
        {value && <small>{value}</small>}
      </button>
      <div id={contentId} className="mobile-disclosure-body" data-expanded={expanded}>{children}</div>
    </>
  );
}
