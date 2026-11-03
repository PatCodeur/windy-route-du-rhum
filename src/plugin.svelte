<script>
    import { onMount, onDestroy } from 'svelte';
    import bcast from '@windy/broadcast';
    import { map } from '@windy/map';
    import store from '@windy/store';
    import identities from './identities.js';
    import historySnapshot from './historySnapshot.js';
    import runtimeConfig from './runtimeConfig.js';
    import { stats } from './data.js';
    import { parseFeed } from './liveFeed.js';
    import { buildHistory, mergeHistory } from './history.js';
    import { timelineState, sampleFleet, traceAtTime } from './timeNavigation.js';
    import { createWeatherLink } from './weatherLink.js';
    import { createMapLayers } from './mapLayers.js';
    import { createFinishLayers } from './finishLayers.js';
    import { boatCardHtml } from './boatCard.js';
    import { classStanding } from './classMetrics.js';
    import { FINISH_LINE } from './finishLine.js';
    import { CLASS_STYLES, boatColor, boatIconHtml } from './vesselIcons.js';

    const publicMode = runtimeConfig.publicMode === true;
    let history = buildHistory(publicMode ? [] : historySnapshot);
    let activeTimestamp = history.newest ? Date.parse(history.newest) : Date.now();
    let syncWeather = true;
    let weatherTimestamp = null;
    let weatherNotice = '';
    let weatherLink;
    let mapLayers;
    let finishLayers;
    let finishNotice = '';
    let mapNotice = '';
    let selectedClass = '';
    let query = '';
    let selectedId = null;
    let traceMode = 'all';
    let colorMode = 'class';
    let playing = false;
    let pace = 1000;
    let source = publicMode ? 'Positions en cours de chargement' : `${historySnapshot.length} relevés fournis — historique intégré`;
    let error = '';
    let apiUrl = publicMode ? runtimeConfig.feedUrl : runtimeConfig.localFeedUrl || '';
    let liveUrl = publicMode ? runtimeConfig.feedUrl.trim() : '';
    let fetchedAt = '';
    let lastAttemptAt = 0;
    let relayRetrievedAt = '';
    let now = Date.now();
    let busy = false;
    let mounted = false;
    let dead = false;
    let timer;
    let playbackTimer;
    let controller;
    let revision = 0;
    const formatDate = value => value != null && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString('fr-FR', {
        timeZone: 'UTC', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    }) + ' UTC' : '—';
    const oldPosition = (boat, reference) => reference - Date.parse(boat.time) > 2 * 3600_000;
    const fold = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const nautical = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const distanceLabel = value => Number.isFinite(value) ? `${nautical.format(value)} MN` : '—';
    const gapLabel = value => Number.isFinite(value) ?
        `${value >= 0.05 ? '+' : ''}${nautical.format(Math.abs(value) < 0.05 ? 0 : value)} MN` : '—';
    const rankLabel = rank => Number.isSafeInteger(rank) && rank > 0 ? `${rank}${rank === 1 ? 'er' : 'e'}` : '—';
    function compareRanks(first, second) {
        if (first === 0) return second === 0 ? 0 : 1;
        if (second === 0) return -1;
        return first - second;
    }
    $: navigation = timelineState(history, activeTimestamp);
    $: cursorTime = navigation.time;
    $: cursorIndex = Math.max(0, navigation.index);
    $: atLatest = history.times.length > 0 && Date.parse(cursorTime) >= Date.parse(history.newest);
    $: referenceTime = syncWeather ? activeTimestamp : atLatest || !cursorTime ? now : Date.parse(cursorTime);
    $: boats = cursorTime ? sampleFleet(history, Date.parse(cursorTime), { interpolate: syncWeather }) : [];
    // La recherche peut masquer le leader : les calculs conservent toute sa classe.
    $: standings = new Map(boats.map(boat => [boat.id, classStanding(boat, boats)]));
    $: classes = [...new Set(Object.values(history.tracks).map(track => track[track.length - 1].className))].sort();
    $: fleetStats = stats(boats);
    $: filtered = boats.filter(boat => (!selectedClass || boat.className === selectedClass) &&
        fold(`${boat.id} ${boat.name} ${boat.skipper}`).includes(fold(query.trim())))
        .sort((a, b) => a.className.localeCompare(b.className) || compareRanks(a.rank, b.rank) || a.id - b.id);
    $: selectedBoat = boats.find(boat => boat.id === selectedId);
    $: if (mounted) draw(history, filtered, boats, selectedId, cursorTime, traceMode, colorMode, referenceTime, syncWeather);

    function showBoat(boat) {
        // Ouvrir sans déplacer la carte : le déplacement pouvait fermer la vignette.
        mapLayers?.openBoat(boat.id);
    }
    function dismissSelection() {
        mapLayers?.closePopup();
        selectedId = null;
    }
    function draw(archive, list, fullFleet, selected, time, traces, coloring, reference, interpolate) {
        try {
            mapLayers.update({
                boats: list, selectedId: selected, traceMode: traces,
                iconFor: (boat, isSelected) => new L.DivIcon({
                    html: boatIconHtml(boat, { selected: isSelected, stale: oldPosition(boat, reference), colorMode: coloring }),
                    className: 'rhum-boat-icon', iconSize: [36, 40], iconAnchor: [18, 20]
                }),
                popupFor: boat => {
                    const content = document.createElement('div');
                    // boatCardHtml échappe toutes les données importées ; même carte dans le panneau.
                    content.innerHTML = boatCardHtml(boat, { fleet: fullFleet, colorMode: coloring, referenceTime: reference, history: archive });
                    return content;
                },
                traceFor: boat => traceAtTime(archive, boat.id, Date.parse(time), { interpolate }).map(point => [point.lat, point.lon]),
                lineStyleFor: (boat, isSelected) => ({
                    color: boatColor(boat, coloring), weight: isSelected ? 3.4 : 1.5,
                    opacity: isSelected || traces === 'selected' ? 0.95 : 0.42
                })
            });
            mapNotice = '';
        } catch (cause) {
            mapNotice = `Affichage des bateaux impossible : ${cause?.message || 'erreur de la carte'}. Rechargez le plugin pour réessayer.`;
            console.error('Route du Rhum : affichage de la flotte', cause);
        }
    }
    function centerFleet() {
        if (!filtered.length) return;
        map.fitBounds(filtered.map(boat => [boat.lat, boat.lon]), { padding: [45, 45], maxZoom: 9 });
    }
    function centerTracks() {
        const points = filtered.flatMap(boat => traceMode === 'selected' && boat.id !== selectedId ? [] :
            traceAtTime(history, boat.id, Date.parse(cursorTime), { interpolate: syncWeather }).map(point => [point.lat, point.lon]));
        if (points.length) map.fitBounds(points, { padding: [45, 45], maxZoom: 9 });
    }
    function centerFinish() {
        map.fitBounds([[FINISH_LINE.east.lat, FINISH_LINE.east.lon],
            [FINISH_LINE.west.lat, FINISH_LINE.west.lon]], { padding: [70, 70], maxZoom: 15 });
    }
    function pause() {
        clearInterval(playbackTimer);
        playbackTimer = undefined;
        playing = false;
    }
    function play() {
        if (playing) { pause(); return; }
        if (history.times.length < 2) return;
        // Un index propre à la lecture évite de répéter une étape si Windy
        // arrondit son heure quelques secondes avant le repère reçu.
        let playbackIndex = atLatest ? 0 : timelineState(history, activeTimestamp).index;
        if (atLatest) setRaceTime(Date.parse(history.times[0]));
        playing = true;
        playbackTimer = setInterval(() => {
            const next = Math.min(history.times.length - 1, Math.max(0, playbackIndex + 1));
            playbackIndex = next;
            setRaceTime(Date.parse(history.times[next]));
            if (next === history.times.length - 1) pause();
        }, Number(pace));
    }
    function seek(index) {
        pause();
        if (!history.times.length || !Number.isFinite(Number(index))) return;
        const bounded = Math.max(0, Math.min(history.times.length - 1, Number(index)));
        setRaceTime(Date.parse(history.times[bounded]));
    }
    function setRaceTime(timestamp) {
        if (!history.times.length || !Number.isFinite(timestamp)) return;
        activeTimestamp = timestamp;
        weatherNotice = '';
        if (syncWeather) void weatherLink?.push(timestamp);
    }
    function changeSync(event) {
        pause();
        syncWeather = event.currentTarget.checked;
        weatherNotice = '';
        if (syncWeather && Number.isFinite(weatherTimestamp)) activeTimestamp = weatherTimestamp;
    }
    function receiveWeatherTime(timestamp, { programmatic }) {
        weatherTimestamp = timestamp;
        if (!syncWeather) return;
        if (!programmatic) {
            pause();
            weatherNotice = '';
        }
        activeTimestamp = timestamp;
    }
    function addFleets(fleets, label, followNewest = true) {
        const previousTime = activeTimestamp;
        const nextHistory = mergeHistory(history, fleets);
        if (!nextHistory.times.length) throw new Error('Aucune position dans les relevés.');
        history = nextHistory;
        if (followNewest) setRaceTime(Date.parse(history.newest));
        else activeTimestamp = previousTime;
        if (selectedClass && !Object.values(history.tracks).some(track => track.some(boat => boat.className === selectedClass))) selectedClass = '';
        source = label;
        error = '';
        now = Date.now();
    }
    async function readFiles(event) {
        const input = event.currentTarget;
        const files = [...(input.files || [])];
        if (!files.length) return;
        const turn = ++revision;
        controller?.abort();
        busy = true;
        try {
            const fleets = (await Promise.all(files.map(async file => {
                const bytes = await file.arrayBuffer();
                let text;
                try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
                catch { text = new TextDecoder('windows-1252').decode(bytes); }
                try { return parseFeed(text, identities); }
                catch (cause) { throw new Error(`${file.name} : ${cause.message}`); }
            }))).flat();
            if (dead || turn !== revision) return;
            fleets.sort((a, b) => stats(a).newest.localeCompare(stats(b).newest));
            pause();
            addFleets(fleets, `${files.length} fichier(s) importé(s) — historique enrichi`);
            liveUrl = '';
            fetchedAt = '';
            relayRetrievedAt = '';
        } catch (cause) {
            if (!dead && turn === revision) error = `Import refusé : ${cause.message}. L’historique précédent reste affiché.`;
        } finally {
            if (!dead && turn === revision) busy = false;
            input.value = '';
        }
    }
    async function loadUrl(url, automatic = false) {
        if (busy) return;
        const turn = ++revision;
        busy = true;
        lastAttemptAt = Date.now();
        const activeController = new AbortController();
        controller = activeController;
        const timeout = setTimeout(() => activeController.abort(), 20000);
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Saisir une URL HTTPS sans identifiants');
            const response = await fetch(parsed.href, { signal: activeController.signal, cache: publicMode ? 'no-cache' : 'no-store', credentials: 'omit' });
            if (!response.ok) throw new Error(`Réponse du serveur : ${response.status}`);
            const text = await response.text();
            const fleets = parseFeed(text, identities);
            let retrieved = '';
            if (/^\s*\{/.test(text)) {
                const metadata = JSON.parse(text);
                if (metadata.type === 'RhumHistory' && typeof metadata.retrievedAt === 'string' && Number.isFinite(Date.parse(metadata.retrievedAt))) retrieved = metadata.retrievedAt;
            }
            if (dead || turn !== revision) return;
            if (automatic && Date.parse(stats(fleets.flat()).newest) < Date.parse(history.newest)) {
                throw new Error('Le serveur a renvoyé un historique antérieur');
            }
            // Suivre les nouveaux relevés si le dernier point était sélectionné.
            // Une heure météo future et un instant de rejeu restent sélectionnés.
            const followingLatest = atLatest && !playing && (!syncWeather || activeTimestamp <= Date.parse(history.newest));
            const followNewest = !history.times.length || !automatic || followingLatest;
            if (!automatic) pause();
            addFleets(fleets, publicMode ? 'Positions de course — vérification toutes les 5 min' : 'Flux HTTPS — actualisation toutes les 5 min', followNewest);
            liveUrl = parsed.href;
            fetchedAt = new Date().toISOString();
            relayRetrievedAt = retrieved;
        } catch (cause) {
            if (!dead && turn === revision) error = publicMode ?
                `Les positions ne sont pas disponibles pour le moment.${history.times.length ? ' Le dernier relevé reçu reste affiché.' : ''} Nouvelle tentative automatique dans cinq minutes.` :
                `Actualisation impossible : ${cause.message}. L’historique précédent reste affiché.`;
        } finally {
            clearTimeout(timeout);
            if (!dead && turn === revision) busy = false;
        }
    }
    onMount(() => {
        try {
            mapLayers = createMapLayers({ map, L, onSelect: boat => { selectedId = boat.id; } });
            // La flotte est affichée avant toute couche d’habillage de l’arrivée.
            draw(history, filtered, boats, selectedId, cursorTime, traceMode, colorMode, referenceTime, syncWeather);
            mounted = true;
            weatherLink = createWeatherLink(store, {
                onTime: receiveWeatherTime, onStatus: message => { weatherNotice = message; }
            });
            weatherLink.start();
            timer = setInterval(() => {
                now = Date.now();
                if (liveUrl && !busy && now - lastAttemptAt >= 300000) void loadUrl(liveUrl, true);
            }, 60000);
            if (publicMode) void loadUrl(liveUrl);
            finishLayers = createFinishLayers({ map, L, onError: cause => {
                finishNotice = 'Le repère d’arrivée n’a pas pu être affiché. Les positions et les distances restent disponibles.';
                console.warn('Route du Rhum : repère d’arrivée', cause);
            } });
        } catch (cause) {
            mapNotice = `Démarrage du plugin incomplet : ${cause?.message || 'erreur de la carte'}. Rechargez le plugin pour réessayer.`;
            console.error('Route du Rhum : démarrage', cause);
        }
    });
    onDestroy(() => {
        dead = true;
        mounted = false;
        ++revision;
        clearInterval(timer);
        pause();
        controller?.abort();
        weatherLink?.stop();
        mapLayers?.destroy();
        finishLayers?.destroy();
    });
