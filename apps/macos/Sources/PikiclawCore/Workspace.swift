import Foundation

public enum WorkspaceTrustState: String, Codable, Sendable, CaseIterable {
    case unknown
    case trusted
    case restricted
    case revoked
}

public struct WorkspaceWorkflowConfig: Hashable, Codable, Sendable {
    public var branchNamePattern: String
    public var baseBranchName: String?
    public var codingPromptTemplate: String
    public var reviewPromptTemplate: String

    public init(
        branchNamePattern: String = Self.defaultBranchNamePattern,
        baseBranchName: String? = nil,
        codingPromptTemplate: String = Self.defaultCodingPromptTemplate,
        reviewPromptTemplate: String = Self.defaultReviewPromptTemplate
    ) {
        self.branchNamePattern = branchNamePattern
        self.baseBranchName = baseBranchName
        self.codingPromptTemplate = codingPromptTemplate
        self.reviewPromptTemplate = reviewPromptTemplate
    }

    public static let defaultBranchNamePattern = "{ticket}"

    public static let defaultCodingPromptTemplate = """
    Start the Coding action for {ticket}.

    Use the confirmed Solution Output checkpoint below as the implementation plan. Work in workspace `{workspace}`. Suggested branch: `{suggestedBranch}`. Preferred base branch: `{baseBranch}`. Current branch: `{currentBranch}`.

    Do not restart requirement discovery or re-litigate the solution unless the checkpoint is missing, contradicted, or unsafe. Before editing, verify whether the current branch is suitable. If a new branch or base branch needs confirmation, ask with the exact suggested branch and base branch choices first. Once the branch boundary is clear, implement the smallest code change that satisfies the plan, keep edits focused, and run the narrowest useful validation.

    Output formatting:
    - Use Markdown structure for final answers.
    - Wrap multi-line shell commands, commit instructions, logs, and file lists in fenced code blocks with an appropriate language such as ```bash or ```text.
    - Use inline code only for short commands, filenames, branch names, and identifiers.

    Ticket:
    {title}

    Solution Output checkpoint:
    {output}

    Context:
    {context}
    """

    public static let defaultReviewPromptTemplate = """
    Review the completed coding work for {ticket}.

    Explain the changed code files, what changed in each file, why the change was needed, and which validation was run or still missing. Use a review stance: call out bugs, regressions, risky behavior, and missing tests before summary. Do not edit files during this review pass.

    Output formatting:
    - Use Markdown structure for final answers.
    - Wrap multi-line shell commands, commit instructions, logs, and file lists in fenced code blocks with an appropriate language such as ```bash or ```text.
    - Use inline code only for short commands, filenames, branch names, and identifiers.

    Ticket:
    {title}

    Latest coding output:
    {output}

    Context:
    {context}
    """
}

public struct Workspace: Identifiable, Hashable, Codable, Sendable {
    public var id: EntityID
    public var name: String
    public var pathDisplay: String
    public var kind: String
    public var createdAt: Date
    public var lastOpenedAt: Date?
    public var gitRemote: String?
    public var currentBranch: String?
    public var trustState: WorkspaceTrustState
    public var instructionsRef: EntityID?
    public var defaultAgentProfileId: EntityID?
    public var workflowConfig: WorkspaceWorkflowConfig?

    public init(
        id: EntityID = EntityID(),
        name: String,
        pathDisplay: String,
        kind: String = "repo",
        createdAt: Date = Date(),
        lastOpenedAt: Date? = nil,
        gitRemote: String? = nil,
        currentBranch: String? = nil,
        trustState: WorkspaceTrustState = .unknown,
        instructionsRef: EntityID? = nil,
        defaultAgentProfileId: EntityID? = nil,
        workflowConfig: WorkspaceWorkflowConfig? = nil
    ) {
        self.id = id
        self.name = name
        self.pathDisplay = pathDisplay
        self.kind = kind
        self.createdAt = createdAt
        self.lastOpenedAt = lastOpenedAt
        self.gitRemote = gitRemote
        self.currentBranch = currentBranch
        self.trustState = trustState
        self.instructionsRef = instructionsRef
        self.defaultAgentProfileId = defaultAgentProfileId
        self.workflowConfig = workflowConfig
    }
}
