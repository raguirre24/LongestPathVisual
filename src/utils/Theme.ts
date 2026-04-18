
export const UI_TOKENS = {
    height: {
        compact: 24,
        standard: 32,
        comfortable: 36
    },

    radius: {
        small: 3,
        medium: 8,
        large: 16,
        pill: 20,
        full: 9999
    },

    spacing: {
        xs: 4,
        sm: 6,
        md: 10,
        lg: 14,
        xl: 18,
        xxl: 24
    },

    fontSize: {
        xs: 10,
        sm: 11,
        md: 12,
        lg: 13,
        xl: 14
    },

    fontWeight: {
        normal: 400,
        medium: 500,
        semibold: 600,
        bold: 700
    },

    color: {
        primary: {
            default: '#0078D4',
            hover: '#106EBE',
            pressed: '#005A9E',
            light: '#DEECF9',
            lighter: '#EFF6FC',
            subtle: '#F3F9FD'
        },
        warning: {
            default: '#F7A800',
            hover: '#E09200',
            pressed: '#C87E00',
            light: '#FFF4CE',
            lighter: '#FFFAED',
            subtle: '#FFFCF8'
        },
        success: {
            default: '#107C10',
            hover: '#0E6B0E',
            pressed: '#0C5A0C',
            light: '#DFF6DD',
            lighter: '#F1FAF1',
            subtle: '#F7FDF7'
        },
        danger: {
            default: '#D13438',
            hover: '#B82E31',
            pressed: '#A0272A',
            light: '#FDE7E9',
            lighter: '#FEF4F5',
            subtle: '#FFF9FA'
        },
        neutral: {
            black: '#201F1E',
            grey190: '#201F1E',
            grey160: '#323130',
            grey140: '#484644',
            grey130: '#605E5C',
            grey90: '#A19F9D',
            grey60: '#C8C6C4',
            grey40: '#D2D0CE',
            grey30: '#EDEBE9',
            grey20: '#F3F2F1',
            grey10: '#FAF9F8',
            grey5: '#FCFCFC',
            white: '#FFFFFF'
        }
    },

    shadow: {
        1: '0 0.5px 1px rgba(0, 0, 0, 0.08)',
        2: '0 1px 2px rgba(0, 0, 0, 0.08), 0 0.5px 1px rgba(0, 0, 0, 0.04)',
        4: '0 2px 4px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)',
        8: '0 4px 8px rgba(0, 0, 0, 0.12), 0 2px 4px rgba(0, 0, 0, 0.08)',
        16: '0 8px 16px rgba(0, 0, 0, 0.14), 0 4px 8px rgba(0, 0, 0, 0.1)',
        24: '0 12px 24px rgba(0, 0, 0, 0.16), 0 6px 12px rgba(0, 0, 0, 0.12)'
    },

    motion: {
        duration: {
            instant: 0,
            fast: 120,
            normal: 200,
            slow: 350,
            slower: 500
        },
        easing: {
            standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
            decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
            accelerate: 'cubic-bezier(0.4, 0, 1, 1)',
            sharp: 'cubic-bezier(0.4, 0, 0.6, 1)',
            smooth: 'cubic-bezier(0.4, 0.14, 0.3, 1)'
        }
    }
};

export const LAYOUT_BREAKPOINTS = {
    wide: 850,
    medium: 650,
    narrow: 0
};

export const HEADER_DOCK_TOKENS = {
    shell: '#151B24',
    commandBg: '#1B2330',
    commandStroke: '#2E394A',
    contextBg: '#202937',
    contextStroke: '#344154',
    groupBg: '#252F3C',
    groupStroke: '#3D4A5D',
    buttonBg: '#2D3745',
    buttonHoverBg: '#394557',
    buttonStroke: '#4D5A6E',
    buttonHoverStroke: '#66758C',
    buttonText: '#F4F7FB',
    buttonMuted: '#AEB8C8',
    buttonSubtle: '#8E9AAF',
    chipBg: '#243040',
    chipStroke: '#44526A',
    chipText: '#F3F7FC',
    chipMuted: '#B0BBCC',
    inputBg: '#1F2835',
    inputStroke: '#4A5870',
    inputFocus: '#7CABFF',
    inputPlaceholder: '#8D9AAF',
    menuBg: '#1E2633',
    menuStroke: '#47566E',
    menuHover: '#2E3D53',
    menuActive: '#35507A',
    rowDivider: '#303B4B',
    primary: '#7CABFF',
    primaryBg: '#294C7A',
    success: '#88D58C',
    successBg: '#244836',
    warning: '#F1B55B',
    warningBg: '#5D4320',
    warningText: '#FFE0A6',
    danger: '#FF8B7A',
    dangerBg: '#5B2C2B',
    shadow: '0 8px 20px rgba(8, 12, 18, 0.28)'
};