</script>

<div class="plugin__mobile-header">Route du Rhum</div>
<section class="plugin__content rhum">
    <button class="back" on:click={() => bcast.emit('rqstOpen', 'menu')}>‹ Menu Windy</button>
    <h2>Route du Rhum</h2>
    <p class="muted">Positions et parcours des concurrents</p>
    <div class="summary"><strong>{filtered.length}</strong> / {boats.length} bateaux <span class="badge">{!history.times.length ? 'En attente' : navigation.outside ? 'Hors historique' : atLatest ? 'Dernier relevé' : 'Rejeu'}</span></div>
    {#if mapNotice}<p class="error" role="alert">{mapNotice}</p>{/if}

    {#if selectedBoat}
        <div class="selected-card">
            <div class="selected-tools"><span>Fiche du bateau</span><button aria-label="Fermer la fiche du panneau" on:click={dismissSelection}>Fermer ×</button></div>
            {@html boatCardHtml(selectedBoat, { fleet: boats, colorMode, referenceTime, history })}
        </div>
    {/if}
    {#if history.times.length}
    <div class="replay">
        <label for="rhum-time">Instant de course · UTC</label>
        <strong class="replay-date" aria-live="polite">{formatDate(cursorTime)}</strong>
        <input id="rhum-time" type="range" min="0" max={Math.max(0, history.times.length - 1)} step="1" value={cursorIndex} on:input={event => seek(event.currentTarget.value)} aria-label="Instant de course" />
        <div class="playback">
            <button aria-label="Relevé précédent" on:click={() => seek(Number(cursorIndex) - 1)} disabled={Number(cursorIndex) === 0}>‹</button>
            <button class="play" on:click={play} disabled={history.times.length < 2}>{playing ? 'Pause' : 'Lire le parcours'}</button>
            <button aria-label="Relevé suivant" on:click={() => seek(Number(cursorIndex) + 1)} disabled={atLatest}>›</button>
        </div>
        <div class="replay-options">
            <label>Vitesse de lecture
                <select bind:value={pace} on:change={pause}>
                    <option value={1500}>Lente</option><option value={1000}>Normale</option><option value={350}>Rapide</option>
                </select>
            </label>
            <button class="last" on:click={() => seek(history.times.length - 1)}>Dernier relevé</button>
        </div>
        <small>Repère {Number(cursorIndex) + 1} / {history.times.length} · {syncWeather ? 'interpolation entre relevés' : 'positions observées'}</small>
    </div>
    <label class="sync-switch"><input type="checkbox" checked={syncWeather} on:change={changeSync} /> Lier à l’heure météo Windy</label>
    {#if syncWeather}
        <p class="muted">Le curseur météo déplace les bateaux sur les traces. Entre deux relevés, les positions sont interpolées.</p>
        {#if weatherTimestamp}<p class="source">Heure météo : {formatDate(weatherTimestamp)}</p>{/if}
        {#if navigation.outside === 'after'}<p class="notice">L’heure choisie dépasse l’historique. Les bateaux restent à leur dernier point connu, sans projection future.</p>{/if}
        {#if navigation.outside === 'before'}<p class="notice">L’heure choisie précède l’historique. La carte conserve ses premières positions ; seuls les bateaux déjà observés à cette limite sont affichés.</p>{/if}
        {#if weatherNotice}<p class="notice" role="status">{weatherNotice}</p>{/if}
    {:else}<p class="muted">Rejeu indépendant de l’heure météo.</p>{/if}
    {:else}
        <p class="notice" role="status">{busy ? 'Chargement des positions de la course…' : publicMode ? 'En attente du premier relevé de la course.' : 'Aucun relevé disponible.'}</p>
    {/if}
    {#if fleetStats.unknownCount}<p class="notice">{fleetStats.unknownCount} bateaux sans fiche d’identité.</p>{/if}

    <label for="rhum-class">Classe</label>
    <select id="rhum-class" bind:value={selectedClass}>
        <option value="">Toutes les classes</option>
        {#each classes as className}<option value={className}>{className}</option>{/each}
    </select>
    <label for="rhum-search">Rechercher un bateau, un skipper ou un numéro</label>
    <input id="rhum-search" type="search" bind:value={query} placeholder="Ex. Laperche, 5, SVR…" />

    <div class="two-cols">
        <label for="rhum-colors">Couleurs
            <select id="rhum-colors" bind:value={colorMode}><option value="class">Par classe</option><option value="boat">Par bateau</option></select>
        </label>
        <label for="rhum-traces">Traces
            <select id="rhum-traces" bind:value={traceMode}>
                <option value="all">Bateaux affichés</option><option value="selected">Bateau sélectionné</option><option value="none">Masquées</option>
            </select>
        </label>
    </div>
    <div class="map-actions">
        <button class="action" on:click={centerFleet} disabled={!filtered.length}>Voir la flotte</button>
        <button class="action secondary" on:click={centerTracks} disabled={!filtered.length || traceMode === 'none'}>Cadrer les traces</button>
    </div>
    <button class="finish-action" on:click={centerFinish}>🏁 Voir la ligne d’arrivée</button>
    {#if finishNotice}<p class="notice" role="status">{finishNotice}</p>{/if}
    {#if selectedBoat}<p class="source">Sélection : <strong>{selectedBoat.name}</strong></p>{/if}
    {#if traceMode !== 'none'}<p class="muted">Les lignes relient les positions reçues et s’arrêtent à l’instant choisi.</p>{/if}
    {#if colorMode === 'class'}
        <div class="legend" aria-label="Couleurs des classes">
            {#each classes as className}<span><i style:background={CLASS_STYLES[className]?.color || '#cbd5e1'}></i>{className}</span>{/each}
        </div>
    {/if}
    <details class="finish-reference">
        <summary>Distances à l’arrivée · MN</summary>
        <p class="muted">Distance directe jusqu’au point le plus proche de la ligne. L’écart au leader est la différence des distances à la ligne, au même instant de lecture. Le leader est le 1er du pointage de chaque classe.</p>
        <p class="muted">Calcul orthodromique sans les contournements du parcours ; le rang transmis reste affiché. MN = milles nautiques.</p>
        <p class="source">Est : 16°12,000′ N · 61°30,800′ W<br />Ouest : 16°12,000′ N · 61°31,050′ W<br /><a href={FINISH_LINE.sourceUrl} target="_blank" rel="noreferrer">Instructions officielles 2026, art. 10.1, p. 12</a></p>
    </details>
    {#if !publicMode}
    <details>
        <summary>Importer des relevés ou connecter un flux</summary>
        <label for="rhum-file">Fichiers pos.txt ou GeoJSON — sélection multiple possible</label>
        <input id="rhum-file" type="file" multiple accept=".txt,.json,.geojson" on:change={readFiles} />
        <p class="muted">Les fichiers sont ajoutés à l’historique et remis dans l’ordre de leurs heures UTC.</p>
        <label for="rhum-url">Adresse HTTPS du relevé ou du relais FTP</label>
        <input id="rhum-url" type="url" bind:value={apiUrl} placeholder="https://votre-serveur/releve.geojson" />
        <button class="action" disabled={busy || !apiUrl.trim()} on:click={() => loadUrl(apiUrl.trim())}>Connecter le flux</button>
        <p class="muted">Pour le FTP local, laissez npm start ouvert et lancez le relais dans un second Terminal : npm run ftp. Le mot de passe reste dans ce Terminal.</p>
    </details>
    {/if}
    <p class="source">{source}{#if history.times.length}<br />De {formatDate(history.oldest)} à {formatDate(history.newest)}{/if}</p>
    {#if fetchedAt}<p class="source">{publicMode ? 'Positions récupérées' : 'Flux lu'} : {formatDate(fetchedAt)}</p>{/if}
    {#if relayRetrievedAt}<p class="source">{publicMode ? 'Dernière mise à jour des données' : 'Dernière récupération FTP'} : {formatDate(relayRetrievedAt)}</p>{/if}
    {#if busy}<p role="status">Chargement…</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if publicMode && error}<button class="action" disabled={busy} on:click={() => loadUrl(liveUrl, true)}>Réessayer maintenant</button>{/if}
    <div class="boats">
        {#each filtered as boat (boat.id)}
            {@const standing = standings.get(boat.id)}
            <button class="boat" class:selected={boat.id === selectedId} style:border-left-color={boatColor(boat, colorMode)} on:click={() => showBoat(boat)}>
                <div class="boat-heading"><b class="rank-chip">{rankLabel(standing.rank)}</b><strong>{boat.name}</strong></div>
                <span>{boat.skipper || `ID ${boat.id} — identité à compléter`}</span>
                <span>{boat.className} · Rang transmis {standing.rank ?? 'Non communiqué'}</span>
                <span>{boat.speed.toFixed(1)} nd · Cap {Math.round(boat.heading) % 360}°{boat.interpolated ? ' · estimés' : ''}</span>
                <span class="boat-distances"><b>À la ligne : {distanceLabel(standing.distanceToFinishNm)}</b><br />Écart au leader : {gapLabel(standing.gapToLeaderNm)}{standing.isLeader ? ' · Leader' : ''}</span>
                <small class:stale={oldPosition(boat, referenceTime)}>{formatDate(boat.time)}{oldPosition(boat, referenceTime) ? ' · ancienne (> 2 h)' : ''}</small>
            </button>
        {/each}
        {#if history.times.length && !filtered.length}<p>Aucun bateau pour cette recherche.</p>{/if}
    </div>
</section>

<style>
    .rhum { padding: 18px 16px; line-height: 1.45; }
    h2 { margin: 8px 0 0; font-size: 25px; }
    p { margin: 8px 0 12px; }
    .muted, .source { opacity: .8; font-size: 12px; }
    .back { background: none; border: 0; padding: 0; color: inherit; cursor: pointer; }
    .summary { display:flex; align-items:center; gap:5px; font-size: 15px; margin: 14px 0 10px; }
    .summary strong { font-size: 28px; }
    .badge { margin-left:auto; font-size:11px; border:1px solid #8886; padding:3px 7px; border-radius:12px; }
    .notice { border-left: 2px solid #fbbf24; padding-left: 9px; font-size: 12px; }
    label { display: block; font-size: 12px; margin-top: 12px; margin-bottom: 5px; }
    select, input { box-sizing: border-box; width: 100%; color: #172033; background: white; border: 1px solid #aaa; border-radius: 6px; padding: 9px; font: inherit; }
    .action { width: 100%; border: 0; padding: 10px; border-radius: 6px; background: #126f81; color: white; cursor: pointer; margin-top: 10px; }
    .secondary { background:#46617a; }
    button:disabled { opacity: .5; cursor: default; }
    .replay { border:1px solid #8885; border-radius:9px; padding:12px; background:#ffffff08; }
    .replay label { margin-top:0; }
    .replay-date { display:block; font-size:16px; }
    .replay input[type=range] { padding:8px 0; background:none; accent-color:#35b7b5; border:0; }
    .playback { display:grid; grid-template-columns:34px 1fr 34px; gap:6px; }
    .playback button, .last { border:1px solid #8885; background:#ffffff12; color:inherit; border-radius:5px; padding:8px; cursor:pointer; }
    .playback .play { background:#126f81; color:white; }
    .replay-options { display:flex; align-items:end; gap:12px; margin-top:10px; }
    .replay-options label { flex:1; margin:0; }
    .replay-options select { padding:5px; margin-top:4px; }
    .last { font-size:11px; margin-bottom:5px; }
    .replay small { display:block; opacity:.75; font-size:10px; margin-top:8px; }
    .two-cols { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    .two-cols select { margin-top:5px; }
    .map-actions { display:flex; gap:8px; }
    .finish-action { width:100%; margin-top:8px; padding:9px; color:inherit; background:#ffffff12; border:1px solid #8885; border-radius:6px; cursor:pointer; }
    .finish-reference a { color:inherit; text-decoration:underline; }
    .boat-distances { padding:7px 0 3px; color:#d7e9f3; }
    :global(.rhum-finish-icon) { font-size:27px; line-height:34px; filter:drop-shadow(0 1px 2px #0009); }
    .legend { display:flex; flex-wrap:wrap; gap:5px 12px; font-size:10px; margin:12px 0; }
    .legend span { display:flex; align-items:center; gap:5px; }
    .legend i { width:8px; height:8px; border-radius:50%; display:inline-block; }
    details { margin: 16px 0; border-top: 1px solid #8885; padding-top: 12px; }
    summary { cursor: pointer; }
    .error { background: #7f1d1d; color: white; padding: 10px; border-radius: 6px; font-size: 13px; }
    .boat { display: block; text-align: left; width: 100%; color: inherit; background: #ffffff0a; border: 1px solid #8884; border-left-width: 4px; padding: 10px; margin: 9px 0; border-radius: 6px; cursor: pointer; }
    .boat span, .boat small { display: block; font-size: 12px; margin-top: 3px; }
    .boat strong { font-size: 14px; }
    .boat.selected { background: #ffffff24; border-top-color: #ccc; border-bottom-color: #ccc; }
    .stale { color: #fbbf24; }
    .sync-switch { display:flex; align-items:center; gap:8px; margin:12px 0; font-weight:600; }
    .sync-switch input { width:17px; height:17px; padding:0; accent-color:#2ec4b6; }
    .selected-card { margin-bottom:14px; }
    .selected-tools { display:flex; justify-content:space-between; align-items:center; padding:8px 0; font-size:11px; }
    .selected-tools button { color:inherit; background:none; border:0; cursor:pointer; }
    .boat-heading { display:flex; align-items:center; gap:8px; }
    .rank-chip { display:flex; min-width:34px; min-height:32px; justify-content:center; align-items:center; font-size:17px; background:#ffffff18; border-radius:6px; }
    :global(.rhum-card) { box-sizing:border-box; border-radius:14px; padding:16px; color:#f5f8fc; background:linear-gradient(150deg,#16344a,#0c1c2e); border-top:4px solid var(--rhum-accent,#30d4d2); box-shadow:0 7px 24px #0002; font-family:Arial,sans-serif; font-size:13px; line-height:1.4; text-align:left; }
    :global(.rhum-card *) { box-sizing:border-box; }
    :global(.rhum-card-top) { display:flex; flex-wrap:wrap; align-items:center; gap:6px; padding-right:10px; margin-bottom:14px; }
    :global(.rhum-card-class) { color:var(--rhum-accent); text-transform:uppercase; letter-spacing:1.4px; font-size:10px; font-weight:700; }
    :global(.rhum-card-badge) { padding:3px 6px; border-radius:8px; font-size:9px; background:#ffffff12; }
    :global(.rhum-card-main) { display:flex; align-items:center; gap:14px; }
    :global(.rhum-card-rank) { flex:0 0 80px; text-align:center; border-right:1px solid #ffffff23; padding-right:12px; }
    :global(.rhum-card-rank strong) { display:block; font-size:46px; line-height:1; font-weight:800; color:var(--rhum-accent); letter-spacing:-2px; }
    :global(.rhum-card-rank strong small) { font-size:15px; letter-spacing:0; vertical-align:super; margin-left:2px; }
    :global(.rhum-card-rank-label) { display:block; font-size:9px; font-weight:600; margin-top:7px; color:#c4d1df; }
    :global(.rhum-card-rank-count) { display:block; font-size:9px; margin-top:3px; color:#9dafc1; }
    :global(.rhum-card-identity) { flex:1; min-width:0; }
    :global(.rhum-card-name) { margin:0; color:#fff; font-size:17px; line-height:1.2; font-weight:750; overflow-wrap:anywhere; }
    :global(.rhum-card-skipper) { margin:7px 0 3px; color:#dce5ef; font-size:12px; }
    :global(.rhum-card-identity > small) { color:#9dafc1; font-size:10px; }
    :global(.rhum-card-stats) { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:16px 0 10px; padding:0; }
    :global(.rhum-card-stat) { padding:10px 12px; background:#ffffff0a; border-radius:8px; }
    :global(.rhum-card-label) { color:#aebfd0; font-size:10px; display:block; margin:0 0 4px; }
    :global(.rhum-card-value) { font-size:23px; line-height:1.15; color:#fff; font-weight:700; margin:0; display:block; }
    :global(.rhum-card-value small) { font-size:12px; color:#aebfd0; font-weight:500; }
    :global(.rhum-card-gap) { border-top:1px solid #ffffff20; padding:12px 0 0; }
    :global(.rhum-card-finish) { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:0 0 12px; }
    :global(.rhum-card-finish .rhum-card-value) { font-size:21px; }
    :global(.rhum-card-gap > span:not(.rhum-card-label)) { display:block; margin-top:6px; font-size:11px; color:#d2deeb; }
    :global(.rhum-card-gap > small) { display:block; margin-top:5px; color:#9dafc1; font-size:9px; }
    :global(.rhum-card-gap > .rhum-card-value) { font-size:21px; }
    :global(.rhum-card-meta) { display:flex; flex-direction:column; gap:4px; border-top:1px solid #ffffff20; margin-top:12px; padding-top:10px; color:#9dafc1; font-size:9px; }
    :global(.rhum-card-coordinates) { font-size:10px; font-variant-numeric:tabular-nums; letter-spacing:.2px; }
    :global(.rhum-card-notice) { color:#ffd482; font-size:10px; margin:7px 0 0; }
    :global(.rhum-popup .leaflet-popup-content-wrapper), :global(.rhum-popup .maplibregl-popup-content) { padding:0; background:#102438; border-radius:14px; }
    :global(.rhum-popup .leaflet-popup-content) { margin:0; min-width:270px; }
    :global(.rhum-popup .rhum-card) { max-height:min(70vh,680px); overflow-y:auto; overscroll-behavior:contain; }
    :global(.rhum-popup .leaflet-popup-tip) { background:#0c1c2e; }
    :global(.rhum-popup .leaflet-popup-close-button), :global(.rhum-popup .maplibregl-popup-close-button) { color:#fff; right:7px; top:7px; z-index:2; }
    :global(.rhum-card-averages) { margin:0 0 12px; padding:11px 0 10px; border-top:1px solid #ffffff20; }
    :global(.rhum-card-average-grid) { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; margin-top:7px; }
    :global(.rhum-card-average) { min-width:0; padding:8px 6px; border-radius:7px; background:#ffffff0a; text-align:center; }
    :global(.rhum-card-average .rhum-card-label) { font-size:11px; }
    :global(.rhum-card-average > strong) { display:block; color:#fff; font-size:20px; font-weight:750; line-height:1.2; }
    :global(.rhum-card-average > strong small) { font-size:10px; color:#aebfd0; font-weight:500; }
    :global(.rhum-card-average-reason) { display:block; color:#9dafc1; font-size:9px; line-height:1.25; margin-top:4px; }
    :global(.rhum-card-average-note) { display:block; color:#9dafc1; font-size:9px; margin-top:7px; }
</style>
