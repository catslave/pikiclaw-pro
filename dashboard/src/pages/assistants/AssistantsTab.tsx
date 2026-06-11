import { ProAssistantsSection, ProAutomationSection } from '../agents/ProAgentWorkflowSection';

export function AssistantsTab() {
  return (
    <div className="animate-in space-y-4">
      <ProAssistantsSection />
      <ProAutomationSection />
    </div>
  );
}

export default AssistantsTab;
