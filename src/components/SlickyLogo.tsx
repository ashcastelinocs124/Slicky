/** Inline logo — always renders (no /public fetch needed in Tauri). */
export function SlickyLogo({
  size = 20,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <rect width="64" height="64" rx="14" fill="#0a0a0a" />
      <rect
        x="14"
        y="18"
        width="30"
        height="24"
        rx="2"
        stroke="#fff"
        strokeOpacity="0.9"
        strokeWidth="2"
        strokeDasharray="5 4"
        fill="none"
      />
      <circle cx="14" cy="18" r="2.5" fill="#fff" />
      <circle cx="44" cy="18" r="2.5" fill="#fff" />
      <circle cx="44" cy="42" r="2.5" fill="#fff" />
      <circle cx="14" cy="42" r="2.5" fill="#fff" />
      <path
        d="M26 24 L26 44 L31 39 L35 50 L39 48 L35 37 L43 37 L26 24 Z"
        fill="#fff"
        stroke="#0a0a0a"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
