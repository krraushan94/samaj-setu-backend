// Auto-priority: women safety categories trigger CRITICAL when submitter is female
const WOMEN_SAFETY_CATEGORIES = [
  'eve_teasing', 'harassment', 'domestic_violence',
  'stalking', 'chain_snatching', 'unsafe_area',
];

// Labour/BMS sub-categories are grouped by worker type in the mobile UI, but stored flat here
// (and on the ticket) as "<Worker Type> – <Issue>" strings — the tickets table has no separate
// worker-type column, so the type is folded into the label for admins/teams to see at a glance.
const LABOUR_GROUPS = {
  'Corporate / Private Office Employee': ['Salary Delayed or Not Paid', 'No Appointment Letter', 'Wrongful Termination / Forced Resignation', 'PF / ESI / Gratuity Not Deposited', 'Workplace Harassment', 'Unpaid Overtime', 'Discrimination at Workplace', 'Other'],
  'Factory / Industrial Worker':          ['Wages Below Minimum Wage', 'Unsafe Working Conditions / No Safety Gear', 'Workplace Accident, No Compensation', 'Excessive Working Hours, No Weekly Off', 'No ESI / PF Registration', 'Child Labour at Workplace', 'Wage Theft by Contractor', 'Other'],
  'Construction Worker':                  ['Wages Not Paid by Contractor', 'Unsafe Site / No Safety Equipment', 'No BOCW Welfare Registration', 'Accident at Site, No Compensation', 'No Proper Accommodation or Drinking Water', 'Migrant Worker Stranded Without Wages', 'Child Labour at Site', 'Other'],
  'Domestic Worker / Maid':               ['Salary Delayed or Not Paid', 'Physical or Verbal Abuse by Employer', 'Excessive Working Hours, No Weekly Off', 'Wrongful Accusation by Employer', 'Sudden Termination Without Notice or Dues', 'Sexual Harassment', 'No Written Work Agreement', 'Other'],
  'Auto / Taxi / Cab Driver':             ['Unfair Account Deactivation by App', 'Fare or Commission Dispute', 'Harassment or Assault by Passenger', 'Extortion by Police / RTO', 'Vehicle Permit or License Issue', 'No Insurance or Accident Support', 'Other'],
  'Bus / Transport Worker':               ['Salary Delayed or Not Paid', 'Excessive Duty Hours, No Rest', 'Unsafe Vehicle Condition', 'Harassment by Passenger or Contractor', 'Accident, No Compensation', 'Contract vs Permanent Status Dispute', 'Other'],
  'Delivery / Gig Platform Worker':       ['Unfair Account Blocking', 'Incentive or Payment Not Credited', 'Accident During Delivery, No Support', 'Harassment by Customer', 'Unsafe Working Conditions', 'Other'],
  'Security Guard':                       ['Salary Delayed or Not Paid', 'Excessive Duty Hours, No Weekly Off', 'No PF / ESI Registration', 'Harassment by Client or Site Manager', 'Wrongful Termination', 'Uniform / Equipment Cost Wrongly Deducted', 'Other'],
  'Shop / Retail Employee':               ['Salary Delayed or Not Paid', 'No Appointment Letter', 'Excessive Working Hours, No Weekly Off', 'No PF / ESI Registration', 'Harassment by Owner or Manager', 'Wrongful Termination', 'Other'],
  'Contract / Daily-Wage Labour':         ['Wage Theft by Contractor', 'Below Minimum Wage Payment', 'No Safety Measures Provided', 'Non-Payment After Work Completed', 'Bonded / Forced Labour', 'Other'],
  'Govt / PSU Outsourced Staff':          ['Salary Delayed by Contractor', 'No Regularization Despite Long Service', 'No PF / ESI Despite Legal Requirement', 'Unequal Pay for Equal Work', 'Harassment by Supervisor', 'Other'],
  'Scheme Worker (Anganwadi / ASHA / Mid-Day Meal)': ['Honorarium Delayed or Not Paid', 'No Social Security or Benefits', 'Excessive Workload', 'Lack of Recognition as Employee', 'Other'],
  'Street Vendor / Hawker':               ['Harassment or Eviction by Police / Municipal Staff', 'Extortion to Allow Vending', 'No Vending Certificate or Zone', 'Goods Confiscated Unfairly', 'Other'],
  'Agricultural Labour':                  ['Wages Not Paid by Landowner', 'Exploitation or Unfair Treatment', 'Unsafe Pesticide Exposure', 'No Labour Card or Scheme Benefit', 'Bonded Labour', 'Other'],
  'Sanitation Worker':                    ['No Safety Gear (Manual Scavenging Risk)', 'Health Hazard Exposure', 'Salary Delayed or Not Paid', 'Caste-Based Discrimination at Workplace', 'No PF / ESI', 'Other'],
  'Other Labour Issue':                   ['General Labour Dispute', 'Other'],
};
const LABOUR_SUBCATEGORIES = Object.entries(LABOUR_GROUPS)
  .flatMap(([group, issues]) => issues.map(issue => `${group} – ${issue}`));

