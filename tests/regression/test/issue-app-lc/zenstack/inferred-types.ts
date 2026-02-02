// Generated types
import type { Required } from 'utility-types'

import type {
  Account,
  Activity,
  ActivityStaffAssignment,
  ActivityStaffRequirement,
  ActivityType,
  AiAgent,
  AiEmbedding,
  AiMessage,
  AiThread,
  AiThreadSetup,
  AiTool,
  Attendance,
  Board,
  BoardColumn,
  BoardLayout,
  BoardOnOrganization,
  Claim,
  Comment,
  Contact,
  Credential,
  CustomField,
  DynamicGrid,
  DynamicGridDesignItem,
  DynamicGridSection,
  EmailTemplate,
  Enumerator,
  EnumeratorOption,
  File,
  Instance,
  LaborRule,
  Log,
  Note,
  Organization,
  Page,
  Planning,
  PlanningStage,
  PlanningStageOnPlanning,
  PlanningStageRule,
  Project,
  Role,
  Secret,
  ServiceAccount,
  Sprint,
  Structure,
  StructureItem,
  TableLayout,
  Tag,
  Task,
  TaskAssignment,
  Translation,
  User,
  UserInvitation,
  UserOnOrganization,
  UserOptions,
  Workflow,
} from './models'

export type AccountFull = Required<Partial<Account>, 'id'> & {
  credentials?: Required<Partial<CredentialFull>, 'id'>[]
  ownedInstances?: Required<Partial<InstanceFull>, 'id'>[]
  users?: Required<Partial<UserFull>, 'id'>[]
  secrets?: Required<Partial<SecretFull>, 'id'>[]
}

export type ActivityFull = Required<Partial<Activity>, 'id'> & {
  type?: Required<Partial<ActivityTypeFull>, 'id'>
  attendance?: Required<Partial<AttendanceFull>, 'id'>[]
  organization?: Required<Partial<OrganizationFull>, 'id'>
  planning?: Required<Partial<PlanningFull>, 'id'>
  staffRequirements?: Required<Partial<ActivityStaffRequirementFull>, 'id'>[]
  tasks?: Required<Partial<TaskFull>, 'id'>[]
  tags?: Required<Partial<TagFull>, 'id'>[]
  user?: Required<Partial<UserFull>, 'id'>
}

export type ActivityStaffAssignmentFull = Required<Partial<ActivityStaffAssignment>, 'id'> & {
  activityStaffRequirement?: Required<Partial<ActivityStaffRequirementFull>, 'id'>
  notes?: Required<Partial<NoteFull>, 'id'>[]
  user?: Required<Partial<UserFull>, 'id'>
}

export type ActivityStaffRequirementFull = Required<Partial<ActivityStaffRequirement>, 'id'> & {
  activity?: Required<Partial<ActivityFull>, 'id'>
  usersOnActivityStaffRequirements?: Required<Partial<ActivityStaffAssignmentFull>, 'id'>[]
}

export type ActivityTypeFull = Required<Partial<ActivityType>, 'id'> & {
  activities?: Required<Partial<ActivityFull>, 'id'>[]
  instance?: Required<Partial<InstanceFull>, 'id'>
}

export type AiAgentFull = Required<Partial<AiAgent>, 'id'> & {
  embeddings?: Required<Partial<AiEmbeddingFull>, 'id'>[]
  instance?: Required<Partial<InstanceFull>, 'id'>
  tools?: Required<Partial<AiToolFull>, 'id'>[]
}

export type AiEmbeddingFull = Required<Partial<AiEmbedding>, 'id'> & {
  agents?: Required<Partial<AiAgentFull>, 'id'>[]
  structureItem?: Required<Partial<StructureItemFull>, 'id'>
  thread?: Required<Partial<AiThreadFull>, 'id'>
  files?: Required<Partial<FileFull>, 'id'>[]
  instance?: Required<Partial<InstanceFull>, 'id'>
  user?: Required<Partial<UserFull>, 'id'>
}

export type AiMessageFull = Required<Partial<AiMessage>, 'id'> & {
  files?: Required<Partial<FileFull>, 'id'>[]
  thread?: Required<Partial<AiThreadFull>, 'id'>
}

export type AiThreadFull = Required<Partial<AiThread>, 'id'> & {
  embeddings?: Required<Partial<AiEmbeddingFull>, 'id'>[]
  instance?: Required<Partial<InstanceFull>, 'id'>
  messages?: Required<Partial<AiMessageFull>, 'id'>[]
  user?: Required<Partial<UserFull>, 'id'>
}

