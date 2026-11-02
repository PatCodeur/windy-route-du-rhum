import test from 'node:test';
import assert from 'node:assert/strict';
import { boatCardHtml } from '../src/boatCard.js';

const boat = (id, rank, overrides = {}) => ({ id, rank, name: `Bateau ${id}`, skipper: `Skipper ${id}`,
    className: 'IMOCA', lat: 0, lon: 0, heading: 248.3, speed: 12.35,
    time: '2026-11-02T12:00:00.000Z', ...overrides });
const referenceTime = Date.parse('2026-11-02T12:00:00Z');
const finishLongitude = -(61 + 30.925 / 60);

test('La fiche contient le rang transmis visible, la classe et les valeurs françaises', () => {
    const selected = boat(6, 2, { lat: 18.2, lon: finishLongitude });
    const leader = boat(5, 1, { lat: 17.2, lon: finishLongitude });
    const html = boatCardHtml(selected, { fleet: [leader, selected], referenceTime });
    assert.match(html, /class="rhum-card-rank" aria-label="Rang transmis : 2e"/);
    assert.match(html, /<strong>2<small>e<\/small><\/strong>/);
    assert.match(html, /sur 2 bateaux pointés/);
    assert.match(html, /class="rhum-card-name">Bateau 6/);
    assert.match(html, /12,4 <small>nd<\/small>/);
    assert.match(html, /248<small>°<\/small>/);
    assert.match(html, /Distance à la ligne<\/dt><dd[^>]*>120,1 <small>MN<\/small>/);
    assert.match(html, /Écart au leader<\/dt><dd[^>]*>\+60,0 <small>MN<\/small>/);
    assert.match(html, /Leader : Bateau 5/);
    assert.match(html, /Distance orthodromique à la ligne, sans les contournements du parcours/);
    assert.match(html, /Écart calculé, classement transmis conservé/);
    assert.doesNotMatch(html, /Distance directe au leader|Écart officiel non fourni/);
    assert.match(html, /02\/11\/2026 à 12:00:00 UTC/);
    assert.doesNotMatch(html, /Position interpolée|Observation ancienne|estimé/);
});

test('Le leader a une présentation explicite et le rang 1er', () => {
    const leader = boat(5, 1);
    const html = boatCardHtml(leader, { fleet: [leader], referenceTime });
    assert.match(html, /Rang transmis : 1er/);
    assert.match(html, /<strong>1<small>er<\/small><\/strong>/);
    assert.match(html, /sur 1 bateau pointé/);
    assert.match(html, /Leader de la classe/);
    assert.match(html, /Distance à la ligne/);
    assert.match(html, /Écart au leader<\/dt><dd[^>]*>0,0 <small>MN<\/small>/);
    assert.doesNotMatch(html, /Distance directe au leader|Écart officiel non fourni/);
});

test('L’écart compare les distances à la ligne, sans afficher la séparation entre bateaux', () => {
    const leader = boat(5, 1, { lat: 17.2, lon: finishLongitude });
    const selected = boat(6, 2, { lat: 17.2, lon: finishLongitude + 0.5 });
    const html = boatCardHtml(selected, { fleet: [leader, selected], referenceTime });
    assert.match(html, /Distance à la ligne<\/dt><dd[^>]*>66,5 <small>MN<\/small>/);
    assert.match(html, /Écart au leader<\/dt><dd[^>]*>\+6,5 <small>MN<\/small>/);
    // La distance directe entre ces bateaux est de 28,7 MN, une autre mesure.
    assert.doesNotMatch(html, /28,7 <small>MN<\/small>/);
    assert.doesNotMatch(html, /Le rang transmis diffère/);
});

test('Un écart négatif conserve son signe et explique la différence avec le rang transmis', () => {
    const leader = boat(5, 1, { lat: 17.2, lon: finishLongitude });
    const selected = boat(6, 2, { lat: 16.7, lon: finishLongitude });
    const html = boatCardHtml(selected, { fleet: [leader, selected], referenceTime });
    assert.match(html, /Rang transmis : 2e/);
    assert.match(html, /Distance à la ligne<\/dt><dd[^>]*>30,0 <small>MN<\/small>/);
    assert.match(html, /Écart au leader<\/dt><dd[^>]*>-30,0 <small>MN<\/small>/);
    assert.match(html, /Le rang transmis diffère de l’ordre des distances calculées\./);
});

test('Le rang et le leader se rapportent à la même classe dans la flotte complète', () => {
    const selected = boat(6, 2, { lon: 1 });
    const leader = boat(5, 1, { name: 'Leader IMOCA' });
    const otherLeader = boat(30, 1, { className: 'Class40', name: 'Leader autre classe', lon: 1 });
    const html = boatCardHtml(selected, { fleet: [otherLeader, selected, leader], referenceTime });
    assert.match(html, /sur 2 bateaux pointés/);
    assert.match(html, /Leader : Leader IMOCA/);
    assert.doesNotMatch(html, /Leader autre classe/);
});

