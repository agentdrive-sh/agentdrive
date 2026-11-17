// AgentDrive platform glyphs. Marks for known third parties come from
// simple-icons (CC0) or are inlined from each project's public brand assets.
// Used to communicate compatibility ("works with X") under nominative fair use.

import type { SVGProps } from 'react';
import {
  siClaude,
  siCursor,
  siLanggraph,
  siZedindustries,
  siModelcontextprotocol,
  siCrewai,
} from 'simple-icons';

export type PlatformId =
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'opencode'
  | 'gemini-cli'
  | 'antigravity'
  | 'langgraph'
  | 'crewai'
  | 'autogen'
  | 'cline'
  | 'continue'
  | 'zed'
  | 'hermes'
  | 'openclaw'
  | 'mcp'
  | 'unknown';

export interface PlatformMeta {
  label: string;
  short: string;
  color: string;
  bg: string;
}

export const PLATFORMS: Record<PlatformId, PlatformMeta> = {
  'claude-code': {
    label: 'Claude Code',
    short: 'CC',
    color: '#d97757',
    bg: '#3a2418',
  },
  codex: { label: 'Codex', short: 'CX', color: '#f4f4f5', bg: '#1f1f23' },
  cursor: { label: 'Cursor', short: 'CR', color: '#e5e5e5', bg: '#27272a' },
  opencode: { label: 'OpenCode', short: 'OP', color: '#f1ecec', bg: '#1f1f23' },
  'gemini-cli': { label: 'Gemini CLI', short: 'GM', color: '#1186fc', bg: '#1e1e2e' },
  antigravity: { label: 'Antigravity', short: 'AY', color: '#3186ff', bg: '#122338' },
  langgraph: {
    label: 'LangGraph',
    short: 'LG',
    color: '#7fc8ff',
    bg: '#13243a',
  },
  crewai: { label: 'CrewAI', short: 'CW', color: '#ff5a50', bg: '#3a1c1c' },
  autogen: { label: 'AutoGen', short: 'AG', color: '#f4f4f5', bg: '#2d2d2f' },
  cline: { label: 'Cline', short: 'CL', color: '#f4f4f5', bg: '#27272a' },
  continue: {
    label: 'Continue',
    short: 'CO',
    color: '#f4f4f5',
    bg: '#27272a',
  },
  zed: { label: 'Zed', short: 'ZD', color: '#f4f4f5', bg: '#27272a' },
  hermes: { label: 'Hermes', short: 'HM', color: '#f4f4f5', bg: '#0d1117' },
  openclaw: {
    label: 'OpenClaw',
    short: 'OC',
    color: '#ff4d4d',
    bg: '#2a1215',
  },
  mcp: { label: 'MCP', short: 'MC', color: '#f4f4f5', bg: '#1f1f23' },
  unknown: { label: 'Unknown', short: '??', color: '#71717a', bg: '#27272a' },
};

interface Mark {
  viewBox: string;
  // Paths without their own fill take the platform colour.
  paths: SVGProps<SVGPathElement>[];
}

const si = (icon: { path: string }): Mark => ({
  viewBox: '0 0 24 24',
  paths: [{ d: icon.path }],
});