export type AiThreadSetupFull = Required<Partial<AiThreadSetup>, 'id'> & {
  instance?: Required<Partial<InstanceFull>, 'id'>
}

export type AiToolFull = Required<Partial<AiTool>, 'id'> & {
  agents?: Required<Partial<AiAgentFull>, 'id'>[]
  instance?: Required<Partial<InstanceFull>, 'id'>
}

export type AttendanceFull = Required<Partial<Attendance>, 'id'> & {
  activity?: Required<Partial<ActivityFull>, 'id'>
  notes?: Required<Partial<NoteFull>, 'id'>[]
  category?: Required<Partial<EnumeratorOptionFull>, 'id'>
  project?: Required<Partial<ProjectFull>, 'id'>
  task?: Required<Partial<TaskFull>, 'id'>
  user?: Required<Partial<UserFull>, 'id'>
}

export type BoardFull = Required<Partial<Board>, 'id'> & {
  columns?: Required<Partial<BoardColumnFull>, 'id'>[]
  documents?: Required<Partial<FileFull>, 'id'>[]
  instance?: Required<Partial<InstanceFull>, 'id'>
  layouts?: Required<Partial<BoardLayoutFull>, 'id'>[]
  organizations?: Required<Partial<BoardOnOrganizationFull>, 'id'>[]
  sprints?: Required<Partial<SprintFull>, 'id'>[]
  tasks?: Required<Partial<TaskFull>, 'id'>[]
}

export type BoardColumnFull = Required<Partial<BoardColumn>, 'id'> & {
  board?: Required<Partial<BoardFull>, 'id'>
  statuses?: Required<Partial<EnumeratorOptionFull>, 'id'>[]
}

export type BoardLayoutFull = Required<Partial<BoardLayout>, 'id'> & {
  board?: Required<Partial<BoardFull>, 'id'>
}

export type BoardOnOrganizationFull = Required<Partial<BoardOnOrganization>, 'id'> & {
  board?: Required<Partial<BoardFull>, 'id'>
  organization?: Required<Partial<OrganizationFull>, 'id'>
}

export type ClaimFull = Required<Partial<Claim>, 'id'> & {
  roles?: Required<Partial<RoleFull>, 'id'>[]
  requiredRoles?: Required<Partial<RoleFull>, 'id'>[]
}

export type CommentFull = Required<Partial<Comment>, 'id'> & {
  children?: Required<Partial<CommentFull>, 'id'>[]
  files?: Required<Partial<FileFull>, 'id'>[]
  instance?: Required<Partial<InstanceFull>, 'id'>
  parent?: Required<Partial<CommentFull>, 'id'>
  task?: Required<Partial<TaskFull>, 'id'>
}

export type ContactFull = Required<Partial<Contact>, 'id'> & {
  type?: Required<Partial<EnumeratorOptionFull>, 'id'>
  user?: Required<Partial<UserFull>, 'id'>
}

export type CredentialFull = Required<Partial<Credential>, 'id'> & {
  account?: Required<Partial<AccountFull>, 'id'>
}

export type CustomFieldFull = Required<Partial<CustomField>, 'id'> & {
  instance?: Required<Partial<InstanceFull>, 'id'>
}

export type DynamicGridFull = Required<Partial<DynamicGrid>, 'id'> & {
  categories?: Required<Partial<EnumeratorOptionFull>, 'id'>[]
  children?: Required<Partial<DynamicGridFull>, 'id'>[]
  parents?: Required<Partial<DynamicGridFull>, 'id'>[]
  emailTemplate?: Required<Partial<EmailTemplateFull>, 'id'>
  files?: Required<Partial<FileFull>, 'id'>[]
  instance?: Required<Partial<InstanceFull>, 'id'>
  organization?: Required<Partial<OrganizationFull>, 'id'>
  pages?: Required<Partial<PageFull>, 'id'>[]
  structureItem?: Required<Partial<StructureItemFull>, 'id'>
}

export type DynamicGridDesignItemFull = Required<Partial<DynamicGridDesignItem>, 'id'> & {
  instance?: Required<Partial<InstanceFull>, 'id'>
}

export type DynamicGridSectionFull = Required<Partial<DynamicGridSection>, 'id'> & {
  instance?: Required<Partial<InstanceFull>, 'id'>
}

export type EmailTemplateFull = Required<Partial<EmailTemplate>, 'id'> & {
  bodyGrid?: Required<Partial<DynamicGridFull>, 'id'>
  instance?: Required<Partial<InstanceFull>, 'id'>
  files?: Required<Partial<FileFull>, 'id'>[]
}

