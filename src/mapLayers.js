/**
 * Keeps Leaflet objects alive while the fleet, selection or replay instant changes.
 * Callbacks in update() always receive the most recent boat, including click handlers.
 */
export function createMapLayers({ map, L, onSelect = () => {} }) {
    const markers = new Map();
    const lines = new Map();
    let fleet = new Map();
    let frame;
    let popup;
    let popupId = null;
    let destroyed = false;

    function forgetPopup(event) {
        // Windy also opens its own popups; their close events must not affect ours.
        if (event?.popup === popup || event?.target === popup) popupId = null;
    }
    map.on('popupclose', forgetPopup);

    function ensurePopup() {
        if (!popup) {
            popup = new L.Popup({
                className: 'rhum-popup', minWidth: 270, maxWidth: 340,
                offset: [0, -16], autoPan: true, closeButton: true,
                // Windy's map click can follow the marker click on the same event.
                // Keep the card open until its close button is used.
                closeOnClick: false, autoClose: false
            });
            // remove also covers direct popup.remove(), including Leaflet-GL.
            popup.on('remove', forgetPopup);
        }
        return popup;
    }

    function closePopup() {
        popupId = null;
        popup?.remove();
    }

    function openBoat(id) {
        if (destroyed) return false;
        const boat = fleet.get(id);
        if (!boat || !frame) return false;
        // No setView here: moving the map during the click races popup closing.
        // Autopan keeps the card in view without replacing the marker beneath it.
        onSelect(boat);
        popupId = null;
        ensurePopup().setLatLng([boat.lat, boat.lon]).setContent(frame.popupFor(boat)).openOn(map);
        // Some Leaflet implementations remove/re-add a reused popup in openOn().
        // Its remove event must not erase the selection we just opened.
        popupId = id;
        return true;
    }

    function removeMarker(id) {
        const item = markers.get(id);
        item.marker.off('click', item.click);
        map.removeLayer(item.marker);
        markers.delete(id);
    }

    function removeLine(id) {
        map.removeLayer(lines.get(id));
        lines.delete(id);
    }

    function update(nextFrame) {
        if (destroyed) return;
        frame = nextFrame;
        const { boats, selectedId, iconFor, traceFor, lineStyleFor, traceMode = 'all' } = frame;
        fleet = new Map(boats.map(boat => [boat.id, boat]));
        if (popupId !== null && !fleet.has(popupId)) closePopup();

        for (const id of markers.keys()) if (!fleet.has(id)) removeMarker(id);
        const visibleLines = new Set();
        for (const boat of boats) {
            const selected = boat.id === selectedId;
            if (traceMode !== 'none' && (traceMode !== 'selected' || selected)) {
                const points = traceFor?.(boat) || [];
                if (points.length >= 2) {
                    visibleLines.add(boat.id);
                    const style = { ...(lineStyleFor?.(boat, selected) || {}), interactive: false };
                    let line = lines.get(boat.id);
                    if (line) line.setLatLngs(points).setStyle(style);
                    else {
                        line = new L.Polyline(points, style).addTo(map);
                        lines.set(boat.id, line);
                    }
                    line.bringToBack?.();
                }
            }

            const position = [boat.lat, boat.lon];
            const icon = iconFor(boat, selected);
            // Avoid replacing the icon's DOM at every clock tick when unchanged.
            const iconKey = typeof icon?.options?.html === 'string' ? JSON.stringify([
                icon.options.html, icon.options.className, icon.options.iconSize, icon.options.iconAnchor
            ]) : icon;
            let item = markers.get(boat.id);
            if (item) {
                item.marker.setLatLng(position);
                if (item.iconKey !== iconKey) item.marker.setIcon(icon);
                item.iconKey = iconKey;
            } else {
                const id = boat.id;
                const marker = new L.Marker(position, { icon, bubblingMouseEvents: false }).addTo(map);
                const click = () => openBoat(id);
                marker.on('click', click);
                item = { marker, click, iconKey };
                markers.set(id, item);
            }
            item.marker.setZIndexOffset?.(selected ? 1000 : 0);
        }
        for (const id of lines.keys()) if (!visibleLines.has(id)) removeLine(id);

        // selectedId alone must never reopen a card the user dismissed.
        if (popupId !== null) {
            const boat = fleet.get(popupId);
            popup.setLatLng([boat.lat, boat.lon]).setContent(frame.popupFor(boat));
        }
    }

    function destroy() {
        if (destroyed) return;
        destroyed = true;
        map.off('popupclose', forgetPopup);
        popup?.off('remove', forgetPopup);
        closePopup();
        for (const id of markers.keys()) removeMarker(id);
        for (const id of lines.keys()) removeLine(id);
        fleet.clear();
        frame = undefined;
        popup = undefined;
    }

    return { update, openBoat, closePopup, destroy };
}