// Each mark keeps the coordinates of its source file; viewBox crops it square.
// No official vector was found for Hermes, so it falls back to an initials badge.
const MARKS: Partial<Record<PlatformId, Mark>> = {
  // simple-icons, sourced from claude.ai.
  'claude-code': si(siClaude),
  // simple-icons, sourced from cursor.com/brand.
  cursor: si(siCursor),
  // simple-icons, sourced from zed-industries/zed assets/icons/logo_96.svg.
  zed: si(siZedindustries),
  // simple-icons, sourced from modelcontextprotocol/docs logo/light.svg.
  mcp: si(siModelcontextprotocol),
  langgraph: si(siLanggraph),
  crewai: si(siCrewai),
  // Codex ships under the OpenAI Blossom (openai.com/codex uses it as the app icon).
  // Path from the Blossom served at openai.com/favicon.svg.
  codex: {
    viewBox: '0 0 41 41',
    paths: [{ d: 'M37.5324 16.8707C37.9808 15.5241 38.1363 14.0974 37.9886 12.6859C37.8409 11.2744 37.3934 9.91076 36.676 8.68622C35.6126 6.83404 33.9882 5.3676 32.0373 4.4985C30.0864 3.62941 27.9098 3.40259 25.8215 3.85078C24.8796 2.7893 23.7219 1.94125 22.4257 1.36341C21.1295 0.785575 19.7249 0.491269 18.3058 0.500197C16.1708 0.495044 14.0893 1.16803 12.3614 2.42214C10.6335 3.67624 9.34853 5.44666 8.6917 7.47815C7.30085 7.76286 5.98686 8.3414 4.8377 9.17505C3.68854 10.0087 2.73073 11.0782 2.02839 12.312C0.956464 14.1591 0.498905 16.2988 0.721698 18.4228C0.944492 20.5467 1.83612 22.5449 3.268 24.1293C2.81966 25.4759 2.66413 26.9026 2.81182 28.3141C2.95951 29.7256 3.40701 31.0892 4.12437 32.3138C5.18791 34.1659 6.8123 35.6322 8.76321 36.5013C10.7141 37.3704 12.8907 37.5973 14.9789 37.1492C15.9208 38.2107 17.0786 39.0587 18.3747 39.6366C19.6709 40.2144 21.0755 40.5087 22.4946 40.4998C24.6307 40.5054 26.7133 39.8321 28.4418 38.5772C30.1704 37.3223 31.4556 35.5506 32.1119 33.5179C33.5027 33.2332 34.8167 32.6547 35.9659 31.821C37.115 30.9874 38.0728 29.9178 38.7752 28.684C39.8458 26.8371 40.3023 24.6979 40.0789 22.5748C39.8556 20.4517 38.9639 18.4544 37.5324 16.8707ZM22.4978 37.8849C20.7443 37.8874 19.0459 37.2733 17.6994 36.1501C17.7601 36.117 17.8666 36.0586 17.936 36.0161L25.9004 31.4156C26.1003 31.3019 26.2663 31.137 26.3813 30.9378C26.4964 30.7386 26.5563 30.5124 26.5549 30.2825V19.0542L29.9213 20.998C29.9389 21.0068 29.9541 21.0198 29.9656 21.0359C29.977 21.052 29.9842 21.0707 29.9867 21.0902V30.3889C29.9842 32.375 29.1946 34.2791 27.7909 35.6841C26.3872 37.0892 24.4838 37.8806 22.4978 37.8849ZM6.39227 31.0064C5.51397 29.4888 5.19742 27.7107 5.49804 25.9832C5.55718 26.0187 5.66048 26.0818 5.73461 26.1244L13.699 30.7248C13.8975 30.8408 14.1233 30.902 14.3532 30.902C14.583 30.902 14.8088 30.8408 15.0073 30.7248L24.731 25.1103V28.9979C24.7321 29.0177 24.7283 29.0376 24.7199 29.0556C24.7115 29.0736 24.6988 29.0893 24.6829 29.1012L16.6317 33.7497C14.9096 34.7416 12.8643 35.0097 10.9447 34.4954C9.02506 33.9811 7.38785 32.7263 6.39227 31.0064ZM4.29707 13.6194C5.17156 12.0998 6.55279 10.9364 8.19885 10.3327C8.19885 10.4013 8.19491 10.5228 8.19491 10.6071V19.808C8.19351 20.0378 8.25334 20.2638 8.36823 20.4629C8.48312 20.6619 8.64893 20.8267 8.84863 20.9404L18.5723 26.5542L15.206 28.4979C15.1894 28.5089 15.1703 28.5155 15.1505 28.5173C15.1307 28.5191 15.1107 28.516 15.0924 28.5082L7.04046 23.8557C5.32135 22.8601 4.06716 21.2235 3.55289 19.3046C3.03862 17.3858 3.30624 15.3413 4.29707 13.6194ZM31.955 20.0556L22.2312 14.4411L25.5976 12.4981C25.6142 12.4872 25.6333 12.4805 25.6531 12.4787C25.6729 12.4769 25.6928 12.4801 25.7111 12.4879L33.7631 17.1364C34.9967 17.849 36.0017 18.8982 36.6606 20.1613C37.3194 21.4244 37.6047 22.849 37.4832 24.2684C37.3617 25.6878 36.8382 27.0432 35.9743 28.1759C35.1103 29.3086 33.9415 30.1717 32.6047 30.6641C32.6047 30.5947 32.6047 30.4733 32.6047 30.3889V21.188C32.6066 20.9586 32.5474 20.7328 32.4332 20.5338C32.319 20.3348 32.154 20.1698 31.955 20.0556ZM35.3055 15.0128C35.2464 14.9765 35.1431 14.9142 35.069 14.8717L27.1045 10.2712C26.906 10.1554 26.6803 10.0943 26.4504 10.0943C26.2206 10.0943 25.9948 10.1554 25.7963 10.2712L16.0726 15.8858V11.9982C16.0715 11.9783 16.0753 11.9585 16.0837 11.9405C16.0921 11.9225 16.1048 11.9068 16.1207 11.8949L24.1719 7.25025C25.4053 6.53903 26.8158 6.19376 28.2383 6.25482C29.6608 6.31589 31.0364 6.78077 32.2044 7.59508C33.3723 8.40939 34.2842 9.53945 34.8334 10.8531C35.3826 12.1667 35.5464 13.6095 35.3055 15.0128ZM14.2424 21.9419L10.8752 19.9981C10.8576 19.9893 10.8423 19.9763 10.8309 19.9602C10.8195 19.9441 10.8122 19.9254 10.8098 19.9058V10.6071C10.8107 9.18295 11.2173 7.78848 11.9819 6.58696C12.7466 5.38544 13.8377 4.42659 15.1275 3.82264C16.4173 3.21869 17.8524 2.99464 19.2649 3.1767C20.6775 3.35876 22.0089 3.93941 23.1034 4.85067C23.0427 4.88379 22.937 4.94215 22.8668 4.98473L14.9024 9.58517C14.7025 9.69878 14.5366 9.86356 14.4215 10.0626C14.3065 10.2616 14.2466 10.4877 14.2479 10.7175L14.2424 21.9419ZM16.071 17.9991L20.4018 15.4978L24.7325 17.9975V22.9985L20.4018 25.4983L16.071 22.9985V17.9991Z' }],
  },
  // anomalyco/opencode packages/console/app/src/asset/brand/opencode-logo-dark-square.svg
  opencode: {
    viewBox: '-30 0 300 300',
    paths: [
      { d: 'M180 240H60V120H180V240Z', fill: '#4b4646' },
      { d: 'M180 60H60V240H180V60ZM240 300H0V0H240V300Z' },
    ],
  },
  // No vector is published; geometry measured from the official 1645px icon at
  // geminicli.com/icon.png (rounded-square frame + prompt chevron), drawn in its base blue.
  'gemini-cli': {
    viewBox: '0 0 1645 1645',
    paths: [
      {
        fillRule: 'evenodd',
        d: 'M300 0H1345A300 300 0 0 1 1645 300V1345A300 300 0 0 1 1345 1645H300A300 300 0 0 1 0 1345V300A300 300 0 0 1 300 0ZM300 97A203 203 0 0 0 97 300V1345A203 203 0 0 0 300 1548H1345A203 203 0 0 0 1548 1345V300A203 203 0 0 0 1345 97Z',
      },
      { d: 'M494 398L1152 715V970L494 1286V1097L1023 842L494 588Z' },
    ],
  },
  // antigravity.google/favicon.svg, arch shape in its base #3186FF (the gradient mesh is dropped).
  antigravity: {
    viewBox: '11 12 90 90',
    paths: [{ d: 'M89.6992 93.695C94.3659 97.195 101.366 94.8617 94.9492 88.445C75.6992 69.7783 79.7825 18.445 55.8659 18.445C31.9492 18.445 36.0325 69.7783 16.7825 88.445C9.78251 95.445 17.3658 97.195 22.0325 93.695C40.1159 81.445 38.9492 59.8617 55.8659 59.8617C72.7825 59.8617 71.6159 81.445 89.6992 93.695Z' }],
  },
  // Header logo on cline.bot: head path with the eye cut-outs from its mask.
  cline: {
    viewBox: '0 0 112 112',
    paths: [
      {
        fillRule: 'evenodd',
        d: 'M56 6.39844C62.0667 6.39844 66.4004 10.8825 66.4004 16.4609C66.4003 18.0033 66.0624 20.0605 65.5117 22.3984H83.0117C88.4176 22.3984 92.7997 26.7807 92.7998 32.1865V45.8643L105.068 58.6445C105.365 58.9541 105.366 59.4434 105.068 59.7529L92.7998 72.5312V86.21C92.7998 91.6159 88.4176 95.998 83.0117 95.998H28.9883C23.5824 95.998 19.2002 91.6158 19.2002 86.21V72.5312L6.93164 59.7529C6.63461 59.4434 6.63474 58.9541 6.93164 58.6445L19.2002 45.8643V32.1865C19.2003 26.7807 23.5825 22.3985 28.9883 22.3984H46.4883C45.9376 20.0605 45.5997 18.0033 45.5996 16.4609C45.5996 10.8826 49.9334 6.39851 56 6.39844ZM40.91 44.7988A5.2 5.2 0 0 1 46.11 49.9988V68.3986A5.2 5.2 0 0 1 35.71 68.3986V49.9988A5.2 5.2 0 0 1 40.91 44.7988ZM70.5096 44.7988A5.2 5.2 0 0 1 75.7096 49.9988V68.3986A5.2 5.2 0 0 1 65.3096 68.3986V49.9988A5.2 5.2 0 0 1 70.5096 44.7988Z',
      },
    ],
  },
  // continuedev/continue extensions/intellij/src/main/resources/META-INF/pluginIcon.svg
  continue: {
    viewBox: '70 65 170 170',
    paths: [{ d: 'M206.97 92.7966L197.78 108.729L221.009 148.932C221.179 149.237 221.281 149.61 221.281 149.949C221.281 150.288 221.179 150.661 221.009 150.966L197.78 191.203L206.97 207.136L240 149.949L206.97 92.7627V92.7966ZM194.219 106.661L203.409 90.7288H185.029L175.839 106.661H194.253H194.219ZM175.805 110.797L197.271 147.915H215.651L194.219 110.797H175.805ZM194.219 189.169L215.651 152.017H197.271L175.805 189.169H194.219ZM175.805 193.305L184.995 209.169H203.375L194.185 193.305H175.771H175.805ZM113.509 213.102C113.136 213.102 112.797 213 112.492 212.83C112.186 212.661 111.915 212.39 111.745 212.085L88.4819 171.847H70.1017L103.132 229H169.158L159.968 213.102H113.543H113.509ZM163.529 211.034L172.719 226.932L181.909 211L172.719 195.068L163.529 211V211.034ZM169.158 193.034H126.294L117.104 208.966H159.968L169.158 193.034ZM122.699 191L101.233 153.847L92.0427 169.78L113.509 206.932L122.699 191ZM70.0678 167.712H88.448L97.6381 151.78H79.2918L70.0678 167.712ZM111.644 87.9491C111.813 87.6441 112.085 87.3729 112.39 87.2034C112.695 87.0339 113.068 86.9322 113.407 86.9322H159.9L169.09 71H103.03L70 128.186H88.3802L111.576 87.9831L111.644 87.9491ZM97.6381 148.22L88.448 132.288H70.0678L79.2579 148.22H97.6381ZM113.441 93.1017L92.0088 130.22L101.199 146.153L122.631 109.034L113.441 93.1017ZM159.934 91.0339H117.002L126.192 106.966H169.124L159.934 91.0339ZM172.719 104.898L181.875 89L172.719 73.0678L163.529 88.9661L172.719 104.898Z' }],
  },
  // microsoft/autogen python/docs/src/_static/images/logo/logo.svg (letters only).
  autogen: {
    viewBox: '15 8.5 63 63',
    paths: [{ d: 'M32.6484 28.7109L23.3672 57H15.8906L28.5703 22.875H33.3281L32.6484 28.7109ZM40.3594 57L31.0547 28.7109L30.3047 22.875H35.1094L47.8594 57H40.3594ZM39.9375 44.2969V49.8047H21.9141V44.2969H39.9375ZM77.6484 39.1641V52.6875C77.1172 53.3281 76.2969 54.0234 75.1875 54.7734C74.0781 55.5078 72.6484 56.1406 70.8984 56.6719C69.1484 57.2031 67.0312 57.4688 64.5469 57.4688C62.3438 57.4688 60.3359 57.1094 58.5234 56.3906C56.7109 55.6562 55.1484 54.5859 53.8359 53.1797C52.5391 51.7734 51.5391 50.0547 50.8359 48.0234C50.1328 45.9766 49.7812 43.6406 49.7812 41.0156V38.8828C49.7812 36.2578 50.1172 33.9219 50.7891 31.875C51.4766 29.8281 52.4531 28.1016 53.7188 26.6953C54.9844 25.2891 56.4922 24.2188 58.2422 23.4844C59.9922 22.75 61.9375 22.3828 64.0781 22.3828C67.0469 22.3828 69.4844 22.8672 71.3906 23.8359C73.2969 24.7891 74.75 26.1172 75.75 27.8203C76.7656 29.5078 77.3906 31.4453 77.625 33.6328H70.8047C70.6328 32.4766 70.3047 31.4688 69.8203 30.6094C69.3359 29.75 68.6406 29.0781 67.7344 28.5938C66.8438 28.1094 65.6875 27.8672 64.2656 27.8672C63.0938 27.8672 62.0469 28.1094 61.125 28.5938C60.2188 29.0625 59.4531 29.7578 58.8281 30.6797C58.2031 31.6016 57.7266 32.7422 57.3984 34.1016C57.0703 35.4609 56.9062 37.0391 56.9062 38.8359V41.0156C56.9062 42.7969 57.0781 44.375 57.4219 45.75C57.7656 47.1094 58.2734 48.2578 58.9453 49.1953C59.6328 50.1172 60.4766 50.8125 61.4766 51.2812C62.4766 51.75 63.6406 51.9844 64.9688 51.9844C66.0781 51.9844 67 51.8906 67.7344 51.7031C68.4844 51.5156 69.0859 51.2891 69.5391 51.0234C70.0078 50.7422 70.3672 50.4766 70.6172 50.2266V44.1797H64.1953V39.1641H77.6484Z' }],
  },
  // openclaw/openclaw ui/public/favicon.svg, first animation frame, gradient flattened.
  openclaw: {
    viewBox: '0 0 120 120',
    paths: [
      { d: 'M60 10 C30 10 15 35 15 55 C15 75 30 95 45 100 L45 110 L55 110 L55 100 C55 100 60 102 65 100 L65 110 L75 110 L75 100 C90 95 105 75 105 55 C105 35 90 10 60 10Z' },
      { d: 'M20 45 C5 40 0 50 5 60 C10 70 20 65 25 55 C28 48 25 45 20 45Z' },
      { d: 'M100 45 C115 40 120 50 115 60 C110 70 100 65 95 55 C92 48 95 45 100 45Z' },
      { d: 'M45 15 Q35 5 30 8M75 15 Q85 5 90 8', fill: 'none', stroke: '#ff4d4d', strokeWidth: 3, strokeLinecap: 'round' },
      { d: 'M39 35a6 6 0 1 0 12 0a6 6 0 1 0-12 0ZM69 35a6 6 0 1 0 12 0a6 6 0 1 0-12 0Z', fill: '#050810' },
      { d: 'M43.5 34a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0ZM73.5 34a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0Z', fill: '#00e5cc' },
    ],
  },
};

