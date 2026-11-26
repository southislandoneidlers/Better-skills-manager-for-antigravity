import type {
  RelationReason,
  ScopeInfo,
  SkillSourceMeta,
  UiLang,
  ValidationIssue,
} from '../shared/types.ts';

export type { UiLang };

export function detectInitialLang(hostLocale?: string): UiLang {
  const loc = (hostLocale || (typeof navigator !== 'undefined' ? navigator.language : '') || '').toLowerCase();
  if (loc.startsWith('zh')) return 'zh-TW';
  return 'en';
}

export function toFileUri(absPath: string): string {
  const forward = absPath.replace(/\\/g, '/');
  const encoded = encodeURI(forward).replace(/#/g, '%23').replace(/\?/g, '%3F');
  if (/^[A-Za-z]:\//.test(forward)) {
    return `file:///${encoded}`;
  }
  if (forward.startsWith('//')) {
    return `file:${encoded}`;
  }
  return forward.startsWith('/') ? `file://${encoded}` : `file:///${encoded}`;
}

export function detectFileManagerLabel(lang: UiLang): string {
  if (typeof navigator !== 'undefined') {
    const ua = `${navigator.platform || ''} ${navigator.userAgent || ''}`.toLowerCase();
    if (ua.includes('win')) {
      return lang === 'zh-TW' ? '檔案總管' : 'Explorer';
    }
    if (ua.includes('mac')) {
      return 'Finder';
    }
    if (ua.includes('linux') || ua.includes('x11')) {
      return lang === 'zh-TW' ? '資料夾' : 'Files';
    }
  }
  return lang === 'zh-TW' ? '檔案總管' : 'Files';
}

export function detectMountPathPlaceholder(): string {
  if (typeof navigator !== 'undefined') {
    const ua = `${navigator.platform || ''} ${navigator.userAgent || ''}`.toLowerCase();
    if (ua.includes('win')) {
      return 'D:\\projects\\my-app';
    }
  }
  return '~/projects/my-app';
}

export const STRINGS = {
  en: {
    brand: 'Better-skills-manager',
    loadingTitle: 'Loading Better-skills-manager…',
    loadingDesc: 'Scanning local skills, conversation usage logs, and collaboration links',
    tabFinder: '🗂️ Files',
    tabAnalytics: '📊 Usage Timeline',
    tabGraph: '🕸️ Collaboration',
    searchPlaceholder: 'Search name, description, or folder…',
    checkingUpdates: 'Checking…',
    checkUpdates: '🔄 Check Updates',
    newSkillBtn: '+ New Skill',
    filterAll: 'All',
    filterEnabled: 'Enabled',
    filterDisabled: 'Disabled',
    filterIssues: '⚠️ Needs Fix',
    filterUpdates: '⬆️ Updates',
    foldersHeader: 'Locations & Folders',
    newFolderTitle: 'New category folder',
    mountBtn: '+Mount',
    mountTitle: 'Mount project or external directory',
    allMySkills: '🌟 All My Skills',
    allWithBuiltin: '📚 All (incl. Built-in)',
    colSkillDoc: 'Skill Document',
    colDates: 'Pub / Inst',
    colTotal: 'Total',
    col30d: '30d',
    colStatus: 'Status',
    noMatchingSkills: 'No skills match the current filter',
    noDesc: '(No description)',
    pubShort: 'Pub',
    instShort: 'Inst',
    badgeUpdate: 'Update',
    badgeLatest: 'Latest',
    badgeDisabled: 'Disabled',
    badgeOk: 'OK',
    emptySelectDoc: 'Select any skill on the left to read, edit, or manage its attachments',
    sortByTotal: 'Sort by Total Uses',
    sortBy30d: 'Sort by 30d Uses',
    sortByPub: 'Sort by Published Date',
    sortByInst: 'Sort by Installed Date',
    sortByName: 'Sort by Name A-Z',
    sortTotalShort: 'Total',
    sort30dShort: '30d',
    backBtn: '← Back',
    saving: 'Saving…',
    unsaved: 'Unsaved',
    saved: 'Auto-saved',
    toggleTipEnabled: 'Click to disable & archive',
    toggleTipDisabled: 'Click to re-enable',
    attachToChat: '📎 Attach to Chat',
    attachToChatTip: 'Attach this skill as chat context',
    copyToScope: '📋 Copy to…',
    copyToScopeTip: 'Copy this skill to another scope',
    revealFinder: 'Finder',
    revealFinderTip: 'Reveal folder in file manager',
    deleteBtn: 'Delete',
    confirmDelete: (name: string) => `Delete skill "${name}"? This removes its folder on disk.`,
    copyToLabel: 'Copy to:',
    publishedLabel: '📅 Published:',
    installedLabel: '📥 Installed:',
    sourceBuiltin: '🔒 Built-in',
    sourceGit: '🔗 Git Remote',
    sourceLocalDir: '📂 Local Upstream',
    sourceOriginal: '📍 Local Original',
    updateAvailable: '⬆️ Update Available',
    upToDate: '✅ Up to Date',
    applyUpdate: '⬆️ Update Now',
    sourceSettings: 'Source',
    folderLabel: '📁 Folder:',
    rootFolder: '(Root)',
    updateStatusPrefix: 'Status:',
    lastCheckedPrefix: 'Last checked:',
    sourceGitOpt: 'Git / GitHub URL',
    sourceLocalOpt: 'Local Upstream Folder',
    sourceOriginalOpt: 'Local Original (no upstream)',
    applyAndCheck: 'Apply & Check',
    subTabDoc: '📄 Document',
    subTabAttach: '📎 Attachments',
    subTabUsage: '📊 Usage',
    subTabRelations: '🔗 Related',
    healthOk: '✅ Valid — Frontmatter and relative attachment links are healthy',
    healthErr: '❌ Format Error (Action Required)',
    healthWarn: '⚠️ Format Suggestions',
    preservedYaml: (keys: string[]) => `Preserved extra YAML keys: ${keys.join(', ')}`,
    singleDocHint: 'Single-document view (automatically keeps valid SKILL.md structure)',
    modeForm: 'Form View',
    modeRaw: 'Raw SKILL.md',
    fieldSkillName: 'Skill ID (name)',
    fieldVersion: 'Version (optional)',
    fieldDescription: 'Trigger Description (tells the agent when to use this skill)',
    charsCount: (n: number) => `${n} chars`,
    fieldBody: 'Instructions & Workflow (Markdown)',
    openInEditor: 'Open in Editor Tab',
    saveRawBtn: 'Save Raw SKILL.md',
    attachIntro: 'All files in scripts/, references/, and examples/ are managed here',
    newAttachBtn: '+ Add Attachment',
    newAttachPlaceholder: 'e.g., scripts/setup.sh or references/api.md',
    createBtn: 'Create',
    noAttachMsg: 'No attachments yet. Click "+ Add Attachment" or link a file in the document to create one.',
    insertLinkBtn: 'Insert Link in Doc',
    binaryFileMsg: (size: number) => `Binary or media file (${size} bytes). Open via Finder to preview.`,
    saveAttachBtn: 'Save Attachment',
    selectAttachHint: 'Select an attachment on the left to preview or edit.',
    usageTotalCard: 'Total Uses',
    usage30dCard: 'Last 30 Days',
    usageIdleCard: 'Last Active',
    neverUsed: 'Never used',
    usedToday: 'Today',
    daysAgo: (d: number) => `${d}d ago`,
    usageEventsTitle: (n: number) => `Activation Timestamps (${n})`,
    noUsageEvents: 'No activation history recorded for this skill yet.',
    colTimestamp: 'Timestamp',
    colTriggerSource: 'Trigger',
    colConvId: 'Conversation',
    relationsIntro: 'Detected from explicit references, shared conversations, and domain overlap.',
    attachGroupBtn: '📎 Attach Group to Chat',
    noRelationsMsg: 'No explicit references, co-usage, or domain overlaps detected yet.',
    openSkillBtn: 'Open Skill →',
    relBasisPrefix: 'Basis:',
    heatmapDefaultTitle: '365-Day Activity Distribution',
    heatmapHover: (date: string, count: number) => `${date}: ${count} uses`,
    heatmapSummary: (total: number, days: number) => `${total} uses across ${days} active days in the past year`,
    analyticsGlobalHeatmap: 'Full Library 365-Day Usage Heatmap',
    analyticsTotalCard: 'Total Activations',
    analytics30dCard: 'Last 30 Days',
    analyticsActiveCard: 'Active Skills (30d)',
    analyticsIdleCard: 'Unused > 30 Days',
    analyticsDiagTitle: 'Usage Frequency & Idle Diagnostics',
    analyticsFilterAll: (n: number) => `All (${n})`,
    analyticsFilterActive: (n: number) => `Active 30d (${n})`,
    analyticsFilterIdle: (n: number) => `Idle (${n})`,
    colSkill: 'Skill',
    colScope: 'Location',
    colTotalUses: 'Total',
    col30dUses: '30d',
    colLastUsed: 'Last Used',
    colHealthState: 'Activity',
    idleDaysBadge: (d: number) => `Idle ${d}d`,
    activeBadge: 'Active',
    recentTimelineTitle: 'Recent Activation Timeline (Conversations & Panel)',
    noGlobalEvents: 'No conversation history detected yet. Activations appear here with exact timestamps.',
    srcReadFile: 'Agent Read',
    srcSlash: 'Slash /',
    srcMention: '@ Mention',
    srcPanelAttach: 'Panel Attach',
    graphTitle: '🕸️ Multi-Skill Collaboration Map',
    graphSubtitle: 'Highlights explicit references, co-used skills, shared toolchains, and overlapping trigger descriptions.',
    graphAll: (n: number) => `All (${n})`,
    graphRef: 'References',
    graphCoUsage: 'Co-used',
    graphOverlap: (n: number) => `⚠️ Overlap (${n})`,
    graphFocusBadge: (name: string) => `Filtering edges connected to "${name}"`,
    graphShowAll: 'Show All Nodes',
    graphEmptyNodes: 'No multi-skill relationships detected yet.',
    graphHint: 'Tip: Click a node to filter edges, double-click to open its document.',
    legendRef: '● Explicit Ref',
    legendCo: '● Co-used',
    legendDomain: '● Domain Similar',
    legendOverlap: '┈ Description Overlap',
    graphPairsTitle: (n: number) => `Collaboration Pairs (${n})`,
    graphNoPairs: 'No pairs match this filter.',
    modalNewSkillTitle: '+ New Skill Document',
    modalLocation: 'Target Location',
    modalFolder: 'Category Folder (optional, e.g. frontend/react)',
    modalFolderPlaceholder: 'Leave empty for root',
    modalSkillName: 'Skill Name',
    modalSkillNamePlaceholder: 'e.g. deploy-helper',
    modalSkillDesc: 'Trigger Description (when the agent should activate it)',
    modalSkillDescPlaceholder: 'e.g. Use when the user asks to deploy or verify production configs.',
    modalTemplate: 'Starter Template',
    tplBlank: 'Blank Document (SKILL.md only)',
    tplScript: 'With Script (includes scripts/run.sh)',
    tplRef: 'With Reference Guide (includes references/guide.md)',
    cancelBtn: 'Cancel',
    createAndOpenBtn: 'Create & Open',
    modalNewFolderTitle: '📁 New Category Folder',
    modalScopeBelong: 'Location',
    modalFolderPathLabel: 'Folder Path (nested supported, e.g. frontend/react)',
    modalFolderPathPlaceholder: 'e.g. automation',
    createFolderBtn: 'Create Folder',
    modalMountTitle: '💼 Mount Project or External Skills Folder',
    modalMountType: 'Folder Type',
    mountTypeWs: 'Project Workspace Root (manages .agents/skills)',
    mountTypeExt: 'External Skills Folder (e.g. ~/.claude/skills)',
    modalMountPath: 'Full Directory Path',
    modalMountLabel: 'Display Name (optional)',
    modalMountLabelPlaceholder: 'e.g. My Web App',
    mountConfirmBtn: 'Mount Folder',
    toastSavedRaw: 'Saved raw SKILL.md',
    toastEnabled: 'Re-enabled and restored to original folder',
    toastDisabled: 'Disabled and moved to _disabled archive',
    toastMovedFolder: (p: string) => `Moved to ${p || 'root folder'}`,
    toastCopied: (n: string) => `Copied skill: ${n}`,
    toastDeleted: 'Deleted skill document',
    toastFixed: 'Applied quick fix',
    toastSavedAttach: (p: string) => `Saved attachment ${p}`,
    toastDeletedAttach: (p: string) => `Deleted attachment ${p}`,
    toastBoundSource: 'Updated source settings',
    toastFoundUpdate: 'Update available!',
    toastUpToDate: 'Already up to date',
    toastUpdated: 'Backed up previous version and updated!',
    toastAttached: (n: number) => `Attached ${n} skill(s) to chat`,
    toastCheckedAll: (c: number, u: number) => `Checked ${c} skills: ${u} update(s) available`,
    toastCreatedSkill: (n: string) => `Created "${n}"`,
    toastCreatedFolder: (p: string) => `Created folder "${p}"`,
    toastMounted: 'Mounted folder',
  },
  'zh-TW': {
    brand: 'Better-skills-manager',
    loadingTitle: '正在載入 Better-skills-manager…',
    loadingDesc: '正在掃描本機 Skills、對話使用紀錄與協作關係',
    tabFinder: '🗂️ 文件管理',
    tabAnalytics: '📊 使用時間軸',
    tabGraph: '🕸️ 協作關聯',
    searchPlaceholder: '搜尋名稱、描述或分類資料夾…',
    checkingUpdates: '檢查中…',
    checkUpdates: '🔄 檢查更新',
    newSkillBtn: '+ 新增文件',
    filterAll: '全部',
    filterEnabled: '已啟用',
    filterDisabled: '已停用',
    filterIssues: '⚠️ 需修正',
    filterUpdates: '⬆️ 有更新',
    foldersHeader: '位置與分類資料夾',
    newFolderTitle: '新增分類資料夾',
    mountBtn: '+掛載',
    mountTitle: '掛載專案或外部目錄',
    allMySkills: '🌟 我的全部 Skills',
    allWithBuiltin: '📚 含內建總覽',
    colSkillDoc: 'Skill 文件',
    colDates: '發布／安裝',
    colTotal: '總次數',
    col30d: '30 天',
    colStatus: '更新／狀態',
    noMatchingSkills: '此篩選條件下沒有符合的 Skill 文件',
    noDesc: '(尚未填寫描述)',
    pubShort: '發',
    instShort: '裝',
    badgeUpdate: '有更新',
    badgeLatest: '最新',
    badgeDisabled: '已停用',
    badgeOk: '正常',
    emptySelectDoc: '點選左側任一份 Skill 文件，即可像管理一般文件一樣讀寫與整理附件',
    sortByTotal: '依總使用排序',
    sortBy30d: '依近 30 天排序',
    sortByPub: '依發布日期',
    sortByInst: '依安裝日期',
    sortByName: '依名稱 A-Z',
    sortTotalShort: '總',
    sort30dShort: '30天',
    backBtn: '← 返回',
    saving: '儲存中…',
    unsaved: '尚未儲存',
    saved: '已自動儲存',
    toggleTipEnabled: '點擊停用並封存',
    toggleTipDisabled: '點擊重新啟用',
    attachToChat: '📎 附加至對話',
    attachToChatTip: '將此 Skill 附加為對話參考內容',
    copyToScope: '📋 複製到…',
    copyToScopeTip: '複製掛載到其他範圍（全域或專案）',
    revealFinder: 'Finder',
    revealFinderTip: '在檔案總管中打開實體目錄',
    deleteBtn: '刪除',
    confirmDelete: (name: string) => `確定要刪除 Skill「${name}」嗎？這會移除磁碟上的實體資料夾。`,
    copyToLabel: '複製掛載至：',
    publishedLabel: '📅 發布：',
    installedLabel: '📥 安裝：',
    sourceBuiltin: '🔒 內建技能',
    sourceGit: '🔗 Git 遠端',
    sourceLocalDir: '📂 本機來源',
    sourceOriginal: '📍 本機原創',
    updateAvailable: '⬆️ 有可用更新',
    upToDate: '✅ 已是最新',
    applyUpdate: '⬆️ 立即更新',
    sourceSettings: '來源設定',
    folderLabel: '📁 分類：',
    rootFolder: '(根目錄)',
    updateStatusPrefix: '更新狀態：',
    lastCheckedPrefix: '上次檢查：',
    sourceGitOpt: 'Git / GitHub 網址',
    sourceLocalOpt: '本機來源資料夾路徑',
    sourceOriginalOpt: '設為本機原創（無外部來源）',
    applyAndCheck: '套用並檢查',
    subTabDoc: '📄 文件內容',
    subTabAttach: '📎 附件夾',
    subTabUsage: '📊 使用紀錄',
    subTabRelations: '🔗 協作關聯',
    healthOk: '✅ 格式合格 — Frontmatter 與附件連結皆正常，Agent 可直接讀取',
    healthErr: '❌ 格式有誤（建議修正）',
    healthWarn: '⚠️ 格式建議優化',
    preservedYaml: (keys: string[]) => `保留其他 YAML 欄位：${keys.join(', ')}`,
    singleDocHint: '單一文件檢視（自動維持合法 SKILL.md 格式）',
    modeForm: '文件表單',
    modeRaw: '原始碼 SKILL.md',
    fieldSkillName: 'Skill 識別名稱 (name)',
    fieldVersion: '版本 (選填)',
    fieldDescription: '觸發描述 (description — 告訴 Agent 何時啟用)',
    charsCount: (n: number) => `${n} 字`,
    fieldBody: '操作步驟與規範正文 (Markdown)',
    openInEditor: '在編輯器分頁開啟',
    saveRawBtn: '儲存原始 SKILL.md',
    attachIntro: '所有 scripts/、references/、examples/ 附屬檔案都集中在這裡管理',
    newAttachBtn: '+ 新增附件檔案',
    newAttachPlaceholder: '例如：scripts/setup.sh 或 references/api.md',
    createBtn: '建立',
    noAttachMsg: '目前沒有額外附件檔案。可以點上方「+ 新增附件檔案」，或在主文寫入連結後一鍵建立。',
    insertLinkBtn: '插入連結至主文',
    binaryFileMsg: (size: number) => `二進位或媒體檔案（${size} bytes），可用 Finder 開啟預覽。`,
    saveAttachBtn: '儲存附件變更',
    selectAttachHint: '請在左側點選附件進行檢視或編輯。',
    usageTotalCard: '累積總次數',
    usage30dCard: '近 30 天次數',
    usageIdleCard: '最後使用距今',
    neverUsed: '從未使用',
    usedToday: '今天使用過',
    daysAgo: (d: number) => `${d} 天前`,
    usageEventsTitle: (n: number) => `每次使用時間點明細 (${n})`,
    noUsageEvents: '目前尚未紀錄到這個 Skill 的歷史使用紀錄。',
    colTimestamp: '時間點',
    colTriggerSource: '觸發方式',
    colConvId: '對話 ID',
    relationsIntro: '依據主文引用、歷史同對話搭配紀錄與領域相似度自動分析關聯。',
    attachGroupBtn: '📎 整組附加至對話',
    noRelationsMsg: '目前尚未偵測到與其他 Skill 的引用、搭配或領域重疊關聯。',
    openSkillBtn: '開啟文件 →',
    relBasisPrefix: '關聯依據：',
    heatmapDefaultTitle: '過去 365 天使用頻率分佈',
    heatmapHover: (date: string, count: number) => `${date}：${count} 次使用`,
    heatmapSummary: (total: number, days: number) => `近一年共 ${total} 次（涵蓋 ${days} 天）`,
    analyticsGlobalHeatmap: '全技能庫 365 天使用頻率熱力圖',
    analyticsTotalCard: '累積總使用次數',
    analytics30dCard: '近 30 天使用次數',
    analyticsActiveCard: '近 30 天活躍 Skills',
    analyticsIdleCard: '超過 30 天未使用',
    analyticsDiagTitle: '各 Skill 使用頻率與閒置診斷',
    analyticsFilterAll: (n: number) => `全部 (${n})`,
    analyticsFilterActive: (n: number) => `近 30 天活躍 (${n})`,
    analyticsFilterIdle: (n: number) => `閒置待整理 (${n})`,
    colSkill: 'Skill',
    colScope: '範圍',
    colTotalUses: '總次數',
    col30dUses: '近 30 天',
    colLastUsed: '最後使用時間',
    colHealthState: '狀態',
    idleDaysBadge: (d: number) => `閒置 ${d} 天`,
    activeBadge: '活躍中',
    recentTimelineTitle: '近期觸發時間軸明細（真實對話與面板紀錄）',
    noGlobalEvents: '尚未偵測到歷史對話觸發紀錄。在對話中使用 Skill 或點擊「附加至對話」時，這裡會記錄精確時間點。',
    srcReadFile: 'Agent 自動讀取',
    srcSlash: '斜線指令 /',
    srcMention: '@ 提及引用',
    srcPanelAttach: '面板附加至對話',
    graphTitle: '🕸️ 多 Skills 協作關聯圖',
    graphSubtitle: '自動分析「明確引用」「同對話搭配」「工具領域相近」與「重疊警示」，方便組裝多技能工作流程。',
    graphAll: (n: number) => `全部 (${n})`,
    graphRef: '明確引用',
    graphCoUsage: '同對話搭配',
    graphOverlap: (n: number) => `⚠️ 重疊警示 (${n})`,
    graphFocusBadge: (name: string) => `僅顯示與「${name}」相關的連線`,
    graphShowAll: '顯示全部節點',
    graphEmptyNodes: '目前尚未偵測到多技能關聯。',
    graphHint: '提示：點一下節點可篩選連線，連點兩下直接開啟該文件。',
    legendRef: '● 明確引用',
    legendCo: '● 同對話搭配',
    legendDomain: '● 領域相近',
    legendOverlap: '┈ 觸發描述重疊',
    graphPairsTitle: (n: number) => `協作關聯明細 (${n})`,
    graphNoPairs: '此篩選條件下沒有關聯配對。',
    modalNewSkillTitle: '+ 新增 Skill 文件',
    modalLocation: '儲存位置',
    modalFolder: '分類資料夾 (選填，例如：開發/前端)',
    modalFolderPlaceholder: '留空代表放在根目錄',
    modalSkillName: 'Skill 名稱',
    modalSkillNamePlaceholder: '例如：deploy-helper',
    modalSkillDesc: '觸發描述 (告訴 Agent 什麼時候該使用)',
    modalSkillDescPlaceholder: '例如：當使用者要求部署服務或檢查發布設定時啟用這個 Skill。',
    modalTemplate: '初始範本',
    tplBlank: '空白文件（僅 SKILL.md）',
    tplScript: '附帶執行腳本（含 scripts/run.sh）',
    tplRef: '附帶參考手冊（含 references/guide.md）',
    cancelBtn: '取消',
    createAndOpenBtn: '建立並開啟編輯',
    modalNewFolderTitle: '📁 新增分類資料夾',
    modalScopeBelong: '所屬範圍',
    modalFolderPathLabel: '資料夾路徑（支援多層，例如：前端/React）',
    modalFolderPathPlaceholder: '例如：自動化工具',
    createFolderBtn: '建立資料夾',
    modalMountTitle: '💼 掛載專案或外部 Skill 目錄',
    modalMountType: '目錄類型',
    mountTypeWs: '專案 Workspace 根目錄（自動管理 .agents/skills）',
    mountTypeExt: '外部通用 Skills 目錄（例如 ~/.claude/skills）',
    modalMountPath: '目錄完整路徑',
    modalMountLabel: '顯示名稱 (選填)',
    modalMountLabelPlaceholder: '例如：我的網站專案',
    mountConfirmBtn: '掛載目錄',
    toastSavedRaw: '已儲存原始 SKILL.md',
    toastEnabled: '已重新啟用並歸位原資料夾',
    toastDisabled: '已移入 _disabled 封存夾',
    toastMovedFolder: (p: string) => `已分類至 ${p || '根目錄'}`,
    toastCopied: (n: string) => `已複製掛載：${n}`,
    toastDeleted: '已刪除 Skill 文件',
    toastFixed: '已完成格式修復',
    toastSavedAttach: (p: string) => `已儲存附件 ${p}`,
    toastDeletedAttach: (p: string) => `已刪除附件 ${p}`,
    toastBoundSource: '已更新來源設定',
    toastFoundUpdate: '發現可用更新！',
    toastUpToDate: '已是最新版本',
    toastUpdated: '已備份舊版並完成更新！',
    toastAttached: (n: number) => `已將 ${n} 份 Skill 附加至對話`,
    toastCheckedAll: (c: number, u: number) => `檢查完畢：${c} 份中共有 ${u} 份可用更新`,
    toastCreatedSkill: (n: string) => `已建立「${n}」`,
    toastCreatedFolder: (p: string) => `已建立分類資料夾「${p}」`,
    toastMounted: '已掛載目錄',
  },
} as const;

export function formatScopeLabel(scope: ScopeInfo, lang: UiLang): string {
  if (lang === 'zh-TW') {
    if (scope.id === 'global') return '全域技能庫 (~/.gemini/config)';
    if (scope.id === 'builtin') return '內建技能 (唯讀參考)';
    if (scope.id === 'ext-agents') return '通用目錄 (~/.agents/skills)';
    if (scope.id === 'ext-claude') return 'Claude Code (~/.claude/skills)';
    return scope.label;
  }
  if (scope.id === 'global') return 'Global Skills (~/.gemini/config)';
  if (scope.id === 'builtin') return 'Built-in Skills (Read-only)';
  if (scope.id === 'ext-agents') return 'Shared (~/.agents/skills)';
  if (scope.id === 'ext-claude') return 'Claude Code (~/.claude/skills)';
  if (scope.label.startsWith('專案：')) {
    return `Project: ${scope.label.slice(3)}`;
  }
  if (scope.label.startsWith('外部：')) {
    return `External: ${scope.label.slice(3)}`;
  }
  return scope.label;
}

export function formatValidationIssue(
  issue: ValidationIssue,
  lang: UiLang,
): { message: string; fixLabel?: string } {
  if (lang === 'zh-TW') {
    return { message: issue.message, fixLabel: issue.fixLabel };
  }
  switch (issue.code) {
    case 'yaml_error':
      return {
        message: issue.message.includes('缺少')
          ? 'Missing YAML frontmatter block (--- ... ---) at top of SKILL.md'
          : `YAML syntax error: ${issue.message.replace(/^YAML 語法錯誤：/, '')}`,
      };
    case 'missing_name':
      return {
        message: 'Missing required "name" field in frontmatter',
        fixLabel: 'Auto-generate name',
      };
    case 'invalid_name':
      return {
        message: `Prefer lowercase kebab-case for "name", e.g. "${issue.suggestedName || 'my-skill'}"`,
        fixLabel: `Rename to ${issue.suggestedName || 'kebab-case'}`,
      };
    case 'duplicate_name':
      return {
        message: 'Duplicate enabled skill name detected across scopes; higher-priority scope wins',
      };
    case 'missing_description':
      return {
        message: 'Missing required "description" field — the agent relies on this to trigger the skill',
      };
    case 'short_description':
      return {
        message: 'Trigger description is short (< 20 chars); consider clarifying what it does and when to run it',
      };
    case 'broken_link':
      return {
        message: `Broken attachment link: "${issue.missingRelPath}" not found in bundle`,
        fixLabel: '+ Create Attachment',
      };
    default:
      return { message: issue.message, fixLabel: issue.fixLabel };
  }
}

export function formatSourceMessage(meta: SkillSourceMeta, lang: UiLang): string | undefined {
  if (!meta.checkMessage) return undefined;
  if (lang === 'zh-TW') return meta.checkMessage;

  if (meta.sourceType === 'builtin') return 'Antigravity built-in skill (updated with app)';
  if (meta.sourceType === 'local_original') {
    return 'Local original skill (bind a Git URL or folder to track updates)';
  }
  if (meta.checkStatus === 'up_to_date') {
    return meta.remoteLatestHash
      ? `Up to date (${meta.remoteLatestHash.slice(0, 7)})`
      : 'Synced with upstream source';
  }
  if (meta.checkStatus === 'update_available') {
    return 'New commits or file changes available upstream';
  }
  return meta.checkMessage;
}

export function formatRelationReason(
  reason: RelationReason,
  lang: UiLang,
): { label: string; detail: string } {
  if (lang === 'zh-TW') {
    return { label: reason.label, detail: reason.detail };
  }
  const m = reason.meta;
  switch (reason.type) {
    case 'explicit_ref':
      if (m?.isReverseRef) {
        return {
          label: 'Referenced By',
          detail: m.targetSkillName
            ? `Explicitly mentioned in "${m.targetSkillName}"`
            : 'Explicitly mentioned by another skill',
        };
      }
      return {
        label: 'Explicit Ref',
        detail: m?.targetSkillName
          ? `Mentions "${m.targetSkillName}" in instructions or scripts`
          : 'Explicitly references target skill',
      };
    case 'co_usage':
      return {
        label: 'Co-used',
        detail: m?.coCount
          ? `Used together in ${m.coCount} conversation(s)`
          : 'Used together in historical conversations',
      };
    case 'high_similarity':
      return {
        label: '⚠️ Description Overlap',
        detail: m?.simPercent
          ? `${m.simPercent}% description overlap (${(m.sharedTokens || []).join(', ')}) — clarify boundaries so the agent picks accurately`
          : 'High trigger-description overlap detected',
      };
    case 'domain_overlap':
      return {
        label: 'Domain Similar',
        detail: m?.sharedTokens?.length
          ? `Shared domain keywords: ${m.sharedTokens.join(', ')}`
          : 'Shares related tools or domain keywords',
      };
    default:
      return { label: reason.label, detail: reason.detail };
  }
}
