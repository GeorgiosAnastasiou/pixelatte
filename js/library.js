// library.js — the shipped palettes.
//
// Separated from store.js because the two answer different questions: this is
// what the app knows about colour, and store.js is how a device remembers what
// it has been given. The list grows; the persistence rules do not.
//
// Every entry carries a `group`, which is what the Palettes screen sorts under,
// and a `since`. `since` is the version of the shipped set the entry first
// appeared in, and it is what lets a later release deliver new palettes to an
// existing install without resurrecting ones the user deliberately deleted —
// only entries newer than the version a device has already seen are added.
//
// Hardware palettes are exact: those machines could display these colours and
// no others, which is what makes an image mapped to one read as that machine.
// The editor schemes are the published values of their themes, transcribed
// rather than generated — if one looks off against the original, trust the
// original. The rest are picked by eye and make no claim to authority.

/** Bump when entries are added below, and stamp the new ones with it. */
export const DEFAULTS_VERSION = 4;

/**
 * The order groups appear in. Anything unlisted falls to the end.
 *
 * Hardware comes last despite being the most exact set here. Those palettes are
 * the ones you go looking for by name — you already know whether you want the
 * Game Boy — while the others are the ones you find by scrolling, and a list
 * that opens on four greens is a list that looks like it is only about
 * machines. The ones picked for pictures lead instead.
 */
export const GROUPS = ['Landscape', 'Duotone', 'Editor themes', 'Hardware'];