interface GlyphSVGProps {
  platform: PlatformId | string;
  size?: number;
}

export function GlyphSVG({ platform, size = 14 }: GlyphSVGProps) {
  const p = PLATFORMS[platform as PlatformId] ?? PLATFORMS.unknown;
  const mark = MARKS[platform as PlatformId];

  if (!mark) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        style={{ display: 'block' }}
        aria-hidden="true"
      >
        <rect x="2" y="2" width="20" height="20" rx="5" fill={p.color} />
        <text
          x="12"
          y="12.5"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontSize="14"
          fontWeight="700"
          fill={p.bg}
        >
          {p.short[0]}
        </text>
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={mark.viewBox}
      fill={p.color}
      style={{ display: 'block' }}
      aria-hidden="true"
    >
      {mark.paths.map((attrs, i) => (
        <path key={i} {...attrs} />
      ))}
    </svg>
  );
}

interface PlatformGlyphProps {
  platform: PlatformId | string;
  size?: number;
  withLabel?: boolean;
  withBg?: boolean;
}

export function PlatformGlyph({
  platform,
  size = 14,
  withLabel = false,
  withBg = true,
}: PlatformGlyphProps) {
  const p = PLATFORMS[platform as PlatformId] ?? PLATFORMS.unknown;
  const box = size + 6;
  const bgStyle = withBg
    ? { background: p.bg, border: `1px solid ${p.color}33` }
    : {};
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-xs)',
        fontWeight: 500,
        color: 'var(--text-1)',
      }}
    >
      <span
        style={{
          width: box,
          height: box,
          borderRadius: 5,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...bgStyle,
        }}
      >
        <GlyphSVG platform={platform} size={size} />
      </span>
      {withLabel && <span>{p.label}</span>}
    </span>
  );
}

interface PlatformChipProps {
  platform: PlatformId | string;
  lg?: boolean;
}

export function PlatformChip({ platform, lg = false }: PlatformChipProps) {
  const p = PLATFORMS[platform as PlatformId] ?? PLATFORMS.unknown;
  return (
    <span className={'glyph-chip' + (lg ? ' lg' : '')}>
      <span
        className="gx"
        style={{
          background: p.bg,
          border: `1px solid ${p.color}33`,
        }}
      >
        <GlyphSVG platform={platform} size={lg ? 14 : 11} />
      </span>
      {p.label}
    </span>
  );
}
