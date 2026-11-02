/** CARTO basemap URLs. Vite embeds this public browser key at build time. */
export function cartoTileUrl(style = 'dark_nolabels') {
  const key = (import.meta.env.VITE_CARTO_API_KEY || '').trim();
  const url = `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`;
  return key ? `${url}?key=${encodeURIComponent(key)}` : url;
}