export type EnumeratorFull = Required<Partial<Enumerator>, 'id'> & {
  instance?: Required<Partial<InstanceFull>, 'id'>
  options?: Required<Partial<EnumeratorOptionFull>, 'id'>[]
}

export type EnumeratorOptionFull = Required<Partial<EnumeratorOption>, 'id'> & {
  attendanceCategories?: Required<Partial<AttendanceFull>, 'id'>[]
  boardColumns?: Required<Partial<BoardColumnFull>, 'id'>[]
  contacts?: Required<Partial<ContactFull>, 'id'>[]
  dynamicGrids?: Required<Partial<DynamicGridFull>, 'id'>[]
  enumerator?: Required<Partial<EnumeratorFull>, 'id'>
  secretTypes?: Required<Partial<SecretFull>, 'id'>[]
  tasksPriorities?: Required<Partial<TaskFull>, 'id'>[]
  tasksStatuses?: Required<Partial<TaskFull>, 'id'>[]
  taskTypes?: Required<Partial<TaskFull>, 'id'>[]
  workflows?: Required<Partial<WorkflowFull>, 'id'>[]
}

export type FileFull = Required<Partial<File>, 'id'> & {
  board?: Required<Partial<BoardFull>, 'id'>
  comments?: Required<Partial<CommentFull>, 'id'>[]
  aiEmbeddings?: Required<Partial<AiEmbeddingFull>, 'id'>[]
  dynamicGrid?: Required<Partial<DynamicGridFull>, 'id'>
  emailTemplates?: Required<Partial<EmailTemplateFull>, 'id'>[]
  instance?: Required<Partial<InstanceFull>, 'id'>
  aiMessages?: Required<Partial<AiMessageFull>, 'id'>[]
  structureItems?: Required<Partial<StructureItemFull>, 'id'>[]
  task?: Required<Partial<TaskFull>, 'id'>
  user?: Required<Partial<UserFull>, 'id'>
}

export type InstanceFull = Required<Partial<Instance>, 'id'> & {
  activityTypes?: Required<Partial<ActivityTypeFull>, 'id'>[]
  aiAgents?: Required<Partial<AiAgentFull>, 'id'>[]
  aiEmbeddings?: Required<Partial<AiEmbeddingFull>, 'id'>[]
  aiTools?: Required<Partial<AiToolFull>, 'id'>[]
  aiThreads?: Required<Partial<AiThreadFull>, 'id'>[]
  aiThreadSetups?: Required<Partial<AiThreadSetupFull>, 'id'>[]
  boards?: Required<Partial<BoardFull>, 'id'>[]
  comments?: Required<Partial<CommentFull>, 'id'>[]
  customFields?: Required<Partial<CustomFieldFull>, 'id'>[]
  dynamicGrids?: Required<Partial<DynamicGridFull>, 'id'>[]
  dynamicGridSections?: Required<Partial<DynamicGridSectionFull>, 'id'>[]
  dynamicGridDesignItems?: Required<Partial<DynamicGridDesignItemFull>, 'id'>[]
  emailTemplates?: Required<Partial<EmailTemplateFull>, 'id'>[]
  enumerators?: Required<Partial<EnumeratorFull>, 'id'>[]
  invitations?: Required<Partial<UserInvitationFull>, 'id'>[]
  laborRules?: Required<Partial<LaborRuleFull>, 'id'>[]
  logo?: Required<Partial<FileFull>, 'id'>
  notes?: Required<Partial<NoteFull>, 'id'>[]
  owner?: Required<Partial<AccountFull>, 'id'>
  organizations?: Required<Partial<OrganizationFull>, 'id'>[]
  pages?: Required<Partial<PageFull>, 'id'>[]
  planning?: Required<Partial<PlanningFull>, 'id'>[]
  planningStages?: Required<Partial<PlanningStageFull>, 'id'>[]
  planningStageRules?: Required<Partial<PlanningStageRuleFull>, 'id'>[]
  projects?: Required<Partial<ProjectFull>, 'id'>[]
  roles?: Required<Partial<RoleFull>, 'id'>[]
  secrets?: Required<Partial<SecretFull>, 'id'>[]
  structures?: Required<Partial<StructureFull>, 'id'>[]
  tags?: Required<Partial<TagFull>, 'id'>[]
  tasks?: Required<Partial<TaskFull>, 'id'>[]
  translations?: Required<Partial<TranslationFull>, 'id'>[]
  users?: Required<Partial<UserFull>, 'id'>[]
  workflows?: Required<Partial<WorkflowFull>, 'id'>[]
}

