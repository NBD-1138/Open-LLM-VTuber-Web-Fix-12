export interface ApprovedSoundAsset {
  id: string;
  label: string;
  url: string;
}

export interface ApprovedOverlayAsset {
  id: string;
  label: string;
  dataUrl: string;
}

const makeSvgDataUrl = (svg: string) => `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;

export const APPROVED_SOUND_ASSETS: Record<string, ApprovedSoundAsset> = {
  assistant_test_ping: {
    id: 'assistant_test_ping',
    label: 'Assistant Test Ping',
    // Short built-in WAV ping so the default profile can demonstrate sound safely.
    url: 'data:audio/wav;base64,UklGRlQCAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YTACAACBhYqQlp2ko6CWjYBzYV1ZT0Y+NTAuLS4xNj1GUVxeYmRjX1lRSDw0MC8xNj5JU1xdYF9aUkdAPS8rKSwxN0BKVV5fYFtXUEY9Mi4tLzQ8RlJbYF9cVlBHRD42MC4uMzpESFJbYGFeWFNKRj81Ly4wNj9JVV5fXFtWUEdBODIvLjM8RlJbYF9cVlBHRD42MC4uMzpESFJbYGFeWFNKRj81Ly4wNj9JVV5fXFtWUEdBODIvLjM8RlJbYF9cVlBHRD42MC4uMzpESFJbYGFeWFNKRj81Ly4wNj9JVQ==',
  },
};

export const APPROVED_OVERLAY_ASSETS: Record<string, ApprovedOverlayAsset> = {
  assistant_generic_overlay: {
    id: 'assistant_generic_overlay',
    label: 'Assistant Overlay',
    dataUrl: makeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" width="720" height="240" viewBox="0 0 720 240">
        <defs>
          <linearGradient id="assistantGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#1f2937" />
            <stop offset="100%" stop-color="#0f766e" />
          </linearGradient>
        </defs>
        <rect x="12" y="12" width="696" height="216" rx="36" fill="url(#assistantGradient)" opacity="0.92" />
        <rect x="28" y="28" width="664" height="184" rx="28" fill="none" stroke="#ecfeff" stroke-width="4" opacity="0.72" />
        <circle cx="96" cy="120" r="36" fill="#ecfeff" opacity="0.95" />
        <path d="M78 121h36M96 103v36" stroke="#0f766e" stroke-width="10" stroke-linecap="round" />
        <text x="164" y="106" font-family="Segoe UI, Arial, sans-serif" font-size="40" fill="#ecfeff" font-weight="700">Assistant Automation</text>
        <text x="164" y="154" font-family="Segoe UI, Arial, sans-serif" font-size="24" fill="#d1fae5">Test sequence running</text>
      </svg>
    `),
  },
};
