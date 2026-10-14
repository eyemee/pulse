// Minimal stroke icons (24px grid, currentColor) so the UI needs no icon
// dependency. All are decorative: callers provide the accessible label.
import type { SVGProps } from "react";

function Base(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}

export const VideoIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <rect x="3" y="6" width="13" height="12" rx="2.5" />
    <path d="m16 10.5 5-3v9l-5-3" />
  </Base>
);

export const VideoOffIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M10 6h3.5A2.5 2.5 0 0 1 16 8.5V12m0 3.5a2.5 2.5 0 0 1-2.5 2.5h-8A2.5 2.5 0 0 1 3 15.5v-7A2.5 2.5 0 0 1 5.5 6" />
    <path d="m16 10.5 5-3v9" />
    <path d="M3 3l18 18" />
  </Base>
);

export const MicIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Base>
);

export const MicOffIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M15 10V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.9 2.3" />
    <path d="M5 11a7 7 0 0 0 11.3 5.5M19 11a7 7 0 0 1-.6 2.8M12 18v3" />
    <path d="M3 3l18 18" />
  </Base>
);

export const CloseIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Base>
);

export const LocateIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </Base>
);

export const SendIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M5 12h13M13 6l6 6-6 6" />
  </Base>
);

export const LinkIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Base>
);