const ISSUE_CATEGORIES = {
  infrastructure: ['street_light', 'road_damage', 'pothole', 'water_supply', 'drainage', 'public_toilet', 'bridge', 'disability_access'],
  women_safety:   WOMEN_SAFETY_CATEGORIES,
  security:       ['theft', 'robbery', 'threat', 'illegal_parking', 'unlawful_activity'],
  land_property:  ['land_dispute', 'illegal_construction', 'encroachment', 'property_dispute'],
  health:         ['open_defecation', 'mosquito_breeding', 'garbage_dumping', 'hospital_complaint', 'epidemic_alert'],
  education:      ['school_infrastructure', 'teacher_absenteeism', 'midday_meal', 'dropout_concern'],
  environment:    ['illegal_tree_cutting', 'water_body_encroachment', 'pollution', 'stray_animals'],
  social:         ['drug_abuse', 'child_labour', 'needs_support', 'domestic_abuse', 'elder_abuse', 'caste_discrimination', 'mental_health_crisis'],
  missing:        ['missing_person', 'missing_child', 'medical_emergency'],
  development:    ['work_complaint', 'fund_misuse', 'development_suggestion'],
  feedback:       ['appreciation', 'suggestion', 'event_feedback', 'general_comment'],
  others:         ['general', 'any_other'],
  labour:         LABOUR_SUBCATEGORIES,
};

// Categories where the ₹50 fee is waived — public-good infrastructure and safety/emergency issues
// should never have a cost barrier between a citizen and help.
const PAYMENT_EXEMPT_GROUPS = ['infrastructure', 'women_safety', 'missing'];
// Individual sub-categories exempt even though their group is normally paid — these are
// vulnerable-person safety matters, not everyday complaints.
const PAYMENT_EXEMPT_SUBCATEGORY_LABELS = [
  'Elder Abuse / Neglect', 'Caste-Based Discrimination', 'Mental Health Crisis',
  // Severe/vulnerable labour matters — same rationale as above, not routine wage disputes.
  'Domestic Worker / Maid – Physical or Verbal Abuse by Employer',
  'Domestic Worker / Maid – Sexual Harassment',
  'Corporate / Private Office Employee – Workplace Harassment',
  'Factory / Industrial Worker – Child Labour at Workplace',
  'Construction Worker – Child Labour at Site',
  'Contract / Daily-Wage Labour – Bonded / Forced Labour',
  'Agricultural Labour – Bonded Labour',
  'Sanitation Worker – No Safety Gear (Manual Scavenging Risk)',
];

// Categories that must never surface on the PUBLIC community board, regardless of the
// is_anonymous flag — these stay strictly citizen ↔ team ↔ admin to protect the reporter
// and avoid enabling defamation/retaliation against a named individual.
const NEVER_PUBLIC_GROUPS = ['women_safety'];
const NEVER_PUBLIC_SUBCATEGORY_LABELS = [
  'Threat/Dhamki', 'Domestic Abuse', 'Elder Abuse / Neglect', 'Caste-Based Discrimination', 'Mental Health Crisis',
  // Personal-abuse labour matters — protect the worker's identity from the employer/client named in the report.
  'Domestic Worker / Maid – Physical or Verbal Abuse by Employer',
  'Domestic Worker / Maid – Sexual Harassment',
  'Corporate / Private Office Employee – Workplace Harassment',
];

// Department auto-routing based on category
const CATEGORY_DEPARTMENT_MAP = {
  infrastructure:  'Social Welfare',
  women_safety:    'Social Welfare',
  security:        'Social Welfare',
  health:          'Social Welfare',
  education:       'Social Welfare',
  social:          'Social Welfare',
  missing:         'Social Welfare',
  land_property:   'Others',
  environment:     'Others',
  development:     'Politics',
  feedback:        'Marketing',
  others:          'Others',
  labour:          'BMS',
};

const TICKET_STATUSES = ['payment_pending', 'open', 'in_progress', 'resolved', 'closed'];
const PRIORITIES      = ['low', 'medium', 'high', 'critical'];
const DEPARTMENTS     = ['Politics', 'Marketing', 'Social Welfare', 'Others', 'BMS'];
const ADMIN_USERNAME  = process.env.ADMIN_USERNAME || 'Admin_Raushan';

// Admin_Raushan (the primary admin) plus up to 5 more admin accounts he creates directly.
const MAX_TOTAL_ADMINS = 6;

// "Others" is a catch-all department that can flex wider than the rest; every other
// department is capped tighter since it maps to a single real-world team.
const UNCAPPED_MEMBERS_DEPARTMENT = 'Others';
const MAX_TEAM_LEADERS_OTHERS  = 5;
const MAX_TEAM_LEADERS_DEFAULT = 3;
const MAX_TEAM_MEMBERS_DEFAULT = 20;

module.exports = {
  WOMEN_SAFETY_CATEGORIES,
  LABOUR_GROUPS,
  ISSUE_CATEGORIES,
  CATEGORY_DEPARTMENT_MAP,
  PAYMENT_EXEMPT_GROUPS,
  PAYMENT_EXEMPT_SUBCATEGORY_LABELS,
  NEVER_PUBLIC_GROUPS,
  NEVER_PUBLIC_SUBCATEGORY_LABELS,
  TICKET_STATUSES,
  PRIORITIES,
  DEPARTMENTS,
  ADMIN_USERNAME,
  MAX_TOTAL_ADMINS,
  UNCAPPED_MEMBERS_DEPARTMENT,
  MAX_TEAM_LEADERS_OTHERS,
  MAX_TEAM_LEADERS_DEFAULT,
  MAX_TEAM_MEMBERS_DEFAULT,
};
