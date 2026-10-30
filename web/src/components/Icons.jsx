/** Iconos de linea, trazo 1.6, caja 24. Uno por concepto, sin decoracion. */
const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export const Icon = {
  cart: (p) => (
    <svg {...base} {...p}>
      <path d="M3 4h2l2.2 10.4a2 2 0 0 0 2 1.6h7.5a2 2 0 0 0 2-1.5L20.5 7H6" />
      <circle cx="9.5" cy="20" r="1.3" />
      <circle cx="17.5" cy="20" r="1.3" />
    </svg>
  ),
  tables: (p) => (
    <svg {...base} {...p}>
      <circle cx="12" cy="10" r="5" />
      <path d="M12 15v6M8 21h8" />
    </svg>
  ),
  box: (p) => (
    <svg {...base} {...p}>
      <path d="M3 8l9-4 9 4v8l-9 4-9-4z" />
      <path d="M3 8l9 4 9-4M12 12v8" />
    </svg>
  ),
  chart: (p) => (
    <svg {...base} {...p}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  ),
  gear: (p) => (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </svg>
  ),
  sun: (p) => (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  crown: (p) => (
    <svg {...base} {...p}>
      <path d="M3 7l4 4 5-7 5 7 4-4-2 12H5z" />
    </svg>
  ),
  glass: (p) => (
    <svg {...base} {...p}>
      <path d="M4 4h16l-8 8zM12 12v7M8 19h8" />
    </svg>
  ),
  plus: (p) => (
    <svg {...base} {...p}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  trash: (p) => (
    <svg {...base} {...p}>
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    </svg>
  ),
  wall: (p) => (
    <svg {...base} {...p}>
      <path d="M3 6h18M3 12h18M3 18h18M9 6v6M15 12v6M9 18v-6" />
    </svg>
  ),
  door: (p) => (
    <svg {...base} {...p}>
      <path d="M6 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17M4 21h16M13 12h.01" />
    </svg>
  ),
  stage: (p) => (
    <svg {...base} {...p}>
      <path d="M3 10h18v4H3zM6 14v6M18 14v6M12 10V4M9 4h6" />
    </svg>
  ),
  undo: (p) => (
    <svg {...base} {...p}>
      <path d="M4 10h11a5 5 0 0 1 0 10h-2M4 10l5-5M4 10l5 5" />
    </svg>
  ),
  cash: (p) => (
    <svg {...base} {...p}>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M3 9h1M20 9h1M3 15h1M20 15h1" />
    </svg>
  ),
  users: (p) => (
    <svg {...base} {...p}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 8.5a2.5 2.5 0 1 0 0-5M19 14.5c1.8.5 3 2 3 5.5" />
    </svg>
  ),
  exit: (p) => (
    <svg {...base} {...p}>
      <path d="M10 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5M16 17l5-5-5-5M21 12H9" />
    </svg>
  ),
  search: (p) => (
    <svg {...base} {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  ),
  x: (p) => (
    <svg {...base} {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  drop: (p) => (
    <svg {...base} {...p}>
      <path d="M12 3c3.5 4 6 7.2 6 10.2a6 6 0 1 1-12 0C6 10.2 8.5 7 12 3z" />
    </svg>
  ),
  copy: (p) => (
    <svg {...base} {...p}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  ),
  clipboard: (p) => (
    <svg {...base} {...p}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M9 12h6M9 16h6" />
    </svg>
  ),
  printer: (p) => (
    <svg {...base} {...p}>
      <path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2" />
      <rect x="6" y="14" width="12" height="7" />
    </svg>
  ),
  phone: (p) => (
    <svg {...base} {...p}>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </svg>
  ),
  bank: (p) => (
    <svg {...base} {...p}>
      <path d="M4 10h16M5 10l7-6 7 6M5 10v9M19 10v9M9 10v9M15 10v9M3 21h18" />
    </svg>
  ),
  card: (p) => (
    <svg {...base} {...p}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M6 15h5" />
    </svg>
  ),
  alert: (p) => (
    <svg {...base} {...p}>
      <path d="M12 3L2 20h20L12 3z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  ),
  chevronLeft: (p) => (
    <svg {...base} {...p}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  ),
  chevronDown: (p) => (
    <svg {...base} {...p}>
      <path d="M5 9l7 7 7-7" />
    </svg>
  ),
  truck: (p) => (
    <svg {...base} {...p}>
      <path d="M3 7h11v9H3zM14 11h4l3 3v2h-7z" />
      <circle cx="7" cy="18.5" r="1.6" />
      <circle cx="17" cy="18.5" r="1.6" />
    </svg>
  ),
  gift: (p) => (
    <svg {...base} {...p}>
      <rect x="4" y="9" width="16" height="11" rx="1" />
      <path d="M4 13h16M12 9v11M12 9c-1.5-3-4-4-5-2.5S8.5 9 12 9zM12 9c1.5-3 4-4 5-2.5S15.5 9 12 9z" />
    </svg>
  ),
  tag: (p) => (
    <svg {...base} {...p}>
      <path d="M12.6 3.3 20 3v7.4a2 2 0 0 1-.6 1.4l-8 8a2 2 0 0 1-2.8 0l-6-6a2 2 0 0 1 0-2.8l8-8a2 2 0 0 1 1.4-.6z" />
      <circle cx="15.5" cy="7.5" r="1.4" />
    </svg>
  ),
  send: (p) => (
    <svg {...base} {...p}>
      <path d="M21 3 11 13" />
      <path d="M21 3 14 21l-3-8-8-3 18-7z" />
    </svg>
  ),
  receipt: (p) => (
    <svg {...base} {...p}>
      <path d="M6 2h12v19l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5z" />
      <path d="M9 7h6M9 11h6M9 15h3" />
    </svg>
  ),
  bell: (p) => (
    <svg {...base} {...p}>
      <path d="M6 9a6 6 0 1 1 12 0c0 3.2 1 5 2 6.5H4c1-1.5 2-3.3 2-6.5z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  ),
  percent: (p) => (
    <svg {...base} {...p}>
      <path d="M19 5L5 19" />
      <circle cx="7" cy="7" r="2.3" />
      <circle cx="17" cy="17" r="2.3" />
    </svg>
  ),
  download: (p) => (
    <svg {...base} {...p}>
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  ),
  sort: (p) => (
    <svg {...base} {...p}>
      <path d="M8 5v14M8 5l-3 3M8 5l3 3M16 19V5M16 19l-3-3M16 19l3-3" />
    </svg>
  ),
  calendar: (p) => (
    <svg {...base} {...p}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  ),
  lShape: (p) => (
    <svg {...base} {...p}>
      <path d="M6 4v14h14" />
    </svg>
  ),
  trendArrow: (p) => (
    <svg {...base} {...p}>
      <path d="M4 17l6-6 4 4 6-8" />
      <path d="M14 7h6v6" />
    </svg>
  ),
  filter: (p) => (
    <svg {...base} {...p}>
      <path d="M4 5h16M7 12h10M10.5 19h3" />
    </svg>
  ),
  link: (p) => (
    <svg {...base} {...p}>
      <path d="M10 14a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5l-1 1" />
      <path d="M14 10a3.5 3.5 0 0 0-5 0l-2 2a3.5 3.5 0 0 0 5 5l1-1" />
    </svg>
  ),
  lock: (p) => (
    <svg {...base} {...p}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  ),
  check: (p) => (
    <svg {...base} {...p}>
      <path d="M5 13l4.5 4.5L19 8" />
    </svg>
  ),
  clock: (p) => (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.2 2" />
    </svg>
  ),
}

export const zoneIcon = { table: Icon.tables, sun: Icon.sun, crown: Icon.crown, glass: Icon.glass }
