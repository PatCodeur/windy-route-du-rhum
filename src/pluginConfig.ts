import type { ExternalPluginConfig } from '@windy/interfaces';

const config: ExternalPluginConfig = {
    name: 'windy-plugin-rhum',
    version: '0.9.2',
    icon: '⛵',
    title: 'Route du Rhum — ma flotte',
    description: 'Flotte, traces, vitesses moyennes et distances à la ligne d’arrivée par classe.',
    desktopUI: 'rhpane',
    mobileUI: 'small',
    desktopWidth: 360,
    routerPath: '/rhum-personnel',
    private: false,
};
export default config;