export type LaborRuleFull = Required<Partial<LaborRule>, 'id'> & {
  instance?: Required<Partial<InstanceFull>, 'id'>
  organizations?: Required<Partial<OrganizationFull>, 'id'>[]
}

export type LogFull = Required<Partial<Log>, 'id'> & {
}

export type NoteFull = Required<Partial<Note>, 'id'> & {
  activityStaffAssignment?: Required<Partial<ActivityStaffAssignmentFull>, 'id'>
  instance?: Required<Partial<InstanceFull>, 'id'>
  attendance?: Required<Partial<AttendanceFull>, 'id'>
}

export type OrganizationFull = Required<Partial<Organization>, 'id'> & {
  activities?: Required<Partial<ActivityFull>, 'id'>[]
  boards?: Required<Partial<BoardOnOrganizationFull>, 'id'>[]
  instance?: Required<Partial<InstanceFull>, 'id'>
  parent?: Required<Partial<OrganizationFull>, 'id'>
  children?: Required<Partial<OrganizationFull>, 'id'>[]
  dynamicGrids?: Required<Partial<DynamicGridFull>, 'id'>[]
  laborRules?: Required<Partial<LaborRuleFull>, 'id'>[]
  users?: Required<Partial<UserOnOrganizationFull>, 'id'>[]
}

export type PageFull = Required<Partial<Page>, 'id'> & {
  dynamicGrid?: Required<Partial<DynamicGridFull>, 'id'>
  instance?: Required<Partial<InstanceFull>, 'id'>
  favoritedBy?: Required<Partial<UserFull>, 'id'>[]
}

export type PlanningFull = Required<Partial<Planning>, 'id'> & {
  activities?: Required<Partial<ActivityFull>, 'id'>[]
  instance?: Required<Partial<InstanceFull>, 'id'>
  planningStagesOnPlanning?: Required<Partial<PlanningStageOnPlanningFull>, 'id'>[]
}

export type PlanningStageFull = Required<Partial<PlanningStage>, 'id'> & {
  instance?: Required<Partial<InstanceFull>, 'id'>
  planningStagesOnPlanning?: Required<Partial<PlanningStageOnPlanningFull>, 'id'>[]
  planningStageRules?: Required<Partial<PlanningStageRuleFull>, 'id'>[]
}

export type PlanningStageOnPlanningFull = Required<Partial<PlanningStageOnPlanning>, 'id'> & {
  planning?: Required<Partial<PlanningFull>, 'id'>
  planningStage?: Required<Partial<PlanningStageFull>, 'id'>
}

export type PlanningStageRuleFull = Required<Partial<PlanningStageRule>, 'id'> & {
  instance?: Required<Partial<InstanceFull>, 'id'>
  planningStages?: Required<Partial<PlanningStageFull>, 'id'>[]
}

export type ProjectFull = Required<Partial<Project>, 'id'> & {
  attendance?: Required<Partial<AttendanceFull>, 'id'>[]
  instance?: Required<Partial<InstanceFull>, 'id'>
  tasks?: Required<Partial<TaskFull>, 'id'>[]
}

export type RoleFull = Required<Partial<Role>, 'id'> & {
  claims?: Required<Partial<ClaimFull>, 'id'>[]
  instance?: Required<Partial<InstanceFull>, 'id'>
  requiredClaims?: Required<Partial<ClaimFull>, 'id'>[]
  users?: Required<Partial<UserFull>, 'id'>[]
}

export type SecretFull = Required<Partial<Secret>, 'id'> & {
  account?: Required<Partial<AccountFull>, 'id'>
  type?: Required<Partial<EnumeratorOptionFull>, 'id'>
  instance?: Required<Partial<InstanceFull>, 'id'>
  users?: Required<Partial<UserFull>, 'id'>[]
}

export type ServiceAccountFull = Required<Partial<ServiceAccount>, 'id'> & {
  user?: Required<Partial<UserFull>, 'id'>
}

export type SprintFull = Required<Partial<Sprint>, 'id'> & {
  board?: Required<Partial<BoardFull>, 'id'>
  tasks?: Required<Partial<TaskFull>, 'id'>[]
}

export type StructureFull = Required<Partial<Structure>, 'id'> & {
  items?: Required<Partial<StructureItemFull>, 'id'>[]
  instance?: Required<Partial<InstanceFull>, 'id'>
}

