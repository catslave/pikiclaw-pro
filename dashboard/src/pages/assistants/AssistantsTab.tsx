import { ProAssistantsSection, ProAutomationSection } from '../agents/ProAgentWorkflowSection';

export function AssistantsTab({
  initialEditAssistantId,
  onInitialEditConsumed,
}: {
  initialEditAssistantId?: string | null;
  onInitialEditConsumed?: () => void;
} = {}) {
  return (
    <div className="animate-in space-y-4">
      <ProAssistantsSection
        initialEditAssistantId={initialEditAssistantId}
        onInitialEditConsumed={onInitialEditConsumed}
      />
      <ProAutomationSection />
    </div>
  );
}

export default AssistantsTab;