export const CATALOGUE = [
    {
        name: 'Commodore 64', group: 'Hardware', since: 2,
        colors: [
            '#000000', '#FFFFFF', '#880000', '#AAFFEE', '#CC44CC', '#00CC55',
            '#0000AA', '#EEEE77', '#DD8855', '#664400', '#FF7777', '#333333',
            '#777777', '#AAFF66', '#0088FF', '#BBBBBB',
        ],
    },
    {
        name: 'ZX Spectrum', group: 'Hardware', since: 2,
        colors: [
            '#000000', '#0000D7', '#D70000', '#D700D7', '#00D700', '#00D7D7',
            '#D7D700', '#D7D7D7', '#0000FF', '#FF0000', '#FF00FF', '#00FF00',
            '#00FFFF', '#FFFF00', '#FFFFFF',
        ],
    },
    {
        name: 'PICO-8', group: 'Hardware', since: 2,
        colors: [
            '#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F',
            '#C2C3C7', '#FFF1E8', '#FF004D', '#FFA300', '#FFEC27', '#00E436',
            '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA',
        ],
    },
    {
        name: 'Gruvbox', group: 'Editor themes', since: 2,
        colors: [
            '#282828', '#3C3836', '#504945', '#665C54', '#BDAE93', '#EBDBB2',
            '#CC241D', '#FB4934', '#98971A', '#B8BB26', '#D79921', '#FABD2F',
            '#458588', '#83A598', '#B16286', '#D3869B', '#689D6A', '#8EC07C',
        ],
    },
    {
        name: 'Nord', group: 'Editor themes', since: 2,
        colors: [
            '#2E3440', '#3B4252', '#434C5E', '#4C566A', '#D8DEE9', '#E5E9F0',
            '#ECEFF4', '#8FBCBB', '#88C0D0', '#81A1C1', '#5E81AC', '#BF616A',
            '#D08770', '#EBCB8B', '#A3BE8C', '#B48EAD',
        ],
    },
    {
        name: 'Tokyo Night', group: 'Editor themes', since: 2,
        colors: [
            '#1A1B26', '#24283B', '#414868', '#565F89', '#A9B1D6', '#C0CAF5',
            '#F7768E', '#FF9E64', '#E0AF68', '#9ECE6A', '#73DACA', '#7DCFFF',
            '#7AA2F7', '#BB9AF7',
        ],
    },
    {
        name: 'Rose Pine', group: 'Editor themes', since: 2,
        colors: [
            '#191724', '#1F1D2E', '#26233A', '#6E6A86', '#908CAA', '#E0DEF4',
            '#EB6F92', '#F6C177', '#EBBCBA', '#31748F', '#9CCFD8', '#C4A7E7',
        ],
    },
    {
        name: 'Blue Haze', group: 'Landscape', since: 3,
        colors: [
            '#382674', '#091521', '#291B4A', '#553379', '#452159', '#0D1541',
            '#663C8F', '#FB8AD9', '#A65191', '#6558B9', '#03C1B1', '#7649A7',
            '#5B3EAB', '#1D2B7F', '#393D8B',
        ],
    },
    {
        name: 'Sunset Peaks', group: 'Landscape', since: 3,
        colors: [
            '#9464CF', '#C05CB1', '#382775', '#B264CB', '#7556C9', '#43378C',
            '#1A1526', '#CA5994', '#301A46', '#7355A5', '#AD3DA6', '#57469C',
            '#8B61B3', '#5B48C3', '#592C76',
        ],
    },
    {
        name: 'Sunset Peaks 2', group: 'Landscape', since: 3,
        colors: [
            '#412047', '#39192B', '#5A2F4D', '#72404A', '#8D3A3D', '#1E3C37',
            '#6F2A36', '#512B2F', '#8B554D', '#1B1827', '#463D62', '#BF7A56',
            '#A5625C', '#D73C21', '#6F4068',
        ],
    },
    {
        name: 'Ornate Skies', group: 'Landscape', since: 3,
        colors: [
            '#437FBA', '#FABA90', '#AD74B8', '#0E0739', '#5494C5', '#EC9ABE',
            '#6D448B', '#523A7E', '#835799', '#FDE694', '#C695CF', '#FBF7AE',
            '#F89CA2', '#336CA8', '#9B67A5',
        ],
    },
    {
        name: 'Kanagawa', group: 'Editor themes', since: 2,
        colors: [
            '#1F1F28', '#2A2A37', '#223249', '#363646', '#54546D', '#727169',
            '#DCD7BA', '#C8C093', '#7E9CD8', '#957FB8', '#FF5D62', '#E82424',
            '#98BB6C', '#7AA89F', '#FFA066', '#E6C384',
        ],
    },

    // The hardware palettes last. They are the most restrictive thing here —
    // four colours, or two — so they are what you reach for deliberately rather
    // than what should greet you at the top of the list.
    { name: 'Gameboy', group: 'Hardware', since: 1, colors: ['#0F380F', '#306230', '#8BAC0F', '#9BBC0F'] },
    { name: 'Grayscale', group: 'Hardware', since: 1, colors: ['#000000', '#555555', '#AAAAAA', '#FFFFFF'] },
    { name: 'CGA', group: 'Hardware', since: 1, colors: ['#000000', '#55FFFF', '#FF55FF', '#FFFFFF'] },
    {
        name: '1-bit', group: 'Hardware', since: 2,
        colors: ['#000000', '#FFFFFF'],
    },

    /* ---------------------------------------------------------- hardware */
    {
        name: 'NES', since: 4, group: 'Hardware',
        colors: [
            '#7C7C7C', '#0000FC', '#0000BC', '#4428BC', '#940084', '#A80020',
            '#A81000', '#881400', '#503000', '#007800', '#006800', '#005800',
            '#004058', '#000000', '#BCBCBC', '#0078F8', '#0058F8', '#6844FC',
            '#D800CC', '#E40058', '#F83800', '#E45C10', '#AC7C00', '#00B800',
            '#00A800', '#00A844', '#008888', '#F8F8F8', '#3CBCFC', '#6888FC',
            '#9878F8', '#F878F8', '#F85898', '#F87858', '#FCA044', '#F8B800',
            '#B8F818', '#58D854', '#58F898', '#00E8D8', '#FCFCFC', '#A4E4FC',
            '#B8B8F8', '#D8B8F8', '#F8B8F8', '#F8A4C0', '#F0D0B0', '#FCE0A8',
            '#F8D878', '#D8F878', '#B8F8B8', '#B8F8D8', '#00FCFC',
        ],
    },
    {
        name: 'Apple II', since: 4, group: 'Hardware',
        colors: [
            '#000000', '#722640', '#40337F', '#E434FE', '#0E5940', '#808080',
            '#1B9AFE', '#BFB3FF', '#404C00', '#FE6A3C', '#BFBFBF', '#FF96BF',
            '#1FCB00', '#BFCC80', '#7ECFBF', '#FFFFFF',
        ],
    },
    {
        name: 'Game Boy Pocket', since: 4, group: 'Hardware',
        colors: ['#C4CFA1', '#8B956D', '#4D533C', '#1F1F1F'],
    },
    {
        name: 'MSX', since: 4, group: 'Hardware',
        colors: [
            '#000000', '#3EB849', '#74D07D', '#5955E0', '#8076F1', '#B95E51',
            '#65DBEF', '#DB6559', '#FF897D', '#CCC35E', '#DED087', '#3AA241',
            '#B766B5', '#CCCCCC', '#FFFFFF',
        ],
    },
    {
        name: 'Teletext', since: 4, group: 'Hardware',
        colors: [
            '#000000', '#FF0000', '#00FF00', '#FFFF00', '#0000FF', '#FF00FF',
            '#00FFFF', '#FFFFFF',
        ],
    },

    /* ----------------------------------------------------- editor themes */
    {
        name: 'Dracula', since: 4, group: 'Editor themes',
        colors: [
            '#282A36', '#44475A', '#6272A4', '#F8F8F2', '#8BE9FD', '#50FA7B',
            '#FFB86C', '#FF79C6', '#BD93F9', '#FF5555', '#F1FA8C',
        ],
    },
    {
        name: 'Solarized', since: 4, group: 'Editor themes',
        colors: [
            '#002B36', '#073642', '#586E75', '#657B83', '#839496', '#93A1A1',
            '#EEE8D5', '#FDF6E3', '#B58900', '#CB4B16', '#DC322F', '#D33682',
            '#6C71C4', '#268BD2', '#2AA198', '#859900',
        ],
    },
    {
        name: 'Monokai', since: 4, group: 'Editor themes',
        colors: [
            '#272822', '#3E3D32', '#75715E', '#F8F8F2', '#F92672', '#FD971F',
            '#E6DB74', '#A6E22E', '#66D9EF', '#AE81FF',
        ],
    },
    {
        name: 'Catppuccin', since: 4, group: 'Editor themes',
        colors: [
            '#1E1E2E', '#313244', '#45475A', '#585B70', '#CDD6F4', '#BAC2DE',
            '#F5E0DC', '#F38BA8', '#FAB387', '#F9E2AF', '#A6E3A1', '#94E2D5',
            '#89DCEB', '#89B4FA', '#CBA6F7', '#F5C2E7',
        ],
    },
    {
        name: 'Everforest', since: 4, group: 'Editor themes',
        colors: [
            '#2D353B', '#343F44', '#3D484D', '#475258', '#D3C6AA', '#E67E80',
            '#E69875', '#DBBC7F', '#A7C080', '#83C092', '#7FBBB3', '#D699B6',
        ],
    },
    {
        name: 'Zenburn', since: 4, group: 'Editor themes',
        colors: [
            '#3F3F3F', '#4F4F4F', '#5F5F5F', '#709080', '#DCDCCC', '#CC9393',
            '#DFAF8F', '#F0DFAF', '#7F9F7F', '#93E0E3', '#8CD0D3', '#DC8CC3',
        ],
    },

    /* --------------------------------------------------------- landscape */
    {
        name: 'Sea Glass', since: 4, group: 'Landscape',
        colors: [
            '#0B2027', '#12404A', '#1E6B6B', '#3E9C8F', '#77C4B0', '#B4E1D2',
            '#E4F4EC', '#F2E9D8',
        ],
    },
    {
        name: 'Autumn Wood', since: 4, group: 'Landscape',
        colors: [
            '#1E1512', '#3B2418', '#6B3A1E', '#A55A24', '#D08A38', '#E3B45C',
            '#7C7A44', '#4B5A32', '#2C3A24',
        ],
    },
    {
        name: 'Cold Morning', since: 4, group: 'Landscape',
        colors: [
            '#101820', '#1F2A36', '#33475B', '#4F6B82', '#7A96A8', '#A9C2CC',
            '#D5E4E8', '#F0F5F5',
        ],
    },
    {
        name: 'Desert Noon', since: 4, group: 'Landscape',
        colors: [
            '#2B1B12', '#5A3520', '#8C5A2E', '#BE8447', '#DCB176', '#EFD9A8',
            '#8FA0A6', '#5C7178',
        ],
    },
    {
        name: 'Storm Front', since: 4, group: 'Landscape',
        colors: [
            '#0A0A12', '#181A2A', '#2C3050', '#454B78', '#6A6FA0', '#9A9DC0',
            '#C9CBDE', '#E8B94A',
        ],
    },
    {
        name: 'Coral Reef', since: 4, group: 'Landscape',
        colors: [
            '#04202C', '#0A3D4F', '#127A7A', '#2FB39B', '#7FD8C0', '#FF6B5B',
            '#FF9E7A', '#FFD3A3', '#FFF1D6',
        ],
    },

    /* ----------------------------------------------------------- duotone */
    {
        name: 'Ink and Rust', since: 4, group: 'Duotone',
        colors: ['#12100E', '#2B2622', '#8A3A1E', '#D8622F', '#F0A868', '#F6EBDD'],
    },
    {
        name: 'Cyanotype', since: 4, group: 'Duotone',
        colors: ['#04121F', '#0B2C4A', '#155A82', '#2E8BB5', '#7FC0DA', '#D7EEF7'],
    },
    {
        name: 'Sepia', since: 4, group: 'Duotone',
        colors: ['#1B1109', '#3A2617', '#67472B', '#9A7048', '#C8A278', '#EBD9BE'],
    },
    {
        name: 'Neon Noir', since: 4, group: 'Duotone',
        colors: ['#0A0311', '#1E0B2E', '#3D1259', '#7B1FA2', '#C724B1', '#FF4FD8', '#FFC2F0'],
    },
];
