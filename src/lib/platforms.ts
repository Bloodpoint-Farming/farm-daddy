export const PLATFORMS = {
    steam: { label: 'Steam', short: 'Steam' },
    epic: { label: 'Epic Games', short: 'Epic' },
    windows: { label: 'Windows Store', short: 'Win' },
    xbox: { label: 'Xbox', short: 'Xbox' },
    ps4: { label: 'PlayStation 4', short: 'PS4' },
    ps5: { label: 'PlayStation 5', short: 'PS5' },
    switch: { label: 'Nintendo Switch', short: 'Switch' }
} as const;

export type PlatformKey = keyof typeof PLATFORMS;