test('Tous les textes importés sont échappés, y compris la classe et le leader', () => {
    const className = '<img src=x onerror="alert(1)">';
    const selected = boat(6, 2, { className, name: '<script>alert("bateau")</script>',
        skipper: '<svg onload="alert(2)"> & \'nom\'' });
    const leader = boat(5, 1, { className, name: '<iframe src="javascript:alert(3)">' });
    const html = boatCardHtml(selected, { fleet: [leader, selected], colorMode: '" onmouseover="alert(4)', referenceTime });
    assert.doesNotMatch(html, /<script|<img|<svg|<iframe| onmouseover=/);
    assert.match(html, /&lt;script&gt;alert\(&quot;bateau&quot;\)&lt;\/script&gt;/);
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
    assert.match(html, /&amp; &#39;nom&#39;/);
    assert.match(html, /Leader : &lt;iframe src=&quot;javascript:alert\(3\)&quot;&gt;/);
    assert.match(html, /style="--rhum-accent:#cbd5e1"/);
});

test('La position interpolée et les estimations restent distinctes du rang et de l’observation', () => {
    const leader = boat(5, 1);
    const selected = boat(6, 2, { interpolated: true, positionTime: '2026-11-02T12:15:00Z',
        time: '2026-11-02T11:45:00Z' });
    const html = boatCardHtml(selected, { fleet: [leader, selected], referenceTime });
    assert.match(html, /Position interpolée/);
    assert.match(html, /Vitesse estimée/);
    assert.match(html, /Cap estimé/);
    assert.match(html, /Rang transmis : 2e/);
    assert.match(html, /Observation : <time[^>]*>02\/11\/2026 à 11:45:00 UTC/);
    assert.match(html, /Position interpolée à <time[^>]*>02\/11\/2026 à 12:15:00 UTC/);
    assert.match(html, /Observations d’origine non simultanées : 15,0 min d’écart/);
});

test('Le décalage des observations apparaît au-delà d’une minute, sans inventer de retard', () => {
    const leader = boat(5, 1);
    const selected = boat(6, 2, { time: '2026-11-02T11:58:30Z' });
    const html = boatCardHtml(selected, { fleet: [leader, selected], referenceTime });
    assert.match(html, /Observations non simultanées : 1,5 min d’écart/);
    assert.doesNotMatch(html, /retard|retard estimé|à l’arrivée/i);
    const simultaneous = boatCardHtml({ ...selected, time: '2026-11-02T11:59:00Z' },
        { fleet: [leader, selected], referenceTime });
    assert.doesNotMatch(simultaneous, /non simultanées/);
});

test('Une observation ancienne est signalée selon l’instant de référence, y compris en rejeu', () => {
    const selected = boat(6, 2, { time: '2026-11-02T09:59:59Z', interpolated: true,
        positionTime: '2026-11-02T12:00:00Z' });
    const html = boatCardHtml(selected, { referenceTime });
    assert.match(html, /Observation ancienne/);
    assert.match(html, /Observation de plus de 2 h à cet instant/);
    assert.doesNotMatch(boatCardHtml(selected, { referenceTime: Date.parse('2026-11-02T11:59:59Z') }),
        /Observation ancienne/);
    assert.doesNotMatch(boatCardHtml(selected, { referenceTime: Date.parse('2026-11-02T09:00:00Z') }),
        /Observation ancienne/);
});

test('Leader absent ou ambigu : la fiche reste disponible sans écart inventé', () => {
    const selected = boat(6, 2, { lat: 17.2, lon: finishLongitude });
    for (const fleet of [[selected], [selected, boat(5, 1), boat(7, 1)]]) {
        const html = boatCardHtml(selected, { fleet, referenceTime });
        assert.match(html, /Leader indisponible à cet instant/);
        assert.match(html, /Distance à la ligne<\/dt><dd[^>]*>60,0 <small>MN<\/small>/);
        assert.match(html, /Écart au leader<\/dt><dd[^>]*>—<\/dd>/);
        assert.doesNotMatch(html, /Le rang transmis diffère/);
    }
});

test('Une position invalide laisse les distances indisponibles sans masquer le leader', () => {
    const leader = boat(5, 1, { lat: 17.2, lon: finishLongitude });
    const selected = boat(6, 2, { lat: null, lon: finishLongitude });
    const html = boatCardHtml(selected, { fleet: [leader, selected], referenceTime });
    assert.match(html, /Distance à la ligne<\/dt><dd[^>]*>—<\/dd>/);
    assert.match(html, /Écart au leader<\/dt><dd[^>]*>—<\/dd>/);
    assert.match(html, /Leader : Bateau 5/);
    assert.doesNotMatch(html, /NaN|undefined/);
});

test('Des données incomplètes n’affichent ni NaN, ni date invalide, ni chaîne exécutable', () => {
    const selected = boat(6, null, { id: '<img src=x>', heading: Infinity, speed: '<svg>',
        time: '2026-02-30T12:00:00Z' });
    const html = boatCardHtml(selected, { referenceTime });
    assert.match(html, /Rang transmis : Non communiqué/);
    assert.match(html, /Observation : heure inconnue/);
    assert.match(html, /Bateau nº &lt;img src=x&gt;/);
    assert.doesNotMatch(html, /NaN|Invalid Date|<img|<svg/);
    assert.doesNotThrow(() => boatCardHtml(null));
});

test('L’accent suit le mode choisi et l’arrondi du cap reste entre 0 et 359°', () => {
    const selected = boat(6, 2, { heading: 359.7 });
    const byClass = boatCardHtml(selected, { referenceTime });
    const byBoat = boatCardHtml(selected, { colorMode: 'boat', referenceTime });
    assert.match(byClass, /style="--rhum-accent:#75b5ff"/);
    assert.match(byBoat, /style="--rhum-accent:hsl\(105, 85%, 67%\)"/);
    assert.match(byClass, /0<small>°<\/small>/);
});

test('Les moyennes affichées utilisent la trace et signalent les fenêtres non couvertes', async () => {
    const { buildHistory } = await import('../src/history.js');
    const start = Date.parse('2026-11-02T08:00:00Z');
    const points = Array.from({ length: 5 }, (_, hour) => boat(6, 2, {
        lon: hour / 10, time: new Date(start + hour * 3600000).toISOString(), speed: 25
    }));
    const history = buildHistory(points.map(point => [point]));
    const html = boatCardHtml(points.at(-1), { fleet: [points.at(-1)], referenceTime, history });
    assert.match(html, /Vitesses moyennes/);
    assert.match(html, /Moyenne sur 4 h/);
    assert.match(html, /Moyenne sur 24 h/);
    assert.match(html, /Moyenne sur 48 h/);
    assert.match(html, /6,0 <small>nd<\/small>/);
    assert.equal((html.match(/Historique insuffisant/g) || []).length, 2);
    // La vitesse instantanée de 25 nd ne devient pas la moyenne de la trace.
    assert.match(html, /25,0 <small>nd<\/small>/);
});

test('La fiche calcule ses moyennes à son propre pointage pendant le rejeu', async () => {
    const { buildHistory } = await import('../src/history.js');
    const start = Date.parse('2026-10-31T12:00:00Z');
    const points = Array.from({ length: 49 }, (_, hour) => boat(6, 2, {
        lon: hour / 10, time: new Date(start + hour * 3600000).toISOString()
    }));
    const history = buildHistory(points.map(point => [point]));
    const latest = boatCardHtml(points.at(-1), { fleet: [points.at(-1)], referenceTime, history });
    assert.equal((latest.match(/6,0 <small>nd<\/small>/g) || []).length, 3);
    assert.doesNotMatch(latest, /Historique insuffisant/);
    const replay = boatCardHtml(points[4], { fleet: [points[4]], referenceTime, history });
    assert.equal((replay.match(/Historique insuffisant/g) || []).length, 2);
});

test('Distance et écart suivent la flotte du rejeu, y compris les positions interpolées', async () => {
    const { buildHistory } = await import('../src/history.js');
    const { sampleFleet } = await import('../src/timeNavigation.js');
    const first = [boat(5, 1, { lat: 17.2, lon: finishLongitude }),
        boat(6, 2, { lat: 18.2, lon: finishLongitude })];
    const last = [boat(5, 1, { lat: 16.7, lon: finishLongitude, time: '2026-11-02T13:00:00Z' }),
        boat(6, 2, { lat: 17.2, lon: finishLongitude, time: '2026-11-02T13:00:00Z' })];
    const history = buildHistory([first, last]);
    const render = iso => {
        const fleet = sampleFleet(history, Date.parse(iso));
        return boatCardHtml(fleet.find(candidate => candidate.id === 6), {
            fleet, history, referenceTime: Date.parse(iso),
        });
    };
    const early = render('2026-11-02T12:00:00Z');
    assert.match(early, /Distance à la ligne<\/dt><dd[^>]*>120,1 <small>MN<\/small>/);
    assert.match(early, /Écart au leader<\/dt><dd[^>]*>\+60,0 <small>MN<\/small>/);
    const latest = render('2026-11-02T13:00:00Z');
    assert.match(latest, /Distance à la ligne<\/dt><dd[^>]*>60,0 <small>MN<\/small>/);
    assert.match(latest, /Écart au leader<\/dt><dd[^>]*>\+30,0 <small>MN<\/small>/);
    const middle = render('2026-11-02T12:30:00Z');
    assert.match(middle, /Position interpolée/);
    assert.match(middle, /Distance à la ligne<\/dt><dd[^>]*>90,1 <small>MN<\/small>/);
    assert.match(middle, /Écart au leader<\/dt><dd[^>]*>\+45,0 <small>MN<\/small>/);
});
