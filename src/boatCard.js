import { classStanding } from './classMetrics.js';
import { boatColor } from './vesselIcons.js';
import { averageSpeeds } from './speedAverages.js';

const decimal = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

function escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
}

function utcDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) return null;
    const milliseconds = Date.parse(value);
    if (!Number.isFinite(milliseconds)) return null;
    const date = new Date(milliseconds);
    const canonical = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction) =>
        `.${(fraction || '').padEnd(3, '0')}Z`);
    return date.toISOString() === canonical ? date : null;
}

function utcLabel(date) {
    const pad = value => String(value).padStart(2, '0');
    return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()} à ` +
        `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`;
}

function timeHtml(date, missing) {
    return date ? `<time datetime="${date.toISOString()}">${utcLabel(date)}</time>` : missing;
}

function coordinateLabel(value, latitude) {
    if (!Number.isFinite(value) || Math.abs(value) > (latitude ? 90 : 180)) return '—';
    // Arrondir avant de séparer degrés et minutes évite d'afficher 59,9999′ en 60,000′.
    const thousandths = Math.round(Math.abs(value) * 60_000);
    const degrees = String(Math.floor(thousandths / 60_000)).padStart(latitude ? 2 : 3, '0');
    const minutes = ((thousandths % 60_000) / 1000).toFixed(3).padStart(6, '0').replace('.', ',');
    const hemisphere = latitude ? (value < 0 ? 'S' : 'N') : (value < 0 ? 'W' : 'E');
    return `${degrees}°${minutes}′ ${hemisphere}`;
}

/** Carte commune à la fiche latérale et à la vignette Leaflet ; aucun accès au DOM. */
export function boatCardHtml(boat, { fleet = [], colorMode = 'class', referenceTime = Date.now(), history = null } = {}) {
    const selected = boat && typeof boat === 'object' ? boat : {};
    const standing = classStanding(selected, fleet);
    const interpolated = selected.interpolated === true;
    const observation = utcDate(selected.observationTime ?? selected.sourceTime ?? selected.time);
    const position = utcDate(selected.positionTime);
    const reference = typeof referenceTime === 'number' ? referenceTime : Date.parse(referenceTime);
    const stale = observation && Number.isFinite(reference) && reference - observation.getTime() > 2 * 3600_000;
    const name = escape(selected.name || 'Bateau non identifié');
    const skipper = escape(selected.skipper || 'Identité à compléter');
    const className = escape(selected.className || 'Classe non renseignée');
    const accent = escape(boatColor(selected, colorMode));
    const rankText = standing.rank === null ? 'Non communiqué' :
        `${integer.format(standing.rank)}${standing.rank === 1 ? 'er' : 'e'}`;
    const rankHtml = standing.rank === null ? '—' :
        `${integer.format(standing.rank)}<small>${standing.rank === 1 ? 'er' : 'e'}</small>`;
    const count = standing.classSize;
    const countText = count ? `sur ${integer.format(count)} bateau${count > 1 ? 'x' : ''} pointé${count > 1 ? 's' : ''}` :
        'Classe non renseignée';
    const speed = Number.isFinite(selected.speed) && selected.speed >= 0 ?
        `${decimal.format(selected.speed)} <small>nd</small>` : '—';
    const heading = Number.isFinite(selected.heading) && selected.heading >= 0 && selected.heading < 360 ?
        `${integer.format(Math.round(selected.heading) % 360)}<small>°</small>` : '—';
    const averages = averageSpeeds(history, selected);
    const averageRows = averages.map(average => {
        const available = average.speedKnots !== null;
        const reason = average.reason === 'data-gap' ? 'Relevés trop espacés' :
            average.reason === 'invalid-time' ? 'Heure indisponible' : 'Historique insuffisant';
        return `<div class="rhum-card-average" aria-label="Moyenne sur ${average.hours} h">
            <span class="rhum-card-label">${average.hours} h</span>
            <strong>${available ? `${decimal.format(average.speedKnots)} <small>nd</small>` : '—'}</strong>
            ${available ? '' : `<small class="rhum-card-average-reason">${reason}</small>`}
        </div>`;
    }).join('');
    const skew = standing.measurementSkewMinutes;
    const skewNotice = skew !== null && skew > 1 ?
        `<p class="rhum-card-notice">Observations ${interpolated ? 'd’origine ' : ''}non simultanées : ` +
            `${decimal.format(skew)} min d’écart.</p>` : '';
    const distanceToFinish = Number.isFinite(standing.distanceToFinishNm) ?
        `${decimal.format(standing.distanceToFinishNm)} <small>MN</small>` : '—';
    const gap = standing.gapToLeaderNm;
    const gapText = Number.isFinite(gap) ?
        `${gap > 0 ? '+' : ''}${decimal.format(gap)} <small>MN</small>` : '—';
    const leader = standing.leader;
    const leaderDetails = standing.isLeader ? '<strong>Leader de la classe</strong>' :
        leader ? `<span>Leader : ${escape(leader.name || 'Bateau non identifié')}</span>` :
            '<span>Leader indisponible à cet instant</span>';
    const rankNotice = Number.isFinite(gap) && gap < 0 ?
        '<p class="rhum-card-notice">Le rang transmis diffère de l’ordre des distances calculées.</p>' : '';
    return `<article class="rhum-card" style="--rhum-accent:${accent}">
        <div class="rhum-card-top">
            <span class="rhum-card-class">${className}</span>
            ${interpolated ? '<span class="rhum-card-badge">Position interpolée</span>' : ''}
            ${stale ? '<span class="rhum-card-badge rhum-card-notice">Observation ancienne</span>' : ''}
        </div>
        <div class="rhum-card-main">
            <div class="rhum-card-rank" aria-label="Rang transmis : ${escape(rankText)}">
                <strong>${rankHtml}</strong>
                <span class="rhum-card-rank-label">Rang transmis</span>
                <span class="rhum-card-rank-count">${countText}</span>
            </div>
            <div class="rhum-card-identity">
                <h3 class="rhum-card-name">${name}</h3>
                <p class="rhum-card-skipper">${skipper}</p>
                <small>Bateau nº ${escape(selected.id ?? '—')}</small>
            </div>
        </div>
        <dl class="rhum-card-stats">
            <div class="rhum-card-stat"><dt class="rhum-card-label">Vitesse${interpolated ? ' estimée' : ''}</dt><dd class="rhum-card-value">${speed}</dd></div>
            <div class="rhum-card-stat"><dt class="rhum-card-label">Cap${interpolated ? ' estimé' : ''}</dt><dd class="rhum-card-value">${heading}</dd></div>
        </dl>
        <div class="rhum-card-averages" role="group" aria-label="Vitesses moyennes sur la trace">
            <span class="rhum-card-label">Vitesses moyennes</span>
            <div class="rhum-card-average-grid">${averageRows}</div>
            <small class="rhum-card-average-note">Distance sur la trace reçue / durée complète.</small>
        </div>
        <dl class="rhum-card-finish">
            <div class="rhum-card-stat"><dt class="rhum-card-label">Distance à la ligne</dt><dd class="rhum-card-value">${distanceToFinish}</dd></div>
            <div class="rhum-card-stat"><dt class="rhum-card-label">Écart au leader</dt><dd class="rhum-card-value">${gapText}</dd></div>
        </dl>
        <div class="rhum-card-gap">
            ${leaderDetails}
            <small>Distance orthodromique à la ligne, sans les contournements du parcours. Écart calculé, classement transmis conservé.</small>
            ${rankNotice}${skewNotice}
        </div>
        <footer class="rhum-card-meta">
            <span>Observation : ${timeHtml(observation, 'heure inconnue')}</span>
            ${interpolated ? `<span>Position interpolée à ${timeHtml(position, 'une heure inconnue')}</span>` : ''}
            ${stale ? '<span class="rhum-card-notice">Observation de plus de 2 h à cet instant.</span>' : ''}
            <span class="rhum-card-coordinates" aria-label="Coordonnées de la position affichée">${coordinateLabel(selected.lat, true)} · ${coordinateLabel(selected.lon, false)}</span>
        </footer>
    </article>`;
}
