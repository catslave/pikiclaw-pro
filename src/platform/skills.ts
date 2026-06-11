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
    name: 'Log Skill',
    description: 'Query IVA/Nova logs or run a controlled trace for a lab/prod environment, then ask the agent to summarize abnormalities or classify log statistics. Defaults to lab and conversationId-based lookup.',
    category: 'observability',
    status: 'experimental',
    examples: [
      '/logtrace conversationId=conversation-uuid last=24h',
      '/logtrace search conversationId=conversation-uuid query="level:ERROR" last=2h',
      '/logtrace stats conversationId=conversation-uuid by=kubernetes.container.name last=24h',
      '/logtrace env=production sessionId=s-xxx last=7d symptom="agent stayed silent"',
    ],
  },
];

export function listPlatformSkills(): PlatformSkillInfo[] {
  return PLATFORM_SKILLS;
}

export function getPlatformSkill(id: string): PlatformSkillInfo | null {
  return PLATFORM_SKILLS.find(skill => skill.id === id) || null;
}
