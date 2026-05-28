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
      <path
        d="M21 13 L21 51 L30 42 L37 58 L44 55 L37 39 L50 39 L21 13 Z"
        fill="#fff"
        stroke="#0a0a0a"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