export type StructureItemFull = Required<Partial<StructureItem>, 'id'> & {
  embeddings?: Required<Partial<AiEmbeddingFull>, 'id'>[]
  children?: Required<Partial<StructureItemFull>, 'id'>[]
  dynamicGrid?: Required<Partial<DynamicGridFull>, 'id'>
  file?: Required<Partial<FileFull>, 'id'>
  parent?: Required<Partial<StructureItemFull>, 'id'>
  structure?: Required<Partial<StructureFull>, 'id'>
}

export type TableLayoutFull = Required<Partial<TableLayout>, 'id'> & {
  user?: Required<Partial<UserFull>, 'id'>
}

export type TagFull = Required<Partial<Tag>, 'id'> & {
  activities?: Required<Partial<ActivityFull>, 'id'>[]
  instance?: Required<Partial<InstanceFull>, 'id'>
  tasks?: Required<Partial<TaskFull>, 'id'>[]
}

export type TaskFull = Required<Partial<Task>, 'id'> & {
  activity?: Required<Partial<ActivityFull>, 'id'>
  attendance?: Required<Partial<AttendanceFull>, 'id'>[]
  assignedTo?: Required<Partial<TaskAssignmentFull>, 'id'>[]
  board?: Required<Partial<BoardFull>, 'id'>
  children?: Required<Partial<TaskFull>, 'id'>[]
  comments?: Required<Partial<CommentFull>, 'id'>[]
  files?: Required<Partial<FileFull>, 'id'>[]
  instance?: Required<Partial<InstanceFull>, 'id'>
  parent?: Required<Partial<TaskFull>, 'id'>
  project?: Required<Partial<ProjectFull>, 'id'>
  priority?: Required<Partial<EnumeratorOptionFull>, 'id'>
  sprints?: Required<Partial<SprintFull>, 'id'>[]
  status?: Required<Partial<EnumeratorOptionFull>, 'id'>
  tags?: Required<Partial<TagFull>, 'id'>[]
  type?: Required<Partial<EnumeratorOptionFull>, 'id'>
}

export type TaskAssignmentFull = Required<Partial<TaskAssignment>, 'id'> & {
  user?: Required<Partial<UserFull>, 'id'>
  task?: Required<Partial<TaskFull>, 'id'>
}

export type TranslationFull = Required<Partial<Translation>, 'id'> & {
  instance?: Required<Partial<InstanceFull>, 'id'>
}

export type UserFull = Required<Partial<User>, 'id'> & {
  activities?: Required<Partial<ActivityFull>, 'id'>[]
  aiThreads?: Required<Partial<AiThreadFull>, 'id'>[]
  attendance?: Required<Partial<AttendanceFull>, 'id'>[]
  staffAssignments?: Required<Partial<ActivityStaffAssignmentFull>, 'id'>[]
  contacts?: Required<Partial<ContactFull>, 'id'>[]
  embeddings?: Required<Partial<AiEmbeddingFull>, 'id'>[]
  account?: Required<Partial<AccountFull>, 'id'>
  avatar?: Required<Partial<FileFull>, 'id'>
  favoritePages?: Required<Partial<PageFull>, 'id'>[]
  instance?: Required<Partial<InstanceFull>, 'id'>
  invitation?: Required<Partial<UserInvitationFull>, 'id'>
  organizations?: Required<Partial<UserOnOrganizationFull>, 'id'>[]
  options?: Required<Partial<UserOptionsFull>, 'id'>
  roles?: Required<Partial<RoleFull>, 'id'>[]
  serviceAccounts?: Required<Partial<ServiceAccountFull>, 'id'>[]
  tableLayouts?: Required<Partial<TableLayoutFull>, 'id'>[]
  tasks?: Required<Partial<TaskAssignmentFull>, 'id'>[]
  secrets?: Required<Partial<SecretFull>, 'id'>[]
}

export type UserInvitationFull = Required<Partial<UserInvitation>, 'id'> & {
  instance?: Required<Partial<InstanceFull>, 'id'>
  user?: Required<Partial<UserFull>, 'id'>
}

export type UserOnOrganizationFull = Required<Partial<UserOnOrganization>, 'id'> & {
  organization?: Required<Partial<OrganizationFull>, 'id'>
  user?: Required<Partial<UserFull>, 'id'>
}

export type UserOptionsFull = Required<Partial<UserOptions>, 'id'> & {
  user?: Required<Partial<UserFull>, 'id'>
}

export type WorkflowFull = Required<Partial<Workflow>, 'id'> & {
  instance?: Required<Partial<InstanceFull>, 'id'>
  enumeratorOptions?: Required<Partial<EnumeratorOptionFull>, 'id'>[]
}
