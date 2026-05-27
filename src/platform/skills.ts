export type PlatformSkillCategory = 'observability' | 'dev' | 'productivity';

export interface PlatformSkillInfo {
  id: string;
  trigger: string;
  name: string;
  description: string;
  category: PlatformSkillCategory;
  status: 'ready' | 'experimental';
  examples: string[];
}

export const PLATFORM_SKILLS: PlatformSkillInfo[] = [
  {
    id: 'logtrace',
    trigger: '/logtrace',
    name: 'Log Trace',
    description: 'Run a controlled IVA/Nova log trace, then ask the agent to summarize the trace and analyze abnormalities.',
    category: 'observability',
    status: 'experimental',
    examples: [
      '/logtrace env=lab id=s-xxx last=24h',
      '/logtrace env=production id=conversation-uuid last=7d symptom="agent stayed silent"',
    ],
  },
];

export function listPlatformSkills(): PlatformSkillInfo[] {
  return PLATFORM_SKILLS;
}

export function getPlatformSkill(id: string): PlatformSkillInfo | null {
  return PLATFORM_SKILLS.find(skill => skill.id === id) || null;
}
