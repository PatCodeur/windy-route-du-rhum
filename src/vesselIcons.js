/** Silhouettes originales vues du dessus. La proue est au nord pour un cap de 0°. */
export const CLASS_STYLES = Object.freeze({
    'Ultim': Object.freeze({ color: '#ff7848', label: 'Ultim', kind: 'trimaran' }),
    'Ocean Fifty': Object.freeze({ color: '#30d4d2', label: 'Ocean Fifty', kind: 'trimaran' }),
    'IMOCA': Object.freeze({ color: '#75b5ff', label: 'IMOCA', kind: 'monohull' }),
    'Class40': Object.freeze({ color: '#ffd45c', label: 'Class40', kind: 'monohull' }),
    'Vintage Multi': Object.freeze({ color: '#cd94ff', label: 'Vintage Multi', kind: 'multihull' }),
    'Vintage Mono': Object.freeze({ color: '#a0e16b', label: 'Vintage Mono', kind: 'monohull' }),
    'Non renseignée': Object.freeze({ color: '#cbd5e1', label: 'Non renseignée', kind: 'monohull' })
});

const DARK = '#172b42';
const LIGHT = '#f8fcff';

function styleFor(boat) {
    return Object.hasOwn(CLASS_STYLES, boat?.className)
        ? CLASS_STYLES[boat.className] : CLASS_STYLES['Non renseignée'];
}

/** Même ID = même couleur, quels que soient l’ordre des fichiers et les filtres. */
export function boatColor(boat, mode = 'class') {
    if (mode !== 'boat' || !Number.isSafeInteger(boat?.id) || boat.id <= 0) return styleFor(boat).color;
    // La progression par angle d’or sépare les identifiants voisins.
    const hue = Math.round(((boat.id % 36000) * 137.508) % 360);
    return `hsl(${hue}, 85%, 67%)`;
}

function hull(path, color, width = 1.35) {
    return `<path d="${path}" fill="${color}" stroke="${DARK}" stroke-width="${width}" stroke-linejoin="round"/>`;
}

function trimaran(color) {
    const beam = '<path d="M7 16.7Q20 12.8 33 16.7M7 25Q20 22.2 33 25" fill="none" stroke="' + DARK + '" stroke-width="2.8" stroke-linecap="round"/><path d="M7 16.7Q20 12.8 33 16.7M7 25Q20 22.2 33 25" fill="none" stroke="' + LIGHT + '" stroke-width="1"/>';
    return beam +
        hull('M6.8 7.1C3.4 11.4 3.9 24.4 5.4 30.4Q6.8 31.6 8.2 30.4C9.6 24.4 10.1 11.4 6.8 7.1Z', color) +
        hull('M33.2 7.1C29.9 11.4 30.4 24.4 31.8 30.4Q33.2 31.6 34.6 30.4C36.1 24.4 36.6 11.4 33.2 7.1Z', color) +
        hull('M20 2.5C15.4 8.3 14.3 21.7 16.8 35.4Q20 37.2 23.2 35.4C25.7 21.7 24.6 8.3 20 2.5Z', color, 1.5) +
        '<path d="M20 8.2C18.1 13.3 17.9 20 18.3 24.2L21.7 24.2C22.1 20 21.9 13.3 20 8.2Z" fill="' + LIGHT + '" opacity=".92"/><rect x="18" y="25.8" width="4" height="6.2" rx="1.4" fill="' + DARK + '"/><path d="M20 7.6V23" stroke="' + DARK + '" stroke-width=".85"/>';
}

function multihull(color) {
    // Symbole multicoque générique : les données ne décrivent pas chaque carène vintage.
    return '<path d="M9.3 15H30.7M9.3 27H30.7" stroke="' + DARK + '" stroke-width="3.8"/><path d="M9.3 15H30.7M9.3 27H30.7" stroke="' + LIGHT + '" stroke-width="1.4"/>' +
        hull('M9.3 3.5C4.5 9.3 4.9 24.7 6.7 35.1Q9.3 36.2 11.9 35.1C13.7 24.7 14.1 9.3 9.3 3.5Z', color) +
        hull('M30.7 3.5C25.9 9.3 26.3 24.7 28.1 35.1Q30.7 36.2 33.3 35.1C35.1 24.7 35.5 9.3 30.7 3.5Z', color) +
        '<path d="M15.5 15H24.5V26H15.5Z" fill="' + color + '" stroke="' + DARK + '" stroke-width="1.2"/><path d="M9.3 10V27M30.7 10V27" stroke="' + LIGHT + '" stroke-width="1.6"/><path d="M20 11.5V23" stroke="' + DARK + '" stroke-width="1.1"/>';
}

function monohull(color, foils) {
    const appendages = foils
        ? '<path d="M13 18.8L5 21.5L3 26M27 18.8L35 21.5L37 26" fill="none" stroke="' + DARK + '" stroke-width="3.4" stroke-linecap="round"/><path d="M13 18.8L5 21.5L3 26M27 18.8L35 21.5L37 26" fill="none" stroke="' + color + '" stroke-width="1.65" stroke-linecap="round"/>'
        : '';
    return appendages + hull('M20 2.5C11.9 9.1 10.4 24.7 13.4 35.4Q20 37.1 26.6 35.4C29.6 24.7 28.1 9.1 20 2.5Z', color, 1.5) +
        '<path d="M20 8.6C16.8 13.3 15.7 18.7 16.1 24.8H23.9C24.3 18.7 23.2 13.3 20 8.6Z" fill="' + LIGHT + '" opacity=".94"/><rect x="16.1" y="26.1" width="7.8" height="6" rx="1.9" fill="' + DARK + '"/><path d="M20 7.6V23.9" stroke="' + DARK + '" stroke-width="1.05"/><path d="M14.6 34H25.4" stroke="' + LIGHT + '" stroke-width="1.05"/>';
}

/** HTML sûr : aucune chaîne importée n’est injectée dans le SVG. */
export function boatIconHtml(boat, { selected = false, stale = false, colorMode = 'class' } = {}) {
    const style = styleFor(boat);
    const color = boatColor(boat, colorMode);
    const heading = typeof boat?.heading === 'number' && Number.isFinite(boat.heading)
        ? ((boat.heading % 360) + 360) % 360 : 0;
    const body = style.kind === 'trimaran' ? trimaran(color)
        : style.kind === 'multihull' ? multihull(color) : monohull(color, boat?.className === 'IMOCA');
    const halo = selected
        ? `<circle cx="20" cy="20" r="20" fill="rgba(255,255,255,.18)" stroke="${LIGHT}" stroke-width="3.5"/><circle cx="20" cy="20" r="20" fill="none" stroke="${color}" stroke-width="1.8"/>`
        : '';
    return `<span style="display:block;width:36px;height:40px;overflow:visible;opacity:${stale ? 0.5 : 1}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="36" height="40" style="overflow:visible" aria-hidden="true">${halo}<g transform="rotate(${heading} 20 20)">${body}</g></svg></span>`;
}
