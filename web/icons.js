export const iconPaths={
 factory:'<path d="M3 21V9l6 3V7l6 3V3h5v18H3Z"/><path d="M7 17h1m4 0h1m4 0h1M17 6h3"/>',
 report:'<path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9"/><path d="m9 15 1-4 8-8a2.1 2.1 0 0 1 3 3l-8 8-4 1Z"/>',
 records:'<rect x="5" y="4" width="14" height="17" rx="3"/><path d="M9 3h6v4H9zM9 11h6m-6 4h6"/>',
 review:'<path d="m8 12 3 3 5-6"/><rect x="4" y="3" width="16" height="18" rx="3"/>',
 home:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
 stats:'<path d="M4 4v16h17M8 16v-5m5 5V6m5 10v-8"/>',
 inventory:'<path d="m3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4M12 11v10M7.5 5 17 9"/>',
 manage:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
 settings:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="var(--icon-bg,#fff)"/><circle cx="16" cy="12" r="2" fill="var(--icon-bg,#fff)"/><circle cx="8" cy="18" r="2" fill="var(--icon-bg,#fff)"/>',
 wage:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m9 8 3 4 3-4m-6 5h6m-6 3h6m-3-4v5"/>',
 phone:'<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4m-3 14h2"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 checkCircle:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
 alertCircle:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>',
 restart:'<path d="M3 11a9 9 0 1 1 2.6 7M3 4v7h7"/>',
 left:'<path d="m15 5-7 7 7 7"/>',right:'<path d="m9 5 7 7-7 7"/>'
};
export function icon(name,extra=''){return `<svg class="app-icon ${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${iconPaths[name]||iconPaths.records}</svg>`;}
