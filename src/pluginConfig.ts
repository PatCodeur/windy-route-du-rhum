import type { ExternalPluginConfig } from '@windy/interfaces';

const config: ExternalPluginConfig = {
    name: 'windy-plugin-rhum-personnel',
    version: '0.9.2',
    icon: '⛵',
    title: 'Route du Rhum — ma flotte',
    description: 'Flotte, traces, vitesses moyennes et distances à la ligne d’arrivée par classe.',
    desktopUI: 'rhpane',
    mobileUI: 'small',
    desktopWidth: 360,
    routerPath: '/rhum-personnel',
    private: true,
};
export default config;
